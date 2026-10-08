import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  root: "v4-acceptance-web",
  plugins: [react()],
  clearScreen: false,
  build: {
    outDir: resolve(process.cwd(), "artifacts/v012-v4-owner-acceptance-sandbox-20261007/web-dist"),
    emptyOutDir: true,
  },
});
