/**
 * Hono adapter - provides Hono app to mount at /_ssr and SSR handler factory.
 * Serves island chunks and dev tools endpoints.
 */
import { Hono } from "hono";
import { createFactory } from "hono/factory";
import type { Context, Env, Handler, MiddlewareHandler, TypedResponse } from "hono";
import type { SsrConfig, HtmlFn, RenderFn } from "../index";
import { createAssetResponse, getAssetPrefix, createPingResponse, getSsrDir, createReloadResponse } from "./utils";

// ============================================================================
// Types
// ============================================================================

/** Environment extension for page options in context */
type PageEnv<T extends object> = {
  Variables: {
    page: Partial<T>;
  };
};

/** SSR handler return type - render function or Response (for redirects etc.) */
type SsrHandlerResult = RenderFn | Response | TypedResponse;

/** SSR handler function signature */
type SsrHandler<E extends Env, T extends object> = (
  c: Context<E & PageEnv<T>>,
) => SsrHandlerResult | Promise<SsrHandlerResult>;

/** Return type of ssr() - tuple of middlewares + handler for spread operator */
type SsrHandlers = [MiddlewareHandler, ...MiddlewareHandler[], Handler];

// ============================================================================
// createSSRHandler() - Factory for type-safe SSR page handlers
// ============================================================================

/**
 * Creates an `ssr()` helper for type-safe JSX pages with Hono.
 *
 * Features:
 * - Full compatibility with Hono middlewares/validators
 * - Type-safe page options via `c.get("page")`
 * - Return a render function or Response for redirects
 * - No manual `html()` call needed
 *
 * @example
 * ```ts
 * // config.ts
 * import { createConfig } from "@k2b/ssr";
 * import { createSSRHandler, routes } from "@k2b/ssr/hono";
 *
 * type PageOptions = { title?: string; description?: string };
 *
 * export const { config, plugin, html } = createConfig<PageOptions>({
 *   dev: process.env.NODE_ENV === "development",
 *   template: ({ body, scripts, title, description }) => `
 *     <!DOCTYPE html>
 *     <html>
 *       <head>
 *         <title>${title ?? "App"}</title>
 *         <meta name="description" content="${description ?? ""}">
 *       </head>
 *       <body>${body}${scripts}</body>
 *     </html>
 *   `,
 * });
 *
 * export const ssr = createSSRHandler(html);
 * export { routes };
 * ```
 *
 * @example
 * ```tsx
 * // pages/room.tsx
 * import { ssr } from "../config";
 * import { zValidator } from "@hono/zod-validator";
 * import { z } from "zod";
 *
 * const paramsSchema = z.object({ roomId: z.string() });
 *
 * export const roomPage = ssr(
 *   zValidator("param", paramsSchema),
 *   async (c) => {
 *     const { roomId } = c.req.valid("param");
 *     const room = await db.getRoom(roomId);
 *
 *     c.get("page").title = room.name;
 *     c.get("page").description = `Welcome to ${room.name}`;
 *
 *     return () => <RoomView room={room} />;
 *   }
 * );
 * ```
 *
 * @example
 * ```ts
 * // app.ts
 * import { Hono } from "hono";
 * import { config, routes } from "./config";
 * import { roomPage } from "./pages/room";
 *
 * const app = new Hono()
 *   .route("/_ssr", routes(config))
 *   .get("/room/:roomId", ...roomPage);
 * ```
 */
export const createSSRHandler = <T extends object>(html: HtmlFn<T>) => {
  const factory = createFactory<PageEnv<T>>();

  /**
   * Creates a type-safe SSR page handler with optional middlewares.
   *
   * @param args - Middlewares followed by the final handler
   * @returns Tuple of handlers to spread into Hono route: `...ssr(handler)`
   */
  return <E extends Env = Env>(...args: [...MiddlewareHandler<E>[], SsrHandler<E, T>]): SsrHandlers => {
    // Extract middlewares and final handler
    const middlewares = args.slice(0, -1) as MiddlewareHandler[];
    const finalHandler = args[args.length - 1] as SsrHandler<E, T>;

    // Middleware that initializes c.get("page") with empty object
    const pageMiddleware = factory.createMiddleware(async (c, next) => {
      c.set("page", {} as Partial<T>);
      await next();
    });

    // Wrapped handler: render function → html(), Response → passthrough
    const wrappedHandler: Handler = async (c) => {
      const result = await finalHandler(c as Context<E & PageEnv<T>>);

      // If handler returns Response (e.g., redirect), pass through
      if (result instanceof Response) {
        return result;
      }

      if (typeof result !== "function") {
        throw new Error("[ssr] ssr() handlers must return a render function: return () => <Page />");
      }

      if (result.constructor.name === "AsyncFunction") {
        throw new Error("[ssr] ssr() render functions must be synchronous: return () => <Page />");
      }

      return html(result as RenderFn, c.get("page") as T);
    };

    // Return tuple for spread: .get('/path', ...ssr(handler))
    return [pageMiddleware, ...middlewares, wrappedHandler] as SsrHandlers;
  };
};

// ============================================================================
// routes() - SSR routes for Hono
// ============================================================================

/**
 * Creates Hono app with SSR routes.
 *
 * @example
 * ```ts
 * import { routes } from "@k2b/ssr/hono";
 * const app = new Hono()
 *   .route("/_ssr", routes(config))
 *   .get("/", () => html(() => <Home />));
 * ```
 */
export const routes = (config: SsrConfig) => {
  const { dev } = config;
  const ssrDir = getSsrDir(config);

  const app = new Hono();

  // Dev mode endpoints
  if (dev) {
    app.get("/_reload", (c) => createReloadResponse(c.req.raw.signal));
    app.get("/_ping", () => createPingResponse());
  }

  const serveAsset = (c: Context) => {
    const filename = c.req.param("filename");
    if (!filename) return c.notFound();

    return createAssetResponse(c.req.raw, ssrDir, filename, dev);
  };

  const prefix = getAssetPrefix(dev);
  app.get(`${prefix}/:filename{.+\\.js$}`, serveAsset);
  app.get(`${prefix}/:filename{.+\\.js\\.map$}`, serveAsset);

  return app;
};
