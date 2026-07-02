import { resolve } from "node:path";
import { defineConfig } from "vite";

const srcRoot = resolve(__dirname, "src");

export default defineConfig({
  root: srcRoot,
  publicDir: resolve(__dirname, "public"),
  build: {
    outDir: resolve(__dirname, "dist"),
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        popup: resolve(srcRoot, "popup.html"),
        options: resolve(srcRoot, "options.html"),
        background: resolve(srcRoot, "background/service-worker.ts")
      },
      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === "background") {
            return "background/service-worker.js";
          }

          return "assets/[name]-[hash].js";
        },
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]"
      }
    }
  }
});
