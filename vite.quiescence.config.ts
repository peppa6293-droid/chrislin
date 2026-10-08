import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  root: "quiescence-web",
  clearScreen: false,
  build: {
    outDir: resolve(process.cwd(), "artifacts/quiescence-ipc-web"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(process.cwd(), "quiescence-web/index.html"),
        disconnected: resolve(process.cwd(), "quiescence-web/disconnected.html"),
      },
    },
  },
});
