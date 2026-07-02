import { resolve } from "node:path";
import { build } from "vite";

await build({
  configFile: false,
  root: resolve("src"),
  publicDir: false,
  build: {
    outDir: resolve("dist"),
    emptyOutDir: false,
    sourcemap: true,
    codeSplitting: false,
    rollupOptions: {
      input: resolve("src/content/content-script.ts"),
      output: {
        entryFileNames: "content/content-script.js",
        format: "iife",
        name: "HoverTransPortContentScript",
        assetFileNames: "assets/[name]-[hash][extname]"
      }
    }
  }
});

console.log("build-content-script-bundle: bundled content script without shared chunks.");
