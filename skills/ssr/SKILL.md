---
name: ssr
description: Build apps with @k2b/ssr, the minimal SolidJS islands SSR framework for Bun. Use when creating pages, islands, client components, templates, opt-in @k2b/ssr/nav progressive navigation, or adapter setup with Hono, Bun, or Elysia, and when troubleshooting SSR asset loading, source maps, caching, dev reload connections, serialization, client re-render behavior, island error fallbacks, or enhanced same-origin links.
---

# @k2b/ssr User Guide

Use this skill when building with `@k2b/ssr`.

`@k2b/ssr` replaces the deprecated `@valentinkolb/ssr` package. The API and
subpaths are unchanged; migrate dependencies and imports by replacing the
scope.

## Quick Start

### Config

```ts
import { createConfig } from "@k2b/ssr";
import { createSSRHandler, routes } from "@k2b/ssr/hono";

type PageOptions = {
  title?: string;
  description?: string;
};

export const { config, plugin, html } = createConfig<PageOptions>({
  dev: process.env.NODE_ENV === "development",
  rootDir: import.meta.dir,
  template: ({ body, scripts, title, description }) => `<!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>${title ?? "App"}</title>
      ${description ? `<meta name="description" content="${description}">` : ""}
    </head>
    <body>${body}${scripts}</body>
  </html>`,
});

export const ssr = createSSRHandler(html);
export { routes };
```

### Hono server

```ts
import { Hono } from "hono";
import { config, routes } from "../config";
import Home from "./components/Home";

export default new Hono()
  .route("/_ssr", routes(config))
  .get("/", ...Home);
```

### Dev preload

```ts
import { plugin } from "../config";

Bun.plugin(plugin());
```

### Production build

```ts
import { plugin } from "../config";

await Bun.build({
  entrypoints: ["src/server.tsx"],
  outdir: "dist",
  target: "bun",
  plugins: [plugin()],
});
```

## Component Conventions

| Extension | Behavior |
|---|---|
| `*.island.tsx` | server-rendered, then client re-rendered |
| `*.client.tsx` | client-only wrapper, no SSR HTML body |
| `*.tsx` | server-only |

Rules:

- use `export default` for islands and client components
- props must be `seroval`-serializable
- do not nest island/client imports inside other island/client components

`seroval` supports more than JSON, including values like `Date`, `RegExp`, `Map`, and `Set`, but still excludes functions, DOM nodes, and arbitrary class instances.

## Island Prop Boundary

Island and client component props cross a server-to-browser serialization boundary.

Do not pass functions, callbacks, event handlers, Solid signals/stores, DOM nodes, or class instances as props to `*.island.tsx` or `*.client.tsx` components. Props are serialized with `seroval`, so these values will fail at render time.

Bad:

```tsx
<Counter onChange={(value) => save(value)} />
```

Good:

```tsx
<Counter initial={count} />
```

Put interactive behavior inside the island/client component. For server effects, pass serializable data such as IDs, URLs, action names, or initial state, then call an API route, submit a form, or update client state from inside the island.

## Island Error Boundaries

Every island and client component instance is mounted in its own error boundary by default. Do not add a root `ErrorBoundary` to each island just for protection.

- an error while mounting, deserializing props, or in a later reactive update replaces only that instance with `<div role="alert" data-ssr-error>` and a **Try again** button
- other instances and other islands updated by the same signal write keep working
- **Try again** (or `reset()`) remounts the component with fresh state from the same `data-props`
- each caught error dispatches a bubbling, cancelable `ssr:island-error` event on the wrapper element with `detail: { error, id, reset }`, then calls `reportError(error)` unless a listener called `preventDefault()`
- `preventDefault()` only suppresses the report; use it when the app sends errors to its own reporter
- style the default fallback through `[data-ssr-error]`
- for localized or branded fallbacks, set `createConfig({ errorFallback: "./src/IslandError.tsx" })`; its default export receives `IslandErrorProps` (`{ error, reset }`) from `@k2b/ssr`; if it throws, the default fallback is used
- boundaries inside a component still take precedence; errors thrown directly in event handlers or async callbacks outside a Solid computation remain normal uncaught errors

```tsx
import type { IslandErrorProps } from "@k2b/ssr";

export default function IslandError(props: IslandErrorProps) {
  return (
    <p role="alert">
      Could not load this section. <button type="button" onClick={props.reset}>Retry</button>
    </p>
  );
}
```

## Pages

`ssr()` page handlers return a synchronous render function, not already-created JSX:

```tsx
export default ssr(async (c) => {
  c.get("page").title = "Home";
  const data = await loadData();

  return () => <Home data={data} />;
});
```

Use the handler body for async work, redirects, and page metadata. Keep JSX creation inside the returned render function so Solid SSR primitives such as `createUniqueId()` run inside `renderToString()`.

### v0.9.0 Breaking Change

For migrations, check for the old direct-JSX style from v0.8.x and earlier:

```tsx
// before v0.9.0
export default ssr(async () => <Page />);
app.get("/", () => html(<Page />));
```

Convert it to render functions:

```tsx
// v0.9.0+
export default ssr(async () => () => <Page />);
app.get("/", () => html(() => <Page />));
```

Do async data loading before the returned render function:

```tsx
export default ssr(async (c) => {
  const data = await loadData();
  return () => <Page data={data} />;
});
```

Do not return an async render function. The render function is called by `renderToString()` and must synchronously create JSX.

## `createConfig()` Options

```ts
createConfig({
  dev?: boolean;
  verbose?: boolean;
  rootDir?: string;
  componentRoots?: readonly string[];
  basePath?: string;
  external?: string[];
  devSourcemap?: "none" | "linked" | "inline";
  errorFallback?: string;
  template?: ({ body, scripts, ...custom }) => string | Promise<string>;
})
```

Notes:

- keep `rootDir` as the stable ID and asset base; use `componentRoots` to select app and shared framework source directories without scanning sibling apps
- explicit `componentRoots` replace the default scan; relative paths resolve against `rootDir`, absolute package paths are supported, `[]` selects nothing, and missing paths fail
- ordinary UI libraries with browser/SSR exports are bundled through imports and need no discovery root; explicitly select only packages that ship island/client source files
- `basePath` moves SSR asset URLs and dev endpoints under that public prefix
- `errorFallback` optionally points to a fallback module relative to `rootDir`; islands are protected without it
- development builds use linked source maps by default; use `devSourcemap: "inline"` only for tools that require embedded maps
- stable development entries and source maps revalidate; content-hashed chunks and all production assets use immutable caching
- production module URLs use a build timestamp directory under `config.ssrPath`; relative imports retain the same version, and adapters reject other versions
- `html()` accepts a synchronous render function: `html(() => <Page />)`
- `html()` always injects framework assets, including the SSR loader and wrapper styling

## Hono and `basePath`

For ordinary apps at the site root:

```ts
new Hono().route("/_ssr", routes(config));
```

For a feature app mounted under `/docs`:

```ts
const { config } = createConfig({ basePath: "/docs" });

const docsApp = new Hono()
  .route("/_ssr", routes(config))
  .get("/", ...Home);

export default new Hono().route("/docs", docsApp);
```

The important invariant is that `config.basePath` must match the host mount path of the feature app.

## Other Adapters

- Hono: `@k2b/ssr/hono`
- Bun: `@k2b/ssr/bun`
- Elysia: `@k2b/ssr/elysia`

For Bun and Elysia, the adapter uses `config.ssrPath` internally, so `basePath` does not require extra manual route wiring.

## Development Reload

With `dev: true`, the framework injects its development overlay and watches the
adapter's `_reload` endpoint for server restarts. No additional setup is needed
beyond mounting the adapter routes.

- hidden tabs and page-cached documents close their reload stream and retry work
- browsers with Web Locks keep one visible SSE owner per origin and SSR path
- leadership transfers when the owner becomes hidden or leaves the page
- `pageshow` restores participation after a back-forward cache restore
- browsers without Web Locks use visibility-scoped per-tab streams as a compatibility fallback
- disabling **Auto reload** in the overlay closes the stream for that tab

## Optional `@k2b/ssr/nav`

Use `@k2b/ssr/nav` only when an island/client component needs progressive same-origin navigation without a document reload.

```tsx
import { onCleanup, onMount } from "solid-js";
import { Link, listenPopState, type LinkNavigateEvent } from "@k2b/ssr/nav";

onMount(() => {
  onCleanup(
    listenPopState(({ url }) => {
      setTab(url.searchParams.get("tab") ?? "alpha");
    }),
  );
});

const openTab = (nav: LinkNavigateEvent) => {
  const tab = nav.url.searchParams.get("tab") ?? "alpha";
  setTab(tab);
  nav.push(`/demo?tab=${tab}`, { scroll: "preserve", state: { tab } });
};

<Link href="/demo?tab=beta" scroll="preserve" onNavigate={openTab}>
  Open beta
</Link>;
```

Rules:

- `Link` is a real SSR-safe `<a href>` and works without JavaScript as a normal link
- this is not a router; do not expect route matching, nested routes, loaders, or server re-rendering
- without `onNavigate`, `Link` keeps native document navigation; `replace` and `scroll` only apply to enhanced clicks
- with `onNavigate`, update island state or load data first, then call `nav.push()`, `nav.replaceWith()`, or `nav.fallback()`
- when using `nav.push()`, subscribe with `listenPopState()` and restore island state from the URL on Back/Forward
- rejected async `onNavigate` callbacks fall back to full document navigation
- same-document hash links retain native scrolling unless `onNavigate` takes ownership
- relative links follow `document.baseURI`; cross-origin `navigate()` calls use full document navigation
- replace navigation preserves existing `history.state` unless an explicit `state` option is provided
- use `data-scroll-preserve="stable-key"` for scroll containers that should keep position
- do not pass `onNavigate` from a server page into an island prop; define navigation callbacks inside the island/client component

## TypeScript Settings

```json
{
  "compilerOptions": {
    "lib": ["ESNext", "DOM"],
    "jsx": "preserve",
    "jsxImportSource": "solid-js",
    "moduleResolution": "bundler"
  }
}
```

## Common Pitfalls

- missing `rootDir` in a monorepo leads to missing island discovery
- missing SSR route mounting leads to 404s for island chunks
- placing `${scripts}` outside the rendered HTML body can break client loading
- returning direct JSX from `ssr()` is invalid; return `() => <Page />`
- passing callbacks or event handlers as island/client props fails because props must be serialized
- treating `@k2b/ssr/nav` as a full router leads to stale server data; it only enhances anchors after client state is handled
- using `nav.push()` without reconciling `popstate` leaves island state stale after Back/Forward; use `listenPopState()`
- importing server-only modules into islands or client components can break browser bundling
- named exports for islands/clients are not supported
- calling `reset()` synchronously inside an `ssr:island-error` listener retries before the fallback has rendered; keep `reset` for a later user action or retry
