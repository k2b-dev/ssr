import { describe, test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { Hono } from "hono";
import { createUniqueId } from "solid-js";
import { createSSRHandler, routes } from "../../src/adapter/hono";
import { createConfig, type HtmlFn, type RenderFn } from "../../src/index";

// ============================================================================
// Mock html function for testing
// ============================================================================

type TestPageOptions = {
  title?: string;
  description?: string;
};

const createMockHtml = (): HtmlFn<TestPageOptions> => {
  return async (render, options = {}) => {
    // Simple mock that returns JSON with the options for testing
    return new Response(
      JSON.stringify({
        element: String(render()),
        options,
      }),
      {
        headers: { "Content-Type": "application/json" },
      },
    );
  };
};

// ============================================================================
// createSSRHandler tests
// ============================================================================

describe("createSSRHandler", () => {
  test("creates ssr function", () => {
    const html = createMockHtml();
    const ssr = createSSRHandler(html);
    expect(typeof ssr).toBe("function");
  });

  test("ssr() returns array of handlers", () => {
    const html = createMockHtml();
    const ssr = createSSRHandler(html);

    const handlers = ssr(async () => () => "test" as any);

    expect(Array.isArray(handlers)).toBe(true);
    expect(handlers.length).toBeGreaterThanOrEqual(2); // at least pageMiddleware + handler
  });

  test("ssr() with middlewares returns correct number of handlers", () => {
    const html = createMockHtml();
    const ssr = createSSRHandler(html);

    const middleware1 = async (_c: any, next: any) => await next();
    const middleware2 = async (_c: any, next: any) => await next();

    const handlers = ssr(middleware1, middleware2, async () => () => "test" as any);

    // pageMiddleware + middleware1 + middleware2 + wrappedHandler
    expect(handlers.length).toBe(4);
  });

  test("page context is initialized with empty object", async () => {
    const html = createMockHtml();
    const ssr = createSSRHandler(html);

    let capturedPage: any = null;

    const handlers = ssr(async (c) => {
      capturedPage = c.get("page");
      return () => "test" as any;
    });

    const app = new Hono().get("/test", ...handlers);
    await app.request("/test");

    expect(capturedPage).toEqual({});
  });

  test("page options can be set via c.get('page')", async () => {
    const html = createMockHtml();
    const ssr = createSSRHandler(html);

    const handlers = ssr(async (c) => {
      c.get("page").title = "Test Title";
      c.get("page").description = "Test Description";
      return () => "test" as any;
    });

    const app = new Hono().get("/test", ...handlers);
    const response = await app.request("/test");
    const result = await response.json();

    expect(result.options).toEqual({
      title: "Test Title",
      description: "Test Description",
    });
  });

  test("render function output is passed to html function", async () => {
    const html = createMockHtml();
    const ssr = createSSRHandler(html);

    const testElement = "Hello World";

    const handlers = ssr(async () => () => testElement as any);

    const app = new Hono().get("/test", ...handlers);
    const response = await app.request("/test");
    const result = await response.json();

    expect(result.element).toBe("Hello World");
  });

  test("Response is passed through without calling html", async () => {
    let htmlCalled = false;
    const html: HtmlFn<TestPageOptions> = async () => {
      htmlCalled = true;
      return new Response("from html");
    };
    const ssr = createSSRHandler(html);

    const redirectResponse = new Response(null, {
      status: 302,
      headers: { Location: "/other" },
    });

    const handlers = ssr(async () => redirectResponse);

    const app = new Hono().get("/test", ...handlers);
    const response = await app.request("/test");

    expect(htmlCalled).toBe(false);
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/other");
  });

  test("middlewares are executed in order", async () => {
    const html = createMockHtml();
    const ssr = createSSRHandler(html);

    const order: number[] = [];

    const middleware1 = async (_c: any, next: any) => {
      order.push(1);
      await next();
      order.push(4);
    };
    const middleware2 = async (_c: any, next: any) => {
      order.push(2);
      await next();
      order.push(3);
    };

    const handlers = ssr(middleware1, middleware2, async () => {
      order.push(0); // Handler runs in the middle
      return () => "test" as any;
    });

    const app = new Hono().get("/test", ...handlers);
    await app.request("/test");

    // pageMiddleware runs first, then middleware1, then middleware2, then handler
    // Unwinding: middleware2 post, middleware1 post
    expect(order).toEqual([1, 2, 0, 3, 4]);
  });

  test("middleware can access page context", async () => {
    const html = createMockHtml();
    const ssr = createSSRHandler<TestPageOptions>(html);

    let middlewarePageAccess: any = null;

    const middleware = async (c: any, next: any) => {
      middlewarePageAccess = c.get("page");
      c.get("page").title = "Set by middleware";
      await next();
    };

    const handlers = ssr(middleware, async () => () => "test" as any);

    const app = new Hono().get("/test", ...handlers);
    const response = await app.request("/test");
    const result = await response.json();

    expect(middlewarePageAccess).toBeDefined();
    expect(result.options.title).toBe("Set by middleware");
  });

  test("works with spread operator in route definition", async () => {
    const html = createMockHtml();
    const ssr = createSSRHandler(html);

    const pageHandler = ssr(async (c) => {
      c.get("page").title = "Spread Test";
      return () => "content" as any;
    });

    // This is the intended usage pattern
    const app = new Hono().get("/page", ...pageHandler);

    const response = await app.request("/page");
    const result = await response.json();

    expect(result.options.title).toBe("Spread Test");
  });

  test("async handler is supported", async () => {
    const html = createMockHtml();
    const ssr = createSSRHandler(html);

    const handlers = ssr(async (c) => {
      // Simulate async operation
      await new Promise((resolve) => setTimeout(resolve, 10));
      c.get("page").title = "Async Title";
      return () => "async content" as any;
    });

    const app = new Hono().get("/test", ...handlers);
    const response = await app.request("/test");
    const result = await response.json();

    expect(result.options.title).toBe("Async Title");
  });

  test("renders createUniqueId() inside Solid SSR context", async () => {
    const { html } = createConfig({ dev: false });
    const ssr = createSSRHandler(html);

    const handlers = ssr(async () => () => createUniqueId() as any);
    const app = new Hono().get("/test", ...handlers);
    const response = await app.request("/test");

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("0");
  });

  test("rejects handlers that return already evaluated JSX", async () => {
    const html = createMockHtml();
    const ssr = createSSRHandler(html);

    const handlers = ssr(async () => "content" as unknown as RenderFn);
    const app = new Hono()
      .onError((error, c) => c.text(error.message, 500))
      .get("/test", ...handlers);
    const response = await app.request("/test");

    expect(response.status).toBe(500);
    expect(await response.text()).toContain("must return a render function");
  });
});

// ============================================================================
// routes() tests
// ============================================================================

describe("routes", () => {
  test("creates Hono app", () => {
    const app = routes({ dev: false, basePath: "", ssrPath: "/_ssr" });
    expect(app).toBeInstanceOf(Hono);
  });

  test("dev mode adds _reload and _ping endpoints", async () => {
    const app = routes({ dev: true, basePath: "", ssrPath: "/_ssr" });

    const pingResponse = await app.request("/_ping");
    expect(pingResponse.status).toBe(200);
    expect(await pingResponse.text()).toBe("ok");
    expect(pingResponse.headers.get("X-SSR-Reload-ID")).not.toBeNull();

    const reloadResponse = await app.request("/_reload");
    expect(reloadResponse.status).toBe(200);
    expect(reloadResponse.headers.get("Content-Type")).toBe("text/event-stream");
  });

  test("prod mode does not add dev endpoints", async () => {
    const app = routes({ dev: false, basePath: "", ssrPath: "/_ssr" });

    const pingResponse = await app.request("/_ping");
    expect(pingResponse.status).toBe(404);

    const reloadResponse = await app.request("/_reload");
    expect(reloadResponse.status).toBe(404);
  });

  test("serves .js files", async () => {
    // This test would require actual files in _ssr directory
    // For now, just verify the route exists and returns 404 for missing files
    const app = routes({ dev: true, basePath: "", ssrPath: "/_ssr" });

    const response = await app.request("/nonexistent.js");
    expect(response.status).toBe(404);
  });

  test("rejects asset requests without a filename before file serving", async () => {
    const assetRoutes = routes({ dev: false, basePath: "", ssrPath: "/_ssr" });
    const assetHandler = assetRoutes.routes.find(
      (route) => route.path.endsWith("/:filename{.+\\.js$}"),
    )?.handler;
    expect(assetHandler).toBeDefined();

    const app = new Hono().get("/", assetHandler!);
    const response = await app.request("/");

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("404 Not Found");
  });

  test("rejects path traversal attempts", async () => {
    const app = routes({ dev: true, basePath: "", ssrPath: "/_ssr" });

    const response = await app.request("/../../../etc/passwd.js");
    expect(response.status).toBe(404);
  });

  test("serves .js files from configured rootDir in dev mode", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "ssr-hono-root-"));
    try {
      mkdirSync(join(rootDir, "_ssr"), { recursive: true });
      writeFileSync(join(rootDir, "_ssr", "island.js"), "export default 1;");

      const app = routes({ dev: true, rootDir, basePath: "", ssrPath: "/_ssr" });
      const response = await app.request("/island.js");

      expect(response.status).toBe(200);
      expect(await response.text()).toContain("export default 1");
      expect(response.headers.get("Cache-Control")).toBe("no-cache");
      expect(response.headers.get("ETag")).toMatch(/^W\/"/);
      expect(response.headers.get("Last-Modified")).not.toBeNull();
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  test("revalidates stable entries and caches hashed chunks", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "ssr-hono-cache-"));
    try {
      const ssrDir = join(rootDir, "_ssr");
      mkdirSync(ssrDir, { recursive: true });
      writeFileSync(join(ssrDir, "island.js"), "export default 1;");
      writeFileSync(join(ssrDir, "chunk-abc123.js"), "export const shared = 1;");
      writeFileSync(join(ssrDir, "island.js.map"), '{"version":3}');

      const app = routes({ dev: true, rootDir, basePath: "", ssrPath: "/_ssr" });
      const first = await app.request("/island.js");
      const etag = first.headers.get("ETag")!;
      const unchanged = await app.request("/island.js", { headers: { "If-None-Match": etag } });
      const chunk = await app.request("/chunk-abc123.js");
      const sourceMap = await app.request("/island.js.map");

      expect(unchanged.status).toBe(304);
      expect(await unchanged.text()).toBe("");
      expect(chunk.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
      expect(sourceMap.status).toBe(200);
      expect(sourceMap.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
      expect(sourceMap.headers.get("Cache-Control")).toBe("no-cache");

      writeFileSync(join(ssrDir, "island.js"), "export default 200;");
      const changed = await app.request("/island.js", { headers: { "If-None-Match": etag } });
      expect(changed.status).toBe(200);
      expect(await changed.text()).toContain("export default 200");
      expect(changed.headers.get("ETag")).not.toBe(etag);
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  test("works when a feature app is mounted under a base path", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "ssr-hono-mounted-"));
    try {
      mkdirSync(join(rootDir, "_ssr"), { recursive: true });
      writeFileSync(join(rootDir, "_ssr", "island.js"), "export default 1;");

      const featureApp = new Hono().route(
        "/_ssr",
        routes({ dev: true, rootDir, basePath: "/docs", ssrPath: "/docs/_ssr" }),
      );
      const hostApp = new Hono().route("/docs", featureApp);

      const assetResponse = await hostApp.request("/docs/_ssr/island.js");
      const pingResponse = await hostApp.request("/docs/_ssr/_ping");
      const reloadResponse = await hostApp.request("/docs/_ssr/_reload");

      expect(assetResponse.status).toBe(200);
      expect(await assetResponse.text()).toContain("export default 1");
      expect(pingResponse.status).toBe(200);
      expect(await pingResponse.text()).toBe("ok");
      expect(reloadResponse.status).toBe(200);
      expect(reloadResponse.headers.get("Content-Type")).toBe("text/event-stream");
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });
});
