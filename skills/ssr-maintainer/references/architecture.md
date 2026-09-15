# Architecture Reference

## Table of Contents

- [Build Pipeline](#build-pipeline)
- [Transform Pipeline](#transform-pipeline)
- [Island ID System](#island-id-system)
- [Adapter System](#adapter-system)
- [File Map](#file-map)

## Build Pipeline

`buildIslands()` in `src/build.ts`:

1. Scan `**/*.{island,client}.tsx` from explicit `componentRoots`, defaulting to `rootDir`; canonical paths deduplicate symlinks and overlapping roots. IDs remain relative to `rootDir`, with the existing absolute fallback for external files.
2. Generate stable IDs with `islandIdFromFile()`
3. Fail fast on collisions
4. Run one `Bun.build()` pass with virtual island entrypoints and `splitting: true`
5. Generate per-entry hydration code that imports the component, `solid-js/web`, and `seroval`
6. After a successful build, remove obsolete framework-generated JavaScript and source-map files
7. In production only, run `dedupeSharedChunkExports()` on shared chunks

Output stays on disk in `_ssr/`:

```text
_ssr/
├── <12-char-id>.js
├── <12-char-id>.js.map        # development, linked by default
├── chunk-<hash>.js
└── chunk-<hash>.js.map        # development, when emitted by Bun
```

Production builds do not emit source maps. Development builds use linked maps by default so initial JavaScript responses do not carry the map payload. `devSourcemap` can opt into `"inline"` or `"none"` when required.

## Transform Pipeline

`transform()` in `src/transform.ts` runs one Babel transform pass.

### SSR wrapper plugin

- collects `.island` and `.client` default imports
- wraps JSX usages in `<solid-island>` or `<solid-client>`
- injects `data-id`, `data-props`, and `data-file` in dev
- keeps SSR children for islands, emits empty wrappers for clients
- injects `serialize` from `seroval`
- refreshes Babel bindings after client wrappers remove their original JSX usage

### TypeScript and Solid presets

- strips types with `@babel/preset-typescript`
- compiles Solid with `babel-preset-solid`
- uses `generate: "ssr"` or `generate: "dom"`
- keeps `hydratable: false`, so client islands re-render rather than hydrate existing DOM

## Island ID System

`src/island-id.ts`:

- `toStableKey(file, rootDir)`: canonical relative path, or absolute fallback when outside root
- `islandIdFromFile(file, rootDir)`: MD5 of the stable key, truncated to 12 chars
- path normalization is cross-platform and symlink-aware

`src/island-resolve.ts`:

- resolves relative, absolute, and tsconfig-alias island/client imports
- appends `.tsx` when missing
- emits actionable resolution errors

## Adapter System

Shared helpers live in `src/adapter/utils.ts`:

| Utility | Purpose |
|---|---|
| `normalizeBasePath()` | validate and normalize `basePath` |
| `toSsrPath()` | derive the public SSR asset path |
| `getSsrDir()` | derive the filesystem `_ssr` directory |
| `getCacheHeaders()` | dev/prod cache policy |
| `createAssetResponse()` | validate and stream BunFile-backed JavaScript/source-map responses |
| `safePath()` | reject path traversal |
| `getReloadId()` / `createPingResponse()` | identify the current dev-server generation |
| `createReloadStream()` / `createReloadResponse()` | SSE live reload |

### Hono adapter

- `createSSRHandler(html)` returns the `ssr()` tuple helper
- page handlers return a synchronous render function or a `Response`
- assets are returned as `Bun.file`-backed responses without eager `arrayBuffer()` reads
- `routes(config)` is intentionally relative and is mounted by the host app
- when using `basePath`, the feature app is typically mounted under `config.basePath`, while SSR routes remain mounted inside that app at `/_ssr`
- v0.9.0 intentionally rejects direct JSX handler results; this keeps JSX evaluation inside `renderToString()` so Solid SSR context is available

### Bun adapter

- owns absolute route keys directly
- must use `config.ssrPath` for asset and dev endpoints

### Elysia adapter

- uses the same BunFile-backed response helper as Hono and Bun
- must use `config.ssrPath` as the public prefix

### Asset caching

- production URLs use `/_ssr/<build-timestamp>/<filename>` (with the configured base path); files remain flat in `_ssr/` on disk
- all relative module imports inherit this version directory, including lazy chunks that import an entry; never version only entry imports with a query string
- all adapters serve only the current version; production JavaScript and source maps are immutable
- development `chunk-<hash>.js` files are immutable because their names are content-addressed
- stable development entries and maps use `no-cache`, `ETag`, and `Last-Modified`
- conditional development requests return `304` without reading the file body

### Development reload

- each server process generates one reload ID and exposes it through the initial SSE event and ping response
- a fresh document publishes its current reload ID so stale tabs reload without making the fresh document loop
- Web Locks elect one visible SSE owner per origin and SSR path; unsupported browsers retain visibility-scoped per-tab streams
- `visibilitychange` and `pagehide` release streams, retries, pending lock requests, and heartbeat work
- `pageshow` restores participation after a back-forward cache restore
- reconnect polling is single-flight, abortable, and uses bounded exponential backoff
- Bun, Hono, and Elysia forward the request abort signal so disconnected streams release server heartbeat timers

## File Map

```text
packages/ssr-core/src/
├── index.ts
├── build.ts
├── transform.ts
├── island-id.ts
├── island-resolve.ts
└── adapter/
    ├── utils.ts
    ├── hono.ts
    ├── bun.ts
    ├── elysia.ts
    └── client.js
```
