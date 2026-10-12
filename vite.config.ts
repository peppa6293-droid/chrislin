import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  define: { __WP03_PREVIEW_BUILD__: "false" },
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: { outDir: "web-dist", emptyOutDir: true },
});
