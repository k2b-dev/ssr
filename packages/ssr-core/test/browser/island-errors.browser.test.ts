import { afterAll, afterEach, expect, mock, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { buildIslands } from "../../src/build";
import { islandIdFromFile } from "../../src/island-id";

const root = mkdtempSync(join(process.cwd(), ".ssr-island-errors-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const tempRoots: string[] = [];
afterEach(() => {
  mock.restore();
  document.body.replaceChildren();
  for (const directory of tempRoots.splice(0)) rmSync(directory, { recursive: true, force: true });
});

const build = async (name: string, source: string) => {
  const file = join(root, `${name}.island.tsx`);
  writeFileSync(file, source);
  await buildIslands({ pattern: `**/${name}.island.tsx`, cwd: root, outdir: join(root, "_ssr"), verbose: false, dev: true });
  return islandIdFromFile(file, root);
};

test("an error in a reactive update after mount is contained and reported", async () => {
  const id = await build(
    "Broken",
    `import { createMemo, createSignal } from "solid-js";
     export default function Broken() {
       const [n, setN] = createSignal(0);
       const label = createMemo(() => { if (n() === 1) throw new Error("boom"); return "count " + n(); });
       // Like a data library that writes results inside its own try/catch.
       const load = () => { try { setN(n() + 1); } catch {} };
       return <button onClick={load}>{label()}</button>;
     }`,
  );
  document.body.innerHTML = `<solid-island data-id="${id}" data-props="{}">SSR</solid-island>`;
  const reported = spyOn(globalThis, "reportError").mockImplementation(() => {});
  await import(join(root, "_ssr", `${id}.js`));

  document.querySelector("button")!.click();

  expect(document.querySelector("solid-island [role=alert]")).not.toBeNull(); // today: still shows "count 0"
  expect(reported).toHaveBeenCalled(); // today: nothing is reported
  reported.mockRestore();
});

test("one instance failing on first render does not blank or block the others", async () => {
  const id = await build(
    "Throws",
    `export default function Throws(props: { fail: boolean }) {
       if (props.fail) throw new Error("boom");
       return <b>ok</b>;
     }`,
  );
  const el = (fail: boolean) => `<solid-island data-id="${id}" data-props="({fail:${fail}})">SSR</solid-island>`;
  document.body.innerHTML = el(false) + el(true) + el(false);
  const reported = spyOn(globalThis, "reportError").mockImplementation(() => {});
  await import(join(root, "_ssr", `${id}.js`)).catch(() => {});

  const [first, second, third] = document.querySelectorAll("solid-island");
  expect(first!.textContent).toBe("ok");
  expect(second!.querySelector("[role=alert]")).not.toBeNull(); // today: empty element
  expect(third!.textContent).toBe("ok"); // today: never mounted, still "SSR"
  reported.mockRestore();
});

const buildTogether = async (
  files: Record<string, string>,
  options: { dev?: boolean; errorFallback?: string } = {},
) => {
  const directory = mkdtempSync(join(process.cwd(), ".ssr-island-errors-"));
  tempRoots.push(directory);
  for (const [name, source] of Object.entries(files)) writeFileSync(join(directory, name), source);
  const outdir = join(directory, "_ssr");
  await buildIslands({
    pattern: "**/*.{island,client}.tsx", cwd: directory, outdir, verbose: false,
    dev: options.dev ?? true,
    errorFallback: options.errorFallback ? join(directory, options.errorFallback) : undefined,
  });
  const id = (name: string) => islandIdFromFile(join(directory, name), directory);
  return { id, load: (name: string) => import(join(outdir, `${id(name)}.js`)) };
};

test.each([false, true])("island error events bubble and cancellation suppresses reporting (%s)", async (cancel) => {
  const bundle = await buildTogether({
    "Event.island.tsx": `
      import { createMemo, createSignal } from "solid-js";
      export default function Event() {
        const [count, setCount] = createSignal(0);
        const label = createMemo(() => { if (count()) throw new Error("event failure"); return "Update"; });
        return <button onClick={() => setCount(1)}>{label()}</button>;
      }`,
  });
  const id = bundle.id("Event.island.tsx");
  document.body.innerHTML = `<section><solid-island data-id="${id}"></solid-island></section>`;
  const element = document.querySelector("solid-island")!;
  let events = 0;
  let bubbled = 0;
  let reset: (() => void) | undefined;
  element.addEventListener("ssr:island-error", (event) => {
    if (!(event instanceof CustomEvent)) throw new Error("Expected CustomEvent");
    events++;
    expect(event.target).toBe(element);
    expect(event.bubbles).toBe(true);
    expect(event.cancelable).toBe(true);
    expect(event.detail.id).toBe(id);
    expect(event.detail.error).toBeInstanceOf(Error);
    expect(event.detail.error.message).toBe("event failure");
    expect(typeof event.detail.reset).toBe("function");
    reset = event.detail.reset;
  });
  document.querySelector("section")!.addEventListener("ssr:island-error", (event) => {
    bubbled++;
    if (cancel) event.preventDefault();
  });
  const reported = spyOn(globalThis, "reportError").mockImplementation(() => {});
  await bundle.load("Event.island.tsx");
  document.querySelector("button")!.click();
  // These checks happen immediately after the write: reporting must be synchronous.
  expect(events).toBe(1);
  expect(bubbled).toBe(1);
  expect(reported).toHaveBeenCalledTimes(cancel ? 0 : 1);
  expect(element.querySelector("[role=alert][data-ssr-error]")).not.toBeNull();
  reset!();
  expect(element.textContent).toBe("Update");
});

test("Try again remounts with fresh state and rereads the element's props", async () => {
  const bundle = await buildTogether({
    "Retry.island.tsx": `
      import { createSignal } from "solid-js";
      let mounts = 0;
      export default function Retry(props: { label: string }) {
        const [count, setCount] = createSignal(0);
        if (++mounts === 1) { setCount(99); throw new Error("first mount"); }
        return <button onClick={() => setCount(count() + 1)}>{props.label} {count()}</button>;
      }`,
  });
  document.body.innerHTML = `<solid-island data-id="${bundle.id("Retry.island.tsx")}" data-props='({label:"old"})'>SSR</solid-island>`;
  const reported = spyOn(globalThis, "reportError").mockImplementation(() => {});
  await bundle.load("Retry.island.tsx");
  const retry = document.querySelector("button")!;
  expect(retry.type).toBe("button");
  expect(retry.textContent).toBe("Try again");
  expect(document.querySelector("[role=alert]")!.textContent).toBe("This part of the page could not be displayed. Try again");
  document.querySelector<HTMLElement>("solid-island")!.dataset.props = '({label:"fresh"})';
  retry.click();
  expect(document.querySelector("solid-island")!.textContent).toBe("fresh 0");
  document.querySelector("button")!.click();
  expect(document.querySelector("solid-island")!.textContent).toBe("fresh 1");
  expect(reported).toHaveBeenCalledTimes(1);
});

test.each([true, false])("shared signal writes keep other islands updating (dev=%s)", async (dev) => {
  const bundle = await buildTogether({
    "shared.ts": `import { createSignal } from "solid-js"; export const [count, setCount] = createSignal(0);`,
    "Broken.island.tsx": `
      import { createMemo } from "solid-js";
      import { count } from "./shared";
      export default function Broken() {
        const label = createMemo(() => { if (count() === 1) throw new Error("shared failure"); return count(); });
        return <b>{label()}</b>;
      }`,
    "Healthy.island.tsx": `
      import { count, setCount } from "./shared";
      export default () => <button onClick={() => setCount(count() + 1)}>count {count()}</button>;`,
  }, { dev });
  document.body.innerHTML = `<solid-island data-id="${bundle.id("Broken.island.tsx")}"></solid-island><solid-island data-id="${bundle.id("Healthy.island.tsx")}"></solid-island>`;
  const reported = spyOn(globalThis, "reportError").mockImplementation(() => {});
  await bundle.load("Broken.island.tsx");
  await bundle.load("Healthy.island.tsx");
  const [broken, healthy] = document.querySelectorAll("solid-island");
  const button = healthy!.querySelector("button")!;
  button.click();
  expect(broken!.querySelector("[data-ssr-error]")).not.toBeNull();
  expect(healthy!.textContent).toBe("count 1");
  button.click();
  expect(healthy!.textContent).toBe("count 2");
  expect(reported).toHaveBeenCalledTimes(1);
});

test("client components contain initial and reactive errors per instance", async () => {
  const bundle = await buildTogether({
    "Broken.client.tsx": `
      import { createMemo, createSignal } from "solid-js";
      export default function Broken(props: { fail: boolean }) {
        if (props.fail) throw new Error("client mount");
        const [count, setCount] = createSignal(0);
        const label = createMemo(() => { if (count()) throw new Error("client update"); return "Client ready"; });
        return <button onClick={() => setCount(1)}>{label()}</button>;
      }`,
  });
  const id = bundle.id("Broken.client.tsx");
  document.body.innerHTML = `<solid-client data-id="${id}" data-props="({fail:true})"></solid-client><solid-client data-id="${id}" data-props="({fail:false})"></solid-client>`;
  const reported = spyOn(globalThis, "reportError").mockImplementation(() => {});
  await bundle.load("Broken.client.tsx");
  const [broken, healthy] = document.querySelectorAll("solid-client");
  expect(broken!.querySelector("[data-ssr-error]")).not.toBeNull();
  expect(healthy!.textContent).toBe("Client ready");
  healthy!.querySelector("button")!.click();
  expect(healthy!.querySelector("[data-ssr-error]")).not.toBeNull();
  expect(reported).toHaveBeenCalledTimes(2);
});

test("malformed props are contained and can be corrected before retry", async () => {
  const bundle = await buildTogether({ "Props.island.tsx": `export default (props: { label: string }) => <b>{props.label}</b>;` });
  const id = bundle.id("Props.island.tsx");
  document.body.innerHTML = `<solid-island data-id="${id}" data-props="("></solid-island><solid-island data-id="${id}" data-props='({label:"healthy"})'></solid-island>`;
  const reported = spyOn(globalThis, "reportError").mockImplementation(() => {});
  await bundle.load("Props.island.tsx");
  const [broken, healthy] = document.querySelectorAll<HTMLElement>("solid-island");
  expect(broken!.querySelector("[data-ssr-error]")).not.toBeNull();
  expect(healthy!.textContent).toBe("healthy");
  broken!.dataset.props = '({label:"corrected"})';
  broken!.querySelector("button")!.click();
  expect(broken!.textContent).toBe("corrected");
  expect(reported).toHaveBeenCalledTimes(1);
});

test("a failure outside the boundary does not interrupt mounting later elements", async () => {
  const bundle = await buildTogether({ "Ready.island.tsx": `export default () => <b>Ready</b>;` });
  const id = bundle.id("Ready.island.tsx");
  document.body.innerHTML = `<solid-island data-id="${id}"></solid-island><solid-island data-id="${id}"></solid-island>`;
  const [broken, healthy] = document.querySelectorAll("solid-island");
  const error = new Error("clearing failed");
  Object.defineProperty(broken!, "innerHTML", { configurable: true, set() { throw error; } });
  let events = 0;
  broken!.addEventListener("ssr:island-error", () => { events++; });
  const reported = spyOn(globalThis, "reportError").mockImplementation(() => {});
  await bundle.load("Ready.island.tsx");
  Reflect.deleteProperty(broken!, "innerHTML");
  expect(broken!.querySelector("[data-ssr-error]")).not.toBeNull();
  expect(healthy!.textContent).toBe("Ready");
  expect(events).toBe(1);
  expect(reported).toHaveBeenCalledTimes(1);
  expect(reported).toHaveBeenCalledWith(error);
  broken!.querySelector("button")!.click();
  expect(broken!.textContent).toBe("Ready");
});

const retrySource = `
  let mounts = 0;
  export default function Retry() {
    if (++mounts === 1) throw new Error("component failure");
    return <b>Recovered</b>;
  }`;

test("a custom error fallback receives the error and resets the component", async () => {
  const bundle = await buildTogether({
    "Retry.island.tsx": retrySource,
    "IslandError.tsx": `
      export default function IslandError(props: { error: unknown; reset: () => void }) {
        return <div role="alert">Custom: {props.error instanceof Error ? props.error.message : "unknown"}<button onClick={props.reset}>Retry custom</button></div>;
      }`,
  }, { errorFallback: "IslandError.tsx" });
  document.body.innerHTML = `<solid-island data-id="${bundle.id("Retry.island.tsx")}"></solid-island>`;
  const reported = spyOn(globalThis, "reportError").mockImplementation(() => {});
  await bundle.load("Retry.island.tsx");
  expect(document.querySelector("[role=alert]")!.textContent).toBe("Custom: component failureRetry custom");
  expect(document.querySelector("[data-ssr-error]")).toBeNull();
  document.querySelector("button")!.click();
  expect(document.querySelector("solid-island")!.textContent).toBe("Recovered");
  expect(reported).toHaveBeenCalledTimes(1);
});

test.each([false, true])("a throwing custom fallback uses the built-in fallback (reactive=%s)", async (reactive) => {
  const bundle = await buildTogether({
    "Retry.island.tsx": retrySource,
    "IslandError.tsx": reactive ? `
      import { createMemo, createSignal } from "solid-js";
      export default function IslandError() {
        const [broken, setBroken] = createSignal(false);
        const label = createMemo(() => { if (broken()) throw new Error("fallback failure"); return "Break fallback"; });
        return <button onClick={() => setBroken(true)}>{label()}</button>;
      }` : `export default function IslandError() { throw new Error("fallback failure"); }`,
  }, { errorFallback: "IslandError.tsx" });
  document.body.innerHTML = `<solid-island data-id="${bundle.id("Retry.island.tsx")}"></solid-island>`;
  let events = 0;
  document.querySelector("solid-island")!.addEventListener("ssr:island-error", (event) => {
    events++;
    event.preventDefault();
  });
  const reported = spyOn(globalThis, "reportError").mockImplementation(() => {});
  await bundle.load("Retry.island.tsx");
  if (reactive) {
    expect(document.querySelector("button")!.textContent).toBe("Break fallback");
    expect(reported).toHaveBeenCalledTimes(0);
    document.querySelector("button")!.click();
  }
  expect(events).toBe(1);
  expect(document.querySelector("[role=alert][data-ssr-error]")).not.toBeNull();
  expect(reported).toHaveBeenCalledTimes(1);
  expect(reported).toHaveBeenCalledWith(expect.objectContaining({ message: "fallback failure" }));
  document.querySelector("button")!.click();
  expect(document.querySelector("solid-island")!.textContent).toBe("Recovered");
});
