import { createConfig } from "@k2b/ssr";
import { createSSRHandler, routes } from "@k2b/ssr/hono";

type PageOptions = {
  title?: string;
  description?: string;
};

export const { config, plugin, html } = createConfig<PageOptions>({
  dev: process.env.NODE_ENV === "development",
  verbose: false,
  rootDir: import.meta.dir,
  template: ({ body, scripts, title, description }) => `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="view-transition" content="same-origin">
    <title>${title ?? "SSR Example"}</title>
    <meta name="description" content="${description ?? "Hono + Solid islands example"}">
    <link rel="icon" href="/public/favicon.ico">
    <link rel="stylesheet" href="/public/global.css">
  </head>
  <body>
    ${body}
    ${scripts}
  </body>
</html>`,
});

export const ssr = createSSRHandler(html);
export { routes };
