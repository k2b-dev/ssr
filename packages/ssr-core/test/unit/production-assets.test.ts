import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildIslands } from "../../src/build";
import { islandIdFromFile } from "../../src/island-id";

test("production adapters preserve one module URL through lazy imports", async () => {
  const root = mkdtempSync(join(process.cwd(), ".ssr-production-test-"));
  try {
    const source = join(root, "Counter.island.tsx");
    writeFileSync(source, `
      import { state } from "./state";
      export default function Counter() {
        return <button onClick={async () => { const lazy = await import("./lazy"); state.same = lazy.state === state; }}>Load</button>;
      }
    `);
    writeFileSync(join(root, "state.ts"), "export const state = { same: false };");
    writeFileSync(join(root, "lazy.ts"), 'export { state } from "./state";');
    await buildIslands({ pattern: "**/*.island.tsx", cwd: root, outdir: join(root, "_ssr"), dev: false, verbose: false });
    const id = islandIdFromFile(source, root);
    // A separate process puts Bun.main next to the production _ssr directory.
    const runner = join(root, "server-test.ts");
    const core = resolve(import.meta.dir, "../../src");
    writeFileSync(runner, `
      import { strict as assert } from "node:assert";
      import { Hono } from "hono";
      import { createConfig } from ${JSON.stringify(join(core, "index.ts"))};
      import { routes as honoRoutes } from ${JSON.stringify(join(core, "adapter/hono.ts"))};
      import { routes as bunRoutes } from ${JSON.stringify(join(core, "adapter/bun.ts"))};
      import { routes as elysiaRoutes } from ${JSON.stringify(join(core, "adapter/elysia.ts"))};
      const id = ${JSON.stringify(id)};
      const scanner = new Bun.Transpiler({ loader: "js" });
      for (const basePath of ["", "/docs"]) {
        const { config, html } = createConfig({ basePath });
        const output = await (await html(() => "")).text();
        const loader = output.match(/<script type="module">([^<]+)<\\/script>/)[1];
        let entry;
        new Function("document", "capture", loader.replace("import(", "capture("))(
          { querySelectorAll: () => [{ dataset: { id } }] }, (url) => { entry = url; }
        );
        assert.match(entry, new RegExp("^" + config.ssrPath + "/[0-9]+/" + id + "\\\\.js$"));
        for (const adapter of ["hono", "bun", "elysia"]) {
          const hono = adapter === "hono" ? new Hono().route(config.ssrPath, honoRoutes(config)) : undefined;
          const elysia = adapter === "elysia" ? elysiaRoutes(config) : undefined;
          const server = adapter === "bun"
            ? Bun.serve({ port: 0, routes: bunRoutes(config), fetch: () => new Response(null, { status: 404 }) })
            : Bun.serve({ port: 0, fetch: (request) => hono ? hono.fetch(request) : elysia.fetch(request) });
          try {
            const start = new URL(entry, server.url).href;
            const pending = [start];
            const visited = new Set();
            const files = new Map();
            let dynamicImports = 0;
            while (pending.length) {
              const url = pending.pop();
              if (visited.has(url)) continue;
              visited.add(url);
              const filename = new URL(url).pathname.split("/").pop();
              assert.equal(files.get(filename) ?? url, url, adapter + ": duplicate module identity");
              files.set(filename, url);
              const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
              assert.equal(response.status, 200, adapter + ": " + url);
              assert.equal(response.headers.get("Cache-Control"), "public, max-age=31536000, immutable");
              const code = await response.text();
              for (const item of scanner.scanImports(code)) {
                if (item.kind === "dynamic-import") dynamicImports++;
                if (item.path.startsWith(".")) pending.push(new URL(item.path, url).href);
              }
            }
            assert.ok(dynamicImports > 0, "fixture must exercise lazy loading");
            assert.ok(visited.size > 1, "fixture must exercise splitting");
            for (const path of [config.ssrPath + "/" + id + ".js", config.ssrPath + "/old/" + id + ".js", entry.replace(id + ".js", "extra/" + id + ".js")]) {
              assert.equal((await fetch(new URL(path, server.url), { signal: AbortSignal.timeout(3000) })).status, 404, adapter + ": unexpected alias " + path);
            }
            const head = await fetch(new URL(entry, server.url), { method: "HEAD", signal: AbortSignal.timeout(3000) });
            assert.equal(head.status, 200);
            assert.equal(await head.text(), "");
          } finally {
            await server.stop(true);
          }
        }
      }
      // Elysia schedules a delayed compiler-cache GC timer; all servers are already stopped.
      process.exit(0);
    `);
    const child = Bun.spawn([process.execPath, runner], { stdout: "pipe", stderr: "pipe" });
    const [status, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect({ status, stdout, stderr }).toEqual({ status: 0, stdout: "", stderr: "" });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 20_000);
