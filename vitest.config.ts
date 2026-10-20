import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config.js";

// A standalone vitest.config.ts replaces vite.config.ts entirely, so merge the
// app config back in: test files need the React plugin and the
// __WP03_PREVIEW_BUILD__ define. The environment stays per-file via
// `// @vitest-environment happy-dom` docblocks so Node-only suites keep their
// node: builtins instead of being browser-externalized.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      include: ["tests/**/*.{test,spec}.{ts,tsx}"],
      exclude: [
        "node_modules/**",
        ".ekko-tmp/**",
        ".eco-tmp/**",
        ".ecko-tmp/**",
        ".claude/**",
        ".git/**",
        "dist/**",
        "artifacts/**",
      ],
      env: {
        NODE_ENV: "test",
      },
      isolate: true,
    },
  }),
);
