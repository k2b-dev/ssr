# SSR Monorepo

Minimal SSR + islands for SolidJS on Bun.

Development and CI use Bun 1.4.2. Install workspace dependencies with `bun install --frozen-lockfile`.

This monorepo contains the framework package and an example app. It focuses on server rendering, client re-rendered islands, and adapters for Bun, Hono, and Elysia.

## Packages

### `packages/ssr-core`

Published as `@k2b/ssr`.

- SSR core with Bun-native build/plugin flow
- islands and client-only components via file conventions
- adapters for Bun, Hono, and Elysia
- optional progressive navigation helpers via `@k2b/ssr/nav`
- monorepo support via `rootDir`
- microfrontend support via `basePath`
- linked development source maps and cache-aware asset delivery
- visibility-aware development reload with one cross-tab SSE owner when Web Locks are available
- a default error boundary for every island and client component instance

See the full package docs in [packages/ssr-core/README.md](packages/ssr-core/README.md).

`@k2b/ssr` replaces the deprecated `@valentinkolb/ssr` package. The public API
and subpaths are unchanged; existing applications only need to replace the
package scope in dependencies and imports.

### `packages/ssr-example`

Reference Hono app using the local workspace package.

- uses `createSSRHandler`
- includes islands, client-only components, API calls, and an opt-in nav demo

See [packages/ssr-example/README.md](packages/ssr-example/README.md).

## Example

```ts
import { createConfig } from "@k2b/ssr";
import { createSSRHandler, routes } from "@k2b/ssr/hono";
import { Hono } from "hono";

const { config, html } = createConfig({
  template: ({ body, scripts }) => `<!doctype html><body>${body}${scripts}</body>`,
});

const ssr = createSSRHandler(html);

const Home = ssr(async () => () => <button>hello</button>);

export default new Hono()
  .route("/_ssr", routes(config))
  .get("/", ...Home);
```

Pages return a render function so Solid JSX is evaluated inside the SSR renderer. For installation, adapter setup, `createConfig()` options, `basePath`, and the v0.9.0 migration note, see [packages/ssr-core/README.md](packages/ssr-core/README.md).

## Development

Run from repo root:

```bash
bun install
bun run test
bun run dev:example
bun run build:example
bun run start:example
```

## Agent Skills (optional)

This repository includes agent skills in `skills/`.

Available skills:

- `ssr` for building apps with `@k2b/ssr`
- `ssr-maintainer` for framework-internal work in `ssr-core`

Install them with the Vercel Skills CLI:

```bash
bunx skills add https://github.com/k2b-dev/ssr --skill '*'
```

## Notes

- Framework documentation: [packages/ssr-core/README.md](packages/ssr-core/README.md)
- Example app: [packages/ssr-example](packages/ssr-example)
- LLM notes: [packages/ssr-core/llms.txt](packages/ssr-core/llms.txt)
