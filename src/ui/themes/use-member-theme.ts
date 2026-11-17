import { useState } from "react";
import { readThemePreference, type ThemeId, writeThemePreference } from "./theme-preference.js";

export function useMemberTheme() {
  const [preference, setPreference] = useState(readThemePreference);

  function setDemoMember(demoMember: boolean) {
    setPreference((current) => {
      const themeId = writeThemePreference(demoMember ? current.themeId : "default", demoMember);
      return { themeId, demoMember };
    });
  }

  function applyTheme(themeId: ThemeId) {
    setPreference((current) => {
      if (themeId !== "default" && !current.demoMember) return current;
      const applied = writeThemePreference(themeId, current.demoMember);
      return { themeId: applied, demoMember: current.demoMember };
    });
  }

  return {
    themeId: preference.themeId,
    demoMember: preference.demoMember,
    setDemoMember,
    applyTheme,
  };
}
