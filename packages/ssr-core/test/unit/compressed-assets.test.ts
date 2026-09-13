import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brotliCompressSync, brotliDecompressSync, gzipSync, gunzipSync } from "node:zlib";
import { createAssetResponse } from "../../src/adapter/utils";

let directory: string;
const source = "export const answer = 42;\n".repeat(100);
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "ssr-assets-"));
  for (const filename of ["entry.js", "entry.js.map"]) {
    await writeFile(join(directory, filename), source);
    await writeFile(join(directory, `${filename}.br`), brotliCompressSync(source));
    await writeFile(join(directory, `${filename}.gz`), gzipSync(source));
  }
  await writeFile(join(directory, "plain.js"), source);
});
afterAll(() => rm(directory, { recursive: true, force: true }));

const get = (encoding = "", filename = "entry.js", method = "GET", dev = false) =>
  createAssetResponse(new Request(`http://localhost/_ssr/${filename}`, {
    method, headers: { "Accept-Encoding": encoding },
  }), directory, filename, dev);

test.each([
  ["br, gzip", "br"], ["gzip", "gzip"], ["br;q=0, gzip", "gzip"],
  ["br;q=0.5, gzip;q=0.9, identity;q=0", "gzip"], ["*", "br"],
  ["", null], ["br;q=0, gzip;q=0", null], ["identity;q=1, br;q=0.5", null],
])("negotiates %s without changing decoded JavaScript", async (accept, encoding) => {
  const response = await get(accept!);
  expect(response.headers.get("Content-Encoding")).toBe(encoding);
  expect(response.headers.get("Vary")).toBe("Accept-Encoding");
  expect(response.headers.get("Content-Type")).toBe("application/javascript");
  const bytes = Buffer.from(await response.arrayBuffer());
  expect(Number(response.headers.get("Content-Length"))).toBe(bytes.length);
  expect((encoding === "br" ? brotliDecompressSync(bytes) : encoding === "gzip" ? gunzipSync(bytes) : bytes).toString()).toBe(source);
});

test("falls back only to acceptable existing representations", async () => {
  expect((await get("br, gzip", "plain.js")).headers.get("Content-Encoding")).toBeNull();
  expect((await get("br, identity;q=0", "plain.js")).status).toBe(406);
  expect((await get("*;q=0")).status).toBe(406);
  expect((await get("br", "missing.js")).status).toBe(404);
  expect((await get("br", "entry.js.br")).status).toBe(404);
});

test("HEAD uses the selected representation headers without a body", async () => {
  const response = await get("br", "entry.js.map", "HEAD");
  expect(response.headers.get("Content-Encoding")).toBe("br");
  expect(response.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
  expect(response.body).toBeNull();
});

test("development ignores stale compressed siblings and retains validators", async () => {
  const response = await get("br", "entry.js", "GET", true);
  expect(response.headers.get("Content-Encoding")).toBeNull();
  expect(await response.text()).toBe(source);
  const cached = await createAssetResponse(new Request("http://localhost/_ssr/entry.js", {
    headers: { "If-None-Match": response.headers.get("ETag")!, "Accept-Encoding": "br" },
  }), directory, "entry.js", true);
  expect(cached.status).toBe(304);
});
