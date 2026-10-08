import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { Link, type LinkProps } from "../../src/nav";

const disposers: Array<() => void> = [];

const setUrl = (url: string) => {
  (window as unknown as Window & { happyDOM: { setURL: (url: string) => void } }).happyDOM.setURL(url);
};

const mountLink = (props: LinkProps): HTMLAnchorElement => {
  const root = document.createElement("div");
  document.body.append(root);
  disposers.push(render(() => Link(props), root));

  const anchor = root.querySelector("a");
  if (!anchor) throw new Error("Link did not render an anchor");
  return anchor;
};

const click = (anchor: HTMLAnchorElement, init: MouseEventInit = {}): MouseEvent => {
  const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init });
  anchor.dispatchEvent(event);
  return event;
};

const flushPromises = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

afterEach(() => {
  while (disposers.length) disposers.pop()!();
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  Reflect.deleteProperty(document, "startViewTransition");
  setUrl("https://example.test/app?view=alpha");
});

describe("@k2b/ssr/nav browser behavior", () => {
  test("keeps reactive anchor props synchronized with island state", async () => {
    const [view, setView] = createSignal<"alpha" | "beta">("alpha");
    const alpha = mountLink({
      href: "/app?view=alpha",
      get class() {
        return view() === "alpha" ? "active" : "inactive";
      },
      onNavigate: (navigation) => {
        setView("alpha");
        navigation.replaceWith();
      },
      children: "alpha",
    });
    const beta = mountLink({
      href: "/app?view=beta",
      get class() {
        return view() === "beta" ? "active" : "inactive";
      },
      onNavigate: (navigation) => {
        setView("beta");
        navigation.replaceWith();
      },
      children: "beta",
    });

    click(beta);
    await flushPromises();
    expect(alpha.className).toBe("inactive");
    expect(beta.className).toBe("active");
    expect(window.location.search).toBe("?view=beta");

    click(alpha);
    await flushPromises();
    expect(alpha.className).toBe("active");
    expect(beta.className).toBe("inactive");
    expect(window.location.search).toBe("?view=alpha");
  });

  test("supports Solid bound onClick handlers", () => {
    let received = "";
    const anchor = mountLink({
      href: "/target",
      onClick: [
        (data: string, event) => {
          received = data;
          event.preventDefault();
        },
        "bound-data",
      ],
      children: "bound",
    });

    const event = click(anchor);

    expect(received).toBe("bound-data");
    expect(event.defaultPrevented).toBe(true);
    expect(window.location.pathname).toBe("/app");
  });

  test("leaves same-document hash links to native browser behavior", () => {
    const anchor = mountLink({ href: "#details", children: "details" });

    const event = click(anchor);

    expect(event.defaultPrevented).toBe(false);
  });

  test("leaves handlerless links to native document navigation", () => {
    const pushState = spyOn(window.history, "pushState");
    const anchor = mountLink({ href: "/target", replace: true, scroll: "preserve", children: "target" });

    const event = click(anchor);

    expect(event.defaultPrevented).toBe(false);
    expect(pushState).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe("/target");
    pushState.mockRestore();
  });

  test("uses the browser-resolved anchor URL for enhanced navigation", async () => {
    setUrl("https://example.test/current/page");
    const anchor = mountLink({
      href: "child?tab=two",
      onNavigate: (navigation) => navigation.push(),
      children: "child",
    });
    Object.defineProperty(anchor, "href", {
      configurable: true,
      value: "https://example.test/base/child?tab=two",
    });

    click(anchor);
    await flushPromises();

    expect(window.location.href).toBe("https://example.test/base/child?tab=two");
  });

  test("falls back to document navigation when async onNavigate fails", async () => {
    const error = new Error("load failed");
    const consoleError = spyOn(console, "error").mockImplementation(() => undefined);
    const anchor = mountLink({
      href: "/recovery",
      onNavigate: async () => {
        throw error;
      },
      children: "recovery",
    });

    click(anchor);
    await flushPromises();

    expect(consoleError).toHaveBeenCalledWith(
      "[@k2b/ssr/nav] onNavigate failed; falling back to document navigation.",
      error,
    );
    expect(window.location.pathname).toBe("/recovery");
    consoleError.mockRestore();
  });

  test("keeps callback helper semantics and uses one view transition", async () => {
    const pushState = spyOn(window.history, "pushState");
    const replaceState = spyOn(window.history, "replaceState");
    const startViewTransition = mock((callback: () => void | Promise<void>) => {
      void callback();
      return {};
    });
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: startViewTransition,
    });
    const anchor = mountLink({
      href: "/target",
      onNavigate: (navigation) => {
        navigation.push(undefined, { replace: true, viewTransition: true });
      },
      children: "target",
    });

    click(anchor);
    await flushPromises();

    expect(pushState).toHaveBeenCalledTimes(1);
    expect(replaceState).not.toHaveBeenCalled();
    expect(startViewTransition).toHaveBeenCalledTimes(1);
    pushState.mockRestore();
    replaceState.mockRestore();
  });

  test("does not repeat a document fallback when the callback later rejects", async () => {
    const error = new Error("late failure");
    const consoleError = spyOn(console, "error").mockImplementation(() => undefined);
    const assign = spyOn(window.location, "assign");
    const anchor = mountLink({
      href: "/target",
      onNavigate: async (navigation) => {
        navigation.fallback("/fallback");
        throw error;
      },
      children: "target",
    });

    click(anchor);
    await flushPromises();

    expect(assign).toHaveBeenCalledTimes(1);
    expect(window.location.pathname).toBe("/fallback");
    assign.mockRestore();
    consoleError.mockRestore();
  });

  test("preserves native behavior for modified, targeted, and download clicks", () => {
    const modified = mountLink({ href: "/modified", children: "modified" });
    const targeted = mountLink({ href: "/targeted", target: "_blank", children: "targeted" });
    const download = mountLink({ href: "/download", download: "download.txt", children: "download" });

    expect(click(modified, { metaKey: true }).defaultPrevented).toBe(false);
    expect(click(targeted).defaultPrevented).toBe(false);
    expect(click(download).defaultPrevented).toBe(false);
  });
});
