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

  it("uses a distinct bundle identifier, product name, and window title", () => {
    expect(smoke.identifier).not.toBe(production.identifier);
    expect(smoke.productName).not.toBe(production.productName);
    expect(smoke.app.windows[0]?.title).not.toBe(production.app.windows[0]?.title);
  });

  it("resolves to a separate macOS application-data directory", () => {
    const dataDir = (identifier: string) =>
      `/Users/tester/Library/Application Support/${identifier}`;
    expect(dataDir(smoke.identifier)).not.toBe(dataDir(production.identifier));
  });
});
