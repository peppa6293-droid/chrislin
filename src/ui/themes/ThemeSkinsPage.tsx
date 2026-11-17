import { ChevronLeft } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { skinGlance, THEME_SKINS, type ThemeId, type ThemeSkin } from "./theme-preference.js";

const PREVIEW_NOTE =
  "会员专属。这是短预览，还不能应用到首页和我的财务。勾选「演示：当作会员」后才能使用。这里不付款，也没有账号登录。";

export function ThemeSkinsPage({
  themeId,
  demoMember,
  onDemoMember,
  onApply,
  onBack,
}: {
  themeId: ThemeId;
  demoMember: boolean;
  onDemoMember: (demoMember: boolean) => void;
  onApply: (themeId: ThemeId) => void;
  onBack: () => void;
}) {
  const [previewId, setPreviewId] = useState<ThemeId | null>(null);
  const [notice, setNotice] = useState("");
  const noteRef = useRef<HTMLParagraphElement>(null);
  const preview = THEME_SKINS.find((skin) => skin.id === previewId) ?? null;

  useEffect(() => {
    if (!previewId) return;
    noteRef.current?.scrollIntoView({ block: "center" });
  }, [previewId]);

  function actionLabel(skin: ThemeSkin): string {
    if (skin.id === themeId) return "使用中";
    if (skin.memberOnly && !demoMember) return "看短预览";
    return "应用";
  }

  function choose(skin: ThemeSkin) {
    if (skin.memberOnly && !demoMember) {
      setPreviewId(skin.id);
      setNotice("");
      return;
    }
    if (skin.id !== themeId) {
      onApply(skin.id);
      setNotice(`已应用${skin.name}`);
    } else {
      setNotice(`正在使用${skin.name}`);
    }
    setPreviewId(null);
  }

  return (
    <main className="v2-shell m2-shell">
      <header className="v2-topbar">
        <div className="v2-brand">
          <div>
            <strong>主题皮肤</strong>
          </div>
        </div>
        <div className="v2-topbar-actions">
          <button className="button button-secondary" type="button" onClick={onBack}>
            <ChevronLeft size={17} aria-hidden="true" />
            <span>返回</span>
          </button>
        </div>
      </header>
      <section className="v2-content">
        <div className="v2-page">
          <h1 className="m2-title">主题皮肤</h1>
          <p className="m2-skin-mark m2-page-skin" data-testid="m2-theme-current">
            {skinGlance(themeId, demoMember)}
          </p>
          <label className="m2-theme-demo">
            <input
              type="checkbox"
              checked={demoMember}
              onChange={(event) => {
                onDemoMember(event.target.checked);
                setPreviewId(null);
              }}
            />
            演示：当作会员
          </label>
          <p className="m2-note">
            只保存在这台设备上，用来看看会员皮肤。不是会员账号，也不会付款。
          </p>
          {notice && (
            <p className="m2-banner" role="status">
              {notice}
            </p>
          )}
          <div className="m2-theme-list">
            {THEME_SKINS.map((skin) => (
              <button
                key={skin.id}
                className={skin.id === themeId ? "m2-theme-card is-current" : "m2-theme-card"}
                type="button"
                aria-pressed={skin.id === themeId}
                onClick={() => choose(skin)}
              >
                <span className="m2-theme-card__copy">
                  <span className="m2-theme-card__name">
                    <strong>{skin.name}</strong>
                    {skin.memberOnly && <span className="m2-theme-badge">会员专属</span>}
                  </span>
                  <small>{skin.blurb}</small>
                </span>
                <em>{actionLabel(skin)}</em>
              </button>
            ))}
          </div>
          {preview && (
            <section className="m2-theme-preview" data-theme={preview.id} aria-label="皮肤短预览">
              <p className="m2-theme-lock" role="note" ref={noteRef}>
                {PREVIEW_NOTE}
              </p>
              {preview.id === "pixel" && <span className="pixel-sun" aria-hidden="true" />}
              <p className="m2-skin-mark">{skinGlance(preview.id, true)}</p>
              <div className="v2-card v2-month-card m2-theme-preview__card">
                <span className="v2-card__kicker">本月消费</span>
                <div className="v2-card__value">
                  <strong>¥56.00</strong>
                  <small>本月已花</small>
                </div>
              </div>
              <div className="m2-theme-preview__nav" aria-hidden="true">
                <span>今天</span>
                <span>记录</span>
                <span>进展</span>
                <span>我的财务</span>
              </div>
            </section>
          )}
        </div>
      </section>
    </main>
  );
}
