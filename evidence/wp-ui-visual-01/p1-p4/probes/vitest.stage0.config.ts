import { defineConfig } from "vitest/config";

// Stage-0 read-only probe runner. Deliberately does NOT merge the product
// vitest config (mergeConfig concatenates `include`), so only the probes below
// run and the product suites / src / tests are untouched:
//   npx vitest run --config evidence/wp-ui-visual-01/p1-p4/probes/vitest.stage0.config.ts
export default defineConfig({
  test: {
    include: ["evidence/wp-ui-visual-01/p1-p4/probes/**/*.probe.test.ts"],
    environment: "node",
    env: { NODE_ENV: "test" },
    isolate: true,
  },
});
