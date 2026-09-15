# Testing Reference

## Test Runner

Run from repo root:

```bash
bun run test
```

Or from `packages/ssr-core`:

```bash
bun test test/unit/build.test.ts
bun test --conditions=browser --preload ./test/browser/setup.ts test/browser
bunx tsc -p test/tsconfig.json
```

## Test Files

Unit tests live in `packages/ssr-core/test/unit/`:

| File | Focus |
|---|---|
| `index.test.ts` | `createConfig()`, HTML generation, basePath behavior, dev reload config |
| `build.test.ts` | island bundling, dedup, monorepo discovery |
| `transform.test.ts` | wrapper injection, seroval behavior |
| `island-id.test.ts` | ID stability |
| `island-resolve.test.ts` | relative and alias import resolution |
| `hono.test.ts` | `createSSRHandler`, middleware ordering, mounted Hono behavior |
| `utils.test.ts` | basePath normalization, cache headers, safePath, reload stream lifecycle |
| `production-assets.test.ts` | Production module graph, lazy imports, version paths, and real HTTP through all three adapters |
| `adapter-paths.test.ts` | Bun/Elysia SSR public paths |
| `nav.test.ts` | opt-in navigation helpers, history, scroll preservation, SSR anchor output |
| `hash.test.ts` | hash determinism |

Browser-conditioned tests live in `packages/ssr-core/test/browser/`:

| File | Focus |
|---|---|
| `nav.browser.test.ts` | reactive links, native click behavior, async fallback, view transitions |
| `client-reload.browser.test.ts` | visibility lifecycle, retry cancellation, stale reload IDs, Web Locks contention and leadership handoff |

`setup.ts` registers Happy DOM globals for the browser-conditioned suite.

## Patterns

- use temp directories for filesystem tests
- clean them up in `afterEach`
- exercise both dev and prod branches where behavior differs
- when adapter behavior changes, verify both default root routing and `basePath` routing
- for request/response tests, prefer real app instances over mocking route handlers
- for reload coordination, test separate browser realms against one shared lock manager rather than asserting a single tab in isolation

The example build sets `NODE_ENV=production` before Bun starts. Setting it inside the build script is too late for Bun’s build-time environment replacement.
