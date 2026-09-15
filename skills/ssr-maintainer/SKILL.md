---
name: ssr-maintainer
description: Maintain and develop @k2b/ssr, the SolidJS islands SSR framework for Bun. Use when modifying ssr-core internals such as the build pipeline, Babel transform, island ID system, adapters, hydration/runtime behavior, or tests, and when reviewing framework-level changes in packages/ssr-core.
---

# @k2b/ssr Maintainer Guide

Use this skill for framework-internal work in `packages/ssr-core`.

The canonical package is `@k2b/ssr` in `k2b-dev/ssr`. The deprecated
`@valentinkolb/ssr` package is retained only as an installable migration source
and must not receive new framework releases.

## Repo Shape

- `packages/ssr-core`: published library
- `packages/ssr-example`: reference Hono app

Core commands:

```bash
bun run test
bun run build:example
bun run dev:example
```

## Read These When Needed

- Architecture, build flow, adapter model: [references/architecture.md](references/architecture.md)
- Test inventory and patterns: [references/testing.md](references/testing.md)

## Key Invariants

- `.island.tsx` and `.client.tsx` must use default exports
- nested island/client imports are unsupported and should stay treated as invalid usage
- props must be `seroval`-serializable; this is broader than plain JSON but still excludes functions, callbacks, event handlers, Solid signals/stores, DOM nodes, and arbitrary class instances
- Since v0.9.0, `html()` and `ssr()` must keep JSX creation inside synchronous render functions so Solid SSR context exists for primitives like `createUniqueId()`
- `_ssr/` is the filesystem artifact boundary; the public HTTP path is derived separately via `config.ssrPath`
- island IDs must stay stable for the same source path; cache busting uses a build timestamp directory shared by all production modules, not entry-only queries or content hashes
- dev overlay/highlighting depends on `data-file` in dev mode and on the wrapper tags remaining present in SSR output
- `@k2b/ssr/nav` must remain an opt-in progressive navigation helper, not a router with route matching, loaders, or server re-rendering

## v0.9.0 Migration Note

This release intentionally breaks the pre-v0.9.0 direct-JSX page API.

```tsx
// before v0.9.0
export default ssr(async () => <Page />);
app.get("/", () => html(<Page />));
```

Must become:

```tsx
// v0.9.0+
export default ssr(async () => () => <Page />);
app.get("/", () => html(() => <Page />));
```

The render function must be synchronous. Async work belongs in the request handler before returning `() => <Page />`.

## Adapter Guidance

When adding or changing an adapter:

1. Keep file serving rooted at `getSsrDir(config)`.
2. Respect `config.ssrPath` for adapters that own absolute public paths, such as Bun and Elysia.
3. For Hono, keep `routes(config)` relative so it can be mounted as a sub-app under `/_ssr` or under a feature app that itself is mounted under `config.basePath`.
4. Dev mode must expose reload and ping endpoints on the same SSR public path.
5. Always use `safePath()` for requested asset filenames.
6. Add/update tests for both default root behavior and `basePath` behavior when relevant.
7. Keep dev reload SSE visibility-scoped and cross-tab coordinated: hidden or page-cached tabs must close streams and retries, Web Locks elect one visible stream owner per origin and SSR path, browsers without Web Locks retain a visibility-scoped per-tab fallback, and `pageshow` restores participation.
8. Keep reconnect polling single-flight with bounded backoff, and clean server heartbeat timers on stream cancel or request abort.

## Transform Guidance

`src/transform.ts` performs two operations in one Babel pass:

- the SSR-only wrapper plugin replaces island/client JSX usages
- TypeScript stripping and Solid compilation run as presets with `generate: "ssr"` or `"dom"`

When modifying it:

- test `transform()` directly in SSR and DOM modes
- verify the `serialize` import and `__seroval_serialize` alias behavior
- verify `data-id`, `data-props`, and dev-only `data-file`
- check islands preserve SSR children while clients emit empty wrappers

## Bun-Specific Caveats

- `dedupeSharedChunkExports()` is a production-only workaround for Bun shared-chunk duplicate exports
- `import(\`${path}?\`)` is required for Bun watch registration
- `ensureIslands()` still needs the `build.onLoad` fallback because `Bun.plugin()` does not reliably provide `onStart`

## Nav Guidance

When changing `src/nav.ts`:

- keep top-level code SSR-safe; browser globals may be used only inside event handlers or helper calls
- keep `Link` rendering a real `<a href>` during SSR
- preserve normal browser behavior for modifier keys, non-left clicks, downloads, and external targets
- keep `nav.push()` state reconciliation explicit through `listenPopState()`; do not add route matching
- test history push/replace, Back/Forward reconciliation, hash links, async fallbacks, reactive props, Solid bound handlers, scroll snapshots, and SSR anchor output
- run both `test/unit` and the browser-conditioned `test/browser` suite
