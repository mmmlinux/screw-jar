// Builds index.html: bundles src/main.js (three.js, Rapier and the app) and inlines it into
// src/index.src.html, so the page is one self-contained file.
import { build } from "esbuild";
import { readFileSync, writeFileSync } from "node:fs";

const out = await build({
  entryPoints: ["src/main.js"], bundle: true, format: "iife", minify: true,
  target: "es2020", write: false, logLevel: "warning",
});
const js = out.outputFiles[0].text.replaceAll("</script", "<\\/script");
const html = readFileSync("src/index.src.html", "utf8").replace("<script>/*BUNDLE*/</script>", () => `<script>${js}</script>`);
writeFileSync("index.html", html);
console.log(`index.html: ${(html.length / 1e6).toFixed(2)} MB`);
