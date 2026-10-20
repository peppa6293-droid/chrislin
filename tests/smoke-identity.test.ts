import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type TauriIdentityConfig = {
  productName: string;
  identifier: string;
  app: { windows: Array<{ title: string }> };
};

function readConfig(path: string): TauriIdentityConfig {
  return JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8")) as TauriIdentityConfig;
}

describe("Smoke application identity", () => {
  const production = readConfig("../src-tauri/tauri.conf.json");
  const smoke = readConfig("../src-tauri/tauri.smoke.conf.json");

  it("isolates the smoke bundle identifier and pins the 小钱家 display name", () => {
    expect(smoke.identifier).not.toBe(production.identifier);
    expect(smoke.productName).toBe("小钱家");
    expect(smoke.app.windows[0]?.title).toBe("小钱家");
  });

  it("resolves to a separate macOS application-data directory", () => {
    const dataDir = (identifier: string) =>
      `/Users/tester/Library/Application Support/${identifier}`;
    expect(dataDir(smoke.identifier)).not.toBe(dataDir(production.identifier));
  });
});
