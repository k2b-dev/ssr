import { describe, expect, test } from "bun:test";
import { createConfig } from "../../src/index";

describe("createConfig() cache busting", () => {
  test("versions the production module directory", async () => {
    const { html } = createConfig({ dev: false });
    const response = await html(() => "content" as any);
    const output = await response.text();

    expect(output).toContain("<style>solid-client,solid-island{display:contents}</style>");
    expect(output).toMatch(/const p="\/_ssr\/\d+"/);
    expect(output).toContain("import(p+'/'+e.dataset.id+'.js')");
  });

  test("keeps hydration imports unversioned in dev mode", async () => {
    const { html } = createConfig({ dev: true });
    const response = await html(() => "content" as any);
    const output = await response.text();

    expect(output).toContain('const p="/_ssr"');
    expect(output).not.toContain("?v=");
  });

  test("uses basePath for hydration imports and dev config", async () => {
    const { html } = createConfig({ dev: true, basePath: "/docs" });
    const response = await html(() => "content" as any);
    const output = await response.text();

    expect(output).toContain('const p="/docs/_ssr"');
    expect(output).toMatch(
      /globalThis\.__SSR_CONFIG=\{"ssrPath":"\/docs\/_ssr","reloadId":"[0-9a-f-]{36}"\}/,
    );
  });

  test("normalizes trailing slashes in basePath", async () => {
    const { html } = createConfig({ dev: false, basePath: "/docs/" });
    const response = await html(() => "content" as any);
    const output = await response.text();

    expect(output).toMatch(/const p="\/docs\/_ssr\/\d+"/);
  });

  test("rejects invalid basePath values", () => {
    expect(() => createConfig({ basePath: "docs" })).toThrow(/basePath must start with "\/" or be empty/);
  });

  test("rejects async render functions", async () => {
    const { html } = createConfig({ dev: false });

    await expect(html(async () => "content" as any)).rejects.toThrow(
      "html() expects a synchronous render function",
    );
  });
});
