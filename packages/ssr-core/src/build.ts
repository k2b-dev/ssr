/**
 * Island bundler - discovers *.island.tsx and *.client.tsx files,
 * transforms them for the browser, and outputs chunks to _ssr directory.
 */
import { join, relative, resolve } from "path";
import { Glob } from "bun";
import { readdir, stat, unlink } from "fs/promises";
import { existsSync } from "fs";
import { transform } from "./transform";
import { ISLAND_ID_LENGTH, canonicalFilePath, islandIdFromFile, toStableKey } from "./island-id";

type ComponentType = "island" | "client";

export type DevSourcemap = "none" | "linked" | "inline";

const getComponentType = (path: string): ComponentType => (path.includes(".client.") ? "client" : "island");

const getSelector = (type: ComponentType, id: string) =>
  type === "island" ? `solid-island[data-id="${id}"]` : `solid-client[data-id="${id}"]`;

const fmt = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`);
const GENERATED_ASSET = /^(?:[a-f0-9]{12}|chunk-[a-z0-9]+)\.js(?:\.map)?$/i;

const removeStaleBuildAssets = async (outdir: string, outputs: readonly Bun.BuildArtifact[]): Promise<number> => {
  const current = new Set(outputs.map((output) => resolve(output.path)));
  let removed = 0;

  for await (const file of new Glob("*.js*").scan({ cwd: outdir, absolute: true })) {
    const filename = file.slice(file.lastIndexOf("/") + 1);
    if (!GENERATED_ASSET.test(filename) || current.has(resolve(file))) continue;
    await unlink(file);
    removed += 1;
  }

  return removed;
};

/**
 * Workaround for Bun bundler bug: duplicate export statements in shared chunks
 * when splitting=true. We only run this in production because rewriting chunk
 * source in dev can affect evaluation order in cyclic-sensitive modules.
 */
export const dedupeSharedChunkExports = async (outdir: string, verbose: boolean): Promise<number> => {
  let fixedChunks = 0;
  const chunkGlob = new Glob("chunk-*.js");
  for await (const chunkFile of chunkGlob.scan({ cwd: outdir, absolute: true })) {
    const src = await Bun.file(chunkFile).text();
    // Collect all export blocks and deduplicate.
    const exportRegex = /^export\s*\{[^}]*\}\s*;?\s*$/gm;
    const exportBlocks = [...src.matchAll(exportRegex)].map((m) => m[0]);
    if (exportBlocks.length > 1) {
      // Parse all exported names from all blocks.
      const seenNames = new Set<string>();
      const uniqueBlocks: string[] = [];
      for (const block of exportBlocks) {
        const names =
          block
            .match(/\{([^}]*)\}/)?.[1]
            ?.split(",")
            .map((n) => n.trim())
            .filter(Boolean) ?? [];
        const newNames = names.filter((n) => !seenNames.has(n));
        if (newNames.length > 0) {
          uniqueBlocks.push(`export { ${newNames.join(", ")} };`);
          newNames.forEach((n) => seenNames.add(n));
        }
      }
      // Replace all export blocks with deduplicated ones.
      let fixed = src;
      for (const block of exportBlocks) {
        fixed = fixed.replace(block, "");
      }
      // Append single combined export before any debugId comment.
      const debugIdIdx = fixed.lastIndexOf("//# debugId=");
      const combined = uniqueBlocks.join("\n") + "\n";
      if (debugIdIdx !== -1) {
        fixed = fixed.slice(0, debugIdIdx) + combined + fixed.slice(debugIdIdx);
      } else {
        fixed = fixed.trimEnd() + "\n" + combined;
      }
      await Bun.write(chunkFile, fixed);
      fixedChunks += 1;
      if (verbose) console.log(`  Fixed duplicate exports in ${chunkFile.split("/").pop()}`);
    }
  }
  return fixedChunks;
};

export const buildIslands = async (options: {
  pattern: string;
  outdir: string;
  cwd: string;
  componentRoots?: readonly string[];
  verbose: boolean;
  dev?: boolean;
  devSourcemap?: DevSourcemap;
  external?: string[];
  errorFallback?: string;
}): Promise<void> => {
  const { pattern, outdir, cwd, componentRoots, verbose, dev = false, devSourcemap = "linked", external, errorFallback } = options;
  const resolvedCwd = resolve(cwd);

  const totalStart = performance.now();

  const files = new Set<string>();

  const scanStart = performance.now();
  const visited = new Set<string>();
  const matcher = new Glob(pattern);
  const scan = async (directory: string, scanRoot: string): Promise<void> => {
    const canonical = canonicalFilePath(directory);
    if (visited.has(canonical)) return;
    visited.add(canonical);
    for (const entry of await readdir(canonical, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const path = join(canonical, entry.name);
      const info = entry.isSymbolicLink() ? await stat(path) : entry;
      if (info.isDirectory()) await scan(path, scanRoot);
      else if (info.isFile() && matcher.match(relative(scanRoot, path))) files.add(canonicalFilePath(path));
    }
  };
  for (const root of componentRoots ?? [resolvedCwd]) {
    const scanRoot = canonicalFilePath(resolve(resolvedCwd, root));
    await scan(scanRoot, scanRoot);
  }
  if (verbose) console.log(`Scan: found ${files.size} file(s) in ${fmt(performance.now() - scanStart)}`);

  if (!files.size) {
    if (existsSync(outdir)) await removeStaleBuildAssets(outdir, []);
    if (verbose) console.log("No island/client files found.");
    return;
  }

  // Build component metadata
  const components = [...files].map((componentPath) => {
    const id = islandIdFromFile(componentPath, resolvedCwd);
    const key = toStableKey(componentPath, resolvedCwd);
    const type = getComponentType(componentPath);
    const selector = getSelector(type, id);
    return { path: componentPath, id, key, type, selector };
  });

  // Detect hash collisions and fail fast with actionable diagnostics
  const idMap = new Map<string, typeof components>();
  for (const c of components) {
    if (!idMap.has(c.id)) {
      idMap.set(c.id, []);
    }
    idMap.get(c.id)!.push(c);
  }

  const collisions = [...idMap.entries()].filter(([, items]) => items.length > 1);
  if (collisions.length > 0) {
    const details = collisions
      .map(([id, items]) => {
        const list = items.map((item) => `    - ${item.key} (${relative(resolvedCwd, item.path)})`).join("\n");
        return `  ID ${id}:\n${list}`;
      })
      .join("\n");
    throw new Error(`[ssr] Island ID collision detected. Rename files or adjust roots.\n${details}`);
  }

  // Build all islands together with code splitting
  // This ensures Solid is only bundled once as a shared chunk
  const transformTimings = verbose ? new Map<string, number>() : undefined;
  const bundleStart = performance.now();
  const result = await Bun.build({
    entrypoints: components.map((c) => c.id),
    outdir,
    naming: { entry: "[name].js", chunk: "chunk-[hash].js" },
    target: "browser",
    conditions: ["browser", dev ? "development" : "production"],
    external,
    minify: !dev,
    splitting: true,
    sourcemap: dev ? devSourcemap : "none",
    plugins: [
      {
        name: "solid-islands",
        setup(build) {
          // Core, DOM and store must use the app's Solid copy and the same mode.
          // Explicit exported entries avoid mixing a production core with
          // development store/web modules from the host process conditions.
          build.onResolve({ filter: /^solid-js(?:\/(?:web|store))?$/ }, (args) => {
            const module = args.path === "solid-js" ? "solid" : args.path.slice("solid-js/".length);
            const entry = `${args.path}/dist/${dev ? "dev" : module}.js`;
            return { path: Bun.resolveSync(entry, resolvedCwd) };
          });

          // Resolve component IDs as virtual entrypoints
          build.onResolve({ filter: new RegExp(`^[a-f0-9]{${ISLAND_ID_LENGTH}}$`) }, (args) => ({
            path: args.path,
            namespace: "island",
          }));

          // Generate hydration code for each component
          build.onLoad({ filter: /.*/, namespace: "island" }, (args) => {
            const component = components.find((c) => c.id === args.path);
            if (!component) {
              return { contents: "", loader: "js" };
            }

            return {
              contents: `import{mount}from${JSON.stringify(join(import.meta.dir, "mount.ts"))};import C from${JSON.stringify(component.path)};${errorFallback ? `import F from${JSON.stringify(errorFallback)};` : ""}mount(C,${JSON.stringify(component.selector)}${errorFallback ? ",F" : ""})`,
              loader: "js",
            };
          });

          // Transform TSX/JSX with Solid DOM mode
          build.onLoad({ filter: /\.(tsx|jsx)$/ }, async ({ path }) => {
            const t0 = performance.now();
            // Import with ? suffix to register file with bun --watch
            // Issue: https://github.com/oven-sh/bun/issues/4689
            const contents = await import(`${path}?`, {
              with: { type: "text" },
            });
            const result = {
              contents: await transform(contents.default, path, "dom"),
              loader: "js" as const,
            };
            transformTimings?.set(path, performance.now() - t0);
            return result;
          });
        },
      },
    ],
  });

  if (result.success) {
    const removed = await removeStaleBuildAssets(outdir, result.outputs);
    if (verbose && removed > 0) console.log(`Removed ${removed} stale build asset(s).`);

    if (!dev) {
      await dedupeSharedChunkExports(outdir, verbose);
    } else if (verbose) {
      console.log("Skipped shared-chunk export rewrite in dev mode.");
    }
  }

  if (verbose) {
    console.log(`Bundle: ${fmt(performance.now() - bundleStart)}`);
    for (const c of components) {
      const rel = relative(resolvedCwd, c.path);
      const t = transformTimings?.get(c.path);
      console.log(`  ${rel} -> ${outdir}/${c.id}.js${t != null ? ` (transform: ${fmt(t)})` : ""}`);
    }
  }
  console.log(
    `Built ${files.size} component(s) to ${outdir}/ in ${fmt(performance.now() - totalStart)}${verbose ? " (total)" : ""}`,
  );

  if (!result.success) {
    console.error("Build failed:");
    result.logs.forEach((m) => console.error(`  ${m}`));
  }
};
