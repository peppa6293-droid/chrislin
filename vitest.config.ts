import { defineConfig } from "vitest/config";

export default defineConfig({
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
});
