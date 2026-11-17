/**
 * Illustrative member skins. Set this to false to hide「主题皮肤」and leave
 * the shell on the existing M2 palette. There is no account or payment.
 */
export const MEMBER_THEME_SKINS_ENABLED = true;

export const THEME_STORAGE_KEY = "xqj.member-theme";
export const DEMO_MEMBER_STORAGE_KEY = "xqj.member-theme.demo-member";

export const THEME_IDS = ["default", "cute-cat", "cute-dog", "pixel"] as const;
export type ThemeId = (typeof THEME_IDS)[number];

export type ThemeSkin = {
  id: ThemeId;
  name: string;
  memberOnly: boolean;
  blurb: string;
};

export const THEME_SKINS: readonly ThemeSkin[] = [
  {
    id: "default",
    name: "默认",
    memberOnly: false,
    blurb: "暖米底、深青字、薄荷绿强调",
  },
  {
    id: "cute-cat",
    name: "可爱猫咪",
    memberOnly: true,
    blurb: "奶油粉底色，猫爪和圆耳朵",
  },
  {
    id: "cute-dog",
    name: "可爱小狗",
    memberOnly: true,
    blurb: "蜂蜜黄底色，小爪印点缀",
  },
  {
    id: "pixel",
    name: "像素风",
    memberOnly: true,
    blurb: "小镇像素描边和方块阳光",
  },
];

function isThemeId(value: string | null): value is ThemeId {
  return THEME_IDS.some((id) => id === value);
}

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private mode and blocked storage keep the choice for this visit only.
  }
}

export function readThemePreference(): { themeId: ThemeId; demoMember: boolean } {
  const demoMember = readStorage(DEMO_MEMBER_STORAGE_KEY) === "1";
  const stored = readStorage(THEME_STORAGE_KEY);
  const themeId = isThemeId(stored) ? stored : "default";
  if (!demoMember && themeId !== "default") return { themeId: "default", demoMember };
  return { themeId, demoMember };
}

export function writeThemePreference(themeId: ThemeId, demoMember: boolean): ThemeId {
  const applied = !demoMember && themeId !== "default" ? "default" : themeId;
  writeStorage(THEME_STORAGE_KEY, applied);
  writeStorage(DEMO_MEMBER_STORAGE_KEY, demoMember ? "1" : "0");
  return applied;
}

export function skinGlance(themeId: ThemeId, demoMember: boolean): string {
  const skin = THEME_SKINS.find((item) => item.id === themeId) ?? THEME_SKINS[0];
  if (!skin) return "当前皮肤 · 默认";
  if (demoMember && skin.memberOnly) return `会员皮肤 · ${skin.name}`;
  return `当前皮肤 · ${skin.name}`;
}
