import { mkdirSync } from "fs";
import { plugin } from "../config";

await Bun.build({
  entrypoints: ["src/server.tsx"],
  outdir: "dist",
  target: "bun",
  minify: true,
  plugins: [plugin()],
});

mkdirSync("dist/public", { recursive: true });
await Bun.write("dist/public/global.css", Bun.file("public/global.css"));
await Bun.write("dist/public/favicon.ico", Bun.file("public/favicon.ico"));

console.log("Built src/server.tsx -> dist/server.js");
