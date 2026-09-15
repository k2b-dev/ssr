/**
 * Elysia adapter - provides Elysia plugin with SSR routes.
 * Uses the shared BunFile-backed asset response path.
 */
import { Elysia } from "elysia";
import type { SsrConfig } from "../index";
import {
  createAssetResponse,
  getAssetPrefix,
  createPingResponse,
  getSsrDir,
  createReloadResponse,
  notFound,
} from "./utils";

/**
 * Creates Elysia plugin with SSR routes.
 *
 * @example
 * ```ts
 * import { routes } from "@k2b/ssr/elysia";
 * new Elysia()
 *   .use(routes(config))
 *   .get("/", () => html(() => <Home />))
 *   .listen(3000);
 * ```
 */
export const routes = (config: SsrConfig) => {
  const { dev, ssrPath } = config;
  const ssrDir = getSsrDir(config);
  const assetPath = ssrPath + getAssetPrefix(dev);

  return new Elysia({ name: "ssr" })
    .get(`${ssrPath}/_reload`, ({ request }) =>
      dev ? createReloadResponse(request.signal) : notFound(),
    )
    .get(`${ssrPath}/_ping`, () => (dev ? createPingResponse() : notFound()))
    .get(`${assetPath}/*`, ({ request, params }) =>
      createAssetResponse(request, ssrDir, params["*"], dev),
    );
};
