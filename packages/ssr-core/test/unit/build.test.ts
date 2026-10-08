import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { routes as honoRoutes } from "../../src/adapter/hono";
import { buildIslands, dedupeSharedChunkExports } from "../../src/build";
import { islandIdFromFile } from "../../src/island-id";
import { createConfig } from "../../src/index";

const tempRoots: string[] = [];

const makeTempRoot = (): string => {
  const root = mkdtempSync(join(process.cwd(), ".ssr-build-test-"));
  tempRoots.push(root);
  return root;
};

const writeTempFile = (path: string, contents: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
};

afterEach(() => {
  while (tempRoots.length) {
    const root = tempRoots.pop()!;
    rmSync(root, { recursive: true, force: true });
  }
});

describe("buildIslands()", () => {
  test("builds and serves islands from monorepo rootDir", async () => {
    const workspaceRoot = makeTempRoot();
    const outdir = join(workspaceRoot, "_ssr");
    const islandPath = join(workspaceRoot, "cloud-core", "src", "Counter.island.tsx");
    writeTempFile(join(outdir, "chunk-stale.js"), "stale");
    writeTempFile(join(outdir, "keep.txt"), "unmanaged");

    // Simulate monorepo layout where entrypoint package differs from island package.
    writeTempFile(
      islandPath,
      `
      export default function Counter() {
        return <button>Count</button>;
      }
      `,
    );

    await buildIslands({
      pattern: "**/*.{island,client}.tsx",
      cwd: workspaceRoot,
      outdir,
      verbose: false,
      dev: true,
      external: ["solid-js/web", "seroval"],
    });

    const id = islandIdFromFile(islandPath, workspaceRoot);
    const entryChunk = join(outdir, `${id}.js`);
    const sourceMap = `${entryChunk}.map`;

    expect(existsSync(entryChunk)).toBe(true);
    expect(existsSync(sourceMap)).toBe(true);
    expect(existsSync(join(outdir, "chunk-stale.js"))).toBe(false);
    expect(existsSync(join(outdir, "keep.txt"))).toBe(true);
    const entrySource = readFileSync(entryChunk, "utf8");
    expect(entrySource).toContain(`//# sourceMappingURL=${id}.js.map`);
    expect(entrySource).not.toContain("sourceMappingURL=data:");
    expect(JSON.parse(readFileSync(sourceMap, "utf8")).sourcesContent.join("\n")).toContain(
      `import{mount}from${JSON.stringify(resolve(import.meta.dir, "../../src/mount.ts"))}`,
    );

    const app = honoRoutes({ dev: true, rootDir: workspaceRoot, basePath: "", ssrPath: "/_ssr" });
    const response = await app.request(`/${id}.js`);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/javascript");
  });

  test("multiple entries share one mount runtime", async () => {
    const workspaceRoot = makeTempRoot();
    const outdir = join(workspaceRoot, "_ssr");
    const files = ["First.island.tsx", "Second.client.tsx"];
    for (const file of files) writeTempFile(join(workspaceRoot, file), `export default () => <b>Ready</b>;`);
    await buildIslands({ pattern: "**/*.{island,client}.tsx", cwd: workspaceRoot, outdir, verbose: false, dev: true });

    const chunks = [...new Bun.Glob("chunk-*.js").scanSync({ cwd: outdir, absolute: true })];
    const sharedSource = chunks.map((file) => readFileSync(file, "utf8")).join("\n");
    expect(sharedSource.match(/This part of the page could not be displayed\./g)).toHaveLength(1);
    for (const file of files) {
      const entrySource = readFileSync(join(outdir, `${islandIdFromFile(join(workspaceRoot, file), workspaceRoot)}.js`), "utf8");
      expect(entrySource).toMatch(/import\s*\{[^}]*\bmount\b[^}]*\}\s*from\s*"\.\/chunk-/);
      expect(entrySource).not.toContain("This part of the page could not be displayed.");
    }
  });

  test("supports explicit inline development source maps", async () => {
    const workspaceRoot = makeTempRoot();
    const outdir = join(workspaceRoot, "_ssr");
    writeTempFile(
      join(workspaceRoot, "Counter.island.tsx"),
      `export default function Counter() { return <button>Count</button>; }`,
    );

    await buildIslands({
      pattern: "**/*.{island,client}.tsx",
      cwd: workspaceRoot,
      outdir,
      verbose: false,
      dev: true,
      devSourcemap: "inline",
      external: ["solid-js/web", "seroval"],
    });

    const [entryChunk] = [...new Bun.Glob("*.js").scanSync({ cwd: outdir, absolute: true })];
    expect(await Bun.file(entryChunk!).text()).toContain("sourceMappingURL=data:");
    expect(existsSync(`${entryChunk}.map`)).toBe(false);
  });

  test("builds components from explicit package roots with project-relative IDs", async () => {
    const workspaceRoot = makeTempRoot();
    const outdir = join(workspaceRoot, "dist");
    const packageRoot = join(workspaceRoot, "node_modules", "example-framework");
    const appIsland = join(workspaceRoot, "src", "App.island.tsx");
    const frameworkIsland = join(packageRoot, "src", "Shell.island.tsx");
    writeTempFile(appIsland, `export default function App() { return <button>App</button>; }`);
    writeTempFile(frameworkIsland, `export default function Shell() { return <button>Shell</button>; }`);

    await buildIslands({
      pattern: "**/*.{island,client}.tsx",
      cwd: workspaceRoot,
      componentRoots: ["src", packageRoot],
      outdir,
      verbose: false,
      dev: true,
      external: ["solid-js/web", "seroval"],
    });

    expect(existsSync(join(outdir, `${islandIdFromFile(appIsland, workspaceRoot)}.js`))).toBe(true);
    expect(existsSync(join(outdir, `${islandIdFromFile(frameworkIsland, workspaceRoot)}.js`))).toBe(true);
  });

  test("explicit roots exclude siblings and deduplicate overlapping symlinked packages in dev and production", async () => {
    const workspaceRoot = makeTempRoot();
    const appRoot = join(workspaceRoot, "app");
    const sharedRoot = join(workspaceRoot, "shared");
    const linkedRoot = join(workspaceRoot, "linked");
    const appIsland = join(appRoot, "App.island.tsx");
    const sharedIsland = join(sharedRoot, "Shell.island.tsx");
    const foreignIsland = join(workspaceRoot, "other", "Foreign.island.tsx");
    writeTempFile(appIsland, `export default () => <button>App</button>;`);
    writeTempFile(sharedIsland, `export default () => <button>Shared</button>;`);
    writeTempFile(foreignIsland, `this is deliberately invalid source`);
    symlinkSync(sharedRoot, linkedRoot, "dir");
    symlinkSync(sharedRoot, join(sharedRoot, "cycle"), "dir");
    for (const dev of [true, false]) {
      const outdir = join(workspaceRoot, dev ? "dev" : "prod");
      await buildIslands({
        pattern: "**/*.{island,client}.tsx", cwd: workspaceRoot,
        componentRoots: ["app", linkedRoot, sharedRoot, "app"],
        outdir, verbose: false, dev,
      });
      expect(existsSync(join(outdir, `${islandIdFromFile(appIsland, workspaceRoot)}.js`))).toBe(true);
      expect(existsSync(join(outdir, `${islandIdFromFile(sharedIsland, workspaceRoot)}.js`))).toBe(true);
      expect(existsSync(join(outdir, `${islandIdFromFile(foreignIsland, workspaceRoot)}.js`))).toBe(false);
    }
  });

  test("browser bundles share a working context and store runtime in dev and production", async () => {
    const workspaceRoot = makeTempRoot();
    const source = join(workspaceRoot, "App.island.tsx");
    writeTempFile(source, `
      import { createContext, useContext } from "solid-js";
      import { createStore } from "solid-js/store";
      const Context = createContext("missing");
      function Child() {
        const label = useContext(Context);
        const [state, set] = createStore({ count: 0 });
        return <button onClick={() => set("count", state.count + 1)}>{label} {state.count}</button>;
      }
      export default () => <Context.Provider value="Clicks"><Child /></Context.Provider>;
    `);
    for (const dev of [true, false]) {
      const outdir = join(workspaceRoot, dev ? "dev" : "prod");
      await buildIslands({ pattern: "**/*.{island,client}.tsx", cwd: workspaceRoot, outdir, componentRoots: [workspaceRoot], verbose: false, dev });
      const id = islandIdFromFile(source, workspaceRoot);
      const runner = join(workspaceRoot, `run-${dev}.ts`);
      writeTempFile(runner, `
        import ${JSON.stringify(join(import.meta.dir, "../browser/setup.ts"))};
        import { serialize } from "seroval";
        const element = document.createElement("solid-island");
        element.dataset.id = ${JSON.stringify(id)};
        element.dataset.props = JSON.stringify(serialize({}));
        document.body.append(element);
        await import(${JSON.stringify(join(outdir, id + ".js"))});
        const button = document.querySelector("button");
        if (button?.textContent?.trim() !== "Clicks 0") throw new Error("Initial context/store render failed");
        button.click();
        await new Promise(resolve => setTimeout(resolve, 0));
        if (button.textContent?.trim() !== "Clicks 1") throw new Error("Reactive store update failed");
      `);
      const child = Bun.spawn([process.execPath, runner], { stdout: "pipe", stderr: "pipe" });
      const [status, error] = await Promise.all([child.exited, new Response(child.stderr).text()]);
      expect({ status, error }).toEqual({ status: 0, error: "" });
    }
  });

  test("an explicit empty selection scans nothing and missing roots fail clearly", async () => {
    const workspaceRoot = makeTempRoot();
    writeTempFile(join(workspaceRoot, "Invalid.island.tsx"), "invalid source");
    const options = { pattern: "**/*.{island,client}.tsx", cwd: workspaceRoot, outdir: join(workspaceRoot, "out"), verbose: false };
    await buildIslands({ ...options, componentRoots: [] });
    expect(existsSync(options.outdir)).toBe(false);
    writeTempFile(join(options.outdir, "chunk-stale.js"), "stale");
    writeTempFile(join(options.outdir, "keep.txt"), "unmanaged");
    await buildIslands({ ...options, componentRoots: [] });
    expect(existsSync(join(options.outdir, "chunk-stale.js"))).toBe(false);
    expect(existsSync(join(options.outdir, "keep.txt"))).toBe(true);
    await expect(buildIslands({ ...options, componentRoots: ["missing"] })).rejects.toThrow("ENOENT");
  });

  test("resolves alias island imports in Bun.build plugin and emits matching island chunk", async () => {
    const workspaceRoot = makeTempRoot();
    const outdir = join(workspaceRoot, "dist");
    const islandPath = join(workspaceRoot, "src", "components", "Counter.island.tsx");
    const pagePath = join(workspaceRoot, "src", "Page.tsx");
    const entryPath = join(workspaceRoot, "src", "server.tsx");

    writeTempFile(
      join(workspaceRoot, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          baseUrl: ".",
          paths: {
            "@/*": ["src/*"],
          },
        },
      }),
    );
    writeTempFile(
      islandPath,
      `
      export default function Counter() {
        return <button>Alias</button>;
      }
      `,
    );
    writeTempFile(
      pagePath,
      `
      import Counter from "@/components/Counter.island";
      export default function Page() {
        return <Counter />;
      }
      `,
    );
    writeTempFile(
      entryPath,
      `
      import Page from "./Page";
      export default Page;
      `,
    );

    writeTempFile(join(workspaceRoot, "unrelated", "Invalid.island.tsx"), "invalid source");
    writeTempFile(join(workspaceRoot, "IslandError.tsx"), `
      export default (props: { error: unknown; reset: () => void }) => <button onClick={props.reset}>Configured fallback</button>;
    `);
    const { plugin } = createConfig({
      componentRoots: ["src"],
      dev: false,
      rootDir: workspaceRoot,
      verbose: false,
      external: ["solid-js/web", "seroval"],
      errorFallback: "./IslandError.tsx",
    });
    const result = await Bun.build({
      entrypoints: [entryPath],
      outdir,
      target: "bun",
      plugins: [plugin()],
      external: ["seroval", "solid-js", "solid-js/web"],
      minify: false,
    });

    expect(result.success).toBe(true);
    const logsText = result.logs.map((log) => String(log)).join("\n");
    expect(logsText).not.toContain('onResolve plugin "path" must be absolute');

    const id = islandIdFromFile(islandPath, workspaceRoot);
    expect(existsSync(join(outdir, "_ssr", `${id}.js`))).toBe(true);
    expect(readFileSync(join(outdir, "_ssr", `${id}.js`), "utf8")).toContain("Configured fallback");
    expect(readFileSync(join(outdir, "server.js"), "utf8")).toContain(id);
  });

  test("dedupeSharedChunkExports() merges duplicate export blocks and preserves debugId footer", async () => {
    const workspaceRoot = makeTempRoot();
    const outdir = join(workspaceRoot, "_ssr");
    mkdirSync(outdir, { recursive: true });
    const chunkPath = join(outdir, "chunk-test.js");

    writeTempFile(
      chunkPath,
      `
const a = 1;
const b = 2;
export { a };
export { b, a };
//# debugId=abc123
      `.trim(),
    );

    const fixedCount = await dedupeSharedChunkExports(outdir, false);
    const rewritten = readFileSync(chunkPath, "utf8");

    expect(fixedCount).toBe(1);
    expect(rewritten).not.toContain("export { b, a };");
    expect(rewritten).toContain("export { a };");
    expect(rewritten).toContain("export { b };");
    expect(rewritten.indexOf("export { a };")).toBeLessThan(rewritten.indexOf("//# debugId=abc123"));
    expect(rewritten.indexOf("export { b };")).toBeLessThan(rewritten.indexOf("//# debugId=abc123"));
  });
});
