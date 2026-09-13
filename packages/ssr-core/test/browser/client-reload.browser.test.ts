import { describe, expect, jest, mock, spyOn, test } from "bun:test";
import { readFileSync } from "fs";
import { Browser } from "happy-dom";

const clientCode = readFileSync(new URL("../../src/adapter/client.js", import.meta.url), "utf8");

class FakeEventSource {
  static instances: FakeEventSource[] = [];

  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onopen: (() => void) | null = null;
  closed = false;
  readonly url: string;

  constructor(url: string | URL) {
    this.url = String(url);
    FakeEventSource.instances.push(this);
  }

  close() {
    this.closed = true;
  }

  emitError() {
    this.onerror?.(new Event("error", { cancelable: true }));
  }

  emitMessage(data: string) {
    this.onmessage?.(new MessageEvent("message", { data }));
  }
}

const flushPromises = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

class FakeLockManager {
  requests = 0;
  active = 0;
  maxActive = 0;
  private queue: Promise<unknown> = Promise.resolve();

  request(
    name: string,
    options: { signal?: AbortSignal },
    callback: (lock: { mode: "exclusive"; name: string }) => unknown,
  ) {
    this.requests += 1;
    const request = this.queue.then(async () => {
      if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      this.active += 1;
      this.maxActive = Math.max(this.maxActive, this.active);
      try {
        return await callback({ mode: "exclusive", name });
      } finally {
        this.active -= 1;
      }
    });
    this.queue = request.catch(() => undefined);
    return request;
  }
}

describe("SSR dev reload client", () => {
  test("owns one visible connection and suspends retries across page lifecycle changes", async () => {
    jest.useFakeTimers();
    FakeEventSource.instances = [];
    localStorage.clear();
    document.head.innerHTML = "";
    document.body.innerHTML = "";

    const reloadGlobal = globalThis as typeof globalThis & {
      __SSR_CONFIG?: { reloadId: string; ssrPath: string };
      __ssr_reload?: boolean;
    };
    const originalEventSource = globalThis.EventSource;
    const originalFetch = globalThis.fetch;
    const originalVisibility = Object.getOwnPropertyDescriptor(document, "visibilityState");
    const originalLocks = Object.getOwnPropertyDescriptor(navigator, "locks");
    const reload = spyOn(window.location, "reload").mockImplementation(() => undefined);
    const lockManager = new FakeLockManager();
    let visibility: DocumentVisibilityState = "hidden";
    let pendingSignal: AbortSignal | undefined;
    let fetchCalls = 0;

    const fetchMock = mock((_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      fetchCalls += 1;
      if (fetchCalls === 1) return Promise.resolve(new Response(null, { status: 503 }));

      pendingSignal = init?.signal ?? undefined;
      return new Promise((_resolve, reject) => {
        pendingSignal?.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true },
        );
      });
    });

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => visibility,
    });
    Object.defineProperty(globalThis, "EventSource", {
      configurable: true,
      value: FakeEventSource,
      writable: true,
    });
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: lockManager,
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    reloadGlobal.__SSR_CONFIG = { reloadId: "server-a", ssrPath: "/docs/_ssr" };
    delete reloadGlobal.__ssr_reload;
    localStorage.setItem("_ssr:/docs/_ssr:reload-id", "stale-server");

    const setVisibility = (next: DocumentVisibilityState) => {
      visibility = next;
      document.dispatchEvent(new Event("visibilitychange"));
    };

    try {
      Function(clientCode)();
      expect(FakeEventSource.instances).toHaveLength(0);
      expect(reload).not.toHaveBeenCalled();
      expect(localStorage.getItem("_ssr:/docs/_ssr:reload-id")).toBe("server-a");

      setVisibility("visible");
      await flushPromises();
      expect(FakeEventSource.instances).toHaveLength(1);
      expect(FakeEventSource.instances[0]!.url).toBe("/docs/_ssr/_reload");
      setVisibility("visible");
      await flushPromises();
      expect(FakeEventSource.instances).toHaveLength(1);
      expect(lockManager.requests).toBe(1);

      setVisibility("hidden");
      expect(FakeEventSource.instances[0]!.closed).toBe(true);
      await flushPromises();
      setVisibility("visible");
      await flushPromises();
      expect(FakeEventSource.instances).toHaveLength(2);

      FakeEventSource.instances[1]!.emitError();
      expect(FakeEventSource.instances[1]!.closed).toBe(true);
      jest.advanceTimersByTime(299);
      expect(fetchMock).not.toHaveBeenCalled();
      jest.advanceTimersByTime(1);
      await flushPromises();
      expect(fetchMock).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(599);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      jest.advanceTimersByTime(1);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      jest.advanceTimersByTime(10_000);
      expect(fetchMock).toHaveBeenCalledTimes(2);

      setVisibility("hidden");
      expect(pendingSignal?.aborted).toBe(true);
      await flushPromises();
      setVisibility("visible");
      await flushPromises();
      expect(FakeEventSource.instances).toHaveLength(3);

      window.dispatchEvent(new Event("pagehide"));
      expect(FakeEventSource.instances[2]!.closed).toBe(true);
      await flushPromises();
      window.dispatchEvent(new Event("pageshow"));
      await flushPromises();
      expect(FakeEventSource.instances).toHaveLength(4);
      window.dispatchEvent(new Event("pageshow"));
      await flushPromises();
      expect(FakeEventSource.instances).toHaveLength(4);

      const autoReload = document.querySelector<HTMLInputElement>("#_ssr_reload");
      expect(autoReload).not.toBeNull();
      autoReload!.checked = false;
      autoReload!.dispatchEvent(new Event("change"));
      expect(FakeEventSource.instances[3]!.closed).toBe(true);
      await flushPromises();
      setVisibility("hidden");
      setVisibility("visible");
      window.dispatchEvent(new Event("pageshow"));
      await flushPromises();
      expect(FakeEventSource.instances).toHaveLength(4);

      autoReload!.checked = true;
      autoReload!.dispatchEvent(new Event("change"));
      await flushPromises();
      expect(FakeEventSource.instances).toHaveLength(5);
      FakeEventSource.instances[4]!.emitMessage("server-b");
      await flushPromises();
      expect(reload).toHaveBeenCalledTimes(1);
      expect(localStorage.getItem("_ssr:/docs/_ssr:reload-id")).toBe("server-b");
      FakeEventSource.instances[4]!.emitMessage("server-c");
      expect(reload).toHaveBeenCalledTimes(1);
      expect(lockManager.maxActive).toBe(1);
      expect(lockManager.requests).toBe(5);
    } finally {
      jest.clearAllTimers();
      jest.useRealTimers();
      globalThis.fetch = originalFetch;
      reload.mockRestore();
      Object.defineProperty(globalThis, "EventSource", {
        configurable: true,
        value: originalEventSource,
        writable: true,
      });
      if (originalVisibility) Object.defineProperty(document, "visibilityState", originalVisibility);
      else Reflect.deleteProperty(document, "visibilityState");
      if (originalLocks) Object.defineProperty(navigator, "locks", originalLocks);
      else Reflect.deleteProperty(navigator, "locks");
      delete reloadGlobal.__SSR_CONFIG;
      delete reloadGlobal.__ssr_reload;
      localStorage.clear();
      document.head.innerHTML = "";
      document.body.innerHTML = "";
    }
  });

  test("coordinates one stream across browser realms and hands leadership off", async () => {
    FakeEventSource.instances = [];
    const browser = new Browser();
    const firstPage = browser.newPage();
    const secondPage = browser.newPage();
    const lockManager = new FakeLockManager();
    firstPage.url = "https://example.test/docs";
    secondPage.url = "https://example.test/docs";

    for (const page of [firstPage, secondPage]) {
      const realm = page.mainFrame.window as unknown as Window & {
        __SSR_CONFIG?: { reloadId: string; ssrPath: string };
      };
      Object.defineProperty(realm, "EventSource", {
        configurable: true,
        value: FakeEventSource,
      });
      Object.defineProperty(realm, "Object", {
        configurable: true,
        value: Object,
      });
      Object.defineProperty(realm, "Boolean", {
        configurable: true,
        value: Boolean,
      });
      Object.defineProperty(realm, "Promise", {
        configurable: true,
        value: Promise,
      });
      Object.defineProperty(realm.navigator, "locks", {
        configurable: true,
        value: lockManager,
      });
      realm.__SSR_CONFIG = { reloadId: "server-a", ssrPath: "/docs/_ssr" };
    }

    try {
      firstPage.evaluate(clientCode);
      secondPage.evaluate(clientCode);
      await flushPromises();

      expect(FakeEventSource.instances).toHaveLength(1);
      expect(lockManager.active).toBe(1);
      expect(lockManager.maxActive).toBe(1);

      const firstRealm = firstPage.mainFrame.window;
      firstRealm.dispatchEvent(new firstRealm.Event("pagehide"));
      // Cross-realm lock release spans event-loop turns; two microtasks are
      // not a completion signal on every runtime/platform.
      for (let attempt = 0; attempt < 100 && FakeEventSource.instances.length < 2; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 1));
      }

      expect(FakeEventSource.instances).toHaveLength(2);
      expect(FakeEventSource.instances[0]!.closed).toBe(true);
      expect(FakeEventSource.instances[1]!.closed).toBe(false);
      expect(lockManager.active).toBe(1);
      expect(lockManager.maxActive).toBe(1);
    } finally {
      await browser.close();
    }
  });
});
