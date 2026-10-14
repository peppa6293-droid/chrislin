import { useState } from "react";

export type PixelDestination = "income" | "cash" | "assets" | "debt";

const places: { id: PixelDestination; name: string; subtitle: string; color: string }[] = [
  { id: "income", name: "收入小站", subtitle: "计划与到账", color: "#ec9aaf" },
  { id: "cash", name: "零钱小屋", subtitle: "账户与余额", color: "#77cbb0" },
  { id: "assets", name: "资产花园", subtitle: "更新资产", color: "#9cb6ed" },
  { id: "debt", name: "还款驿站", subtitle: "本月要还多少", color: "#ebc875" },
];

export function PixelWorld({
  onVisit,
  celebrating = false,
}: {
  onVisit: (place: PixelDestination) => void;
  celebrating?: boolean;
}) {
  const [waving, setWaving] = useState(false);
  return (
    <section
      className={`pixel-world ${celebrating ? "pixel-world--saved" : ""}`}
      aria-label="财务小镇"
    >
      <div className="pixel-world-sky" aria-hidden="true">
        <span className="pixel-cloud cloud-a" />
        <span className="pixel-cloud cloud-b" />
        <span className="pixel-sun" />
      </div>
      <div className="pixel-world-label">小钱家 · 日常小镇</div>
      <div className="pixel-world-places">
        {places.map((place) => (
          <button
            key={place.id}
            type="button"
            className={`pixel-place pixel-place--${place.id}`}
            onClick={() => onVisit(place.id)}
            aria-label={place.name}
          >
            <svg
              className="pixel-building"
              viewBox="0 0 64 64"
              shapeRendering="crispEdges"
              aria-hidden="true"
            >
              <path d="M6 58h52v4H6z" fill="#527f72" />
              <path d="M12 28h40v30H12z" fill="#fffaf1" />
              <path
                d="M8 26h48v6H8z M12 20h40v6H12z M18 14h28v6H18z M24 8h16v6H24z"
                fill={place.color}
              />
              <path d="M8 30h4v28H8z M52 30h4v28h-4z M12 54h40v4H12z" fill="#35465e" />
              <path d="M27 39h10v19H27z" fill="#526b87" />
              <path d="M17 35h7v9h-7z M41 35h7v9h-7z" fill="#b9dfef" />
              <path
                d="M19 35h2v9h-2z M43 35h2v9h-2z M17 39h7v2h-7z M41 39h7v2h-7z"
                fill="#526b87"
              />
              <path d="M30 23h4v6h-4z" fill="#fffaf1" />
              <path d="M35 48h2v2h-2z" fill="#ebc875" />
              {place.id === "assets" && (
                <g className="pixel-leaves" fill="#70b889">
                  <path d="M3 42h6v16H3z M0 38h12v7H0z M55 42h6v16h-6z M52 38h12v7H52z" />
                </g>
              )}
              {place.id === "income" && (
                <g className="pixel-sign" fill="#f5d47d">
                  <path d="M29 1h6v7h-6z M27 3h10v3H27z" />
                </g>
              )}
            </svg>
            <strong>{place.name}</strong>
            <span>{place.subtitle}</span>
          </button>
        ))}
      </div>
      <div className="pixel-path" aria-hidden="true" />
      <button
        type="button"
        className={`pixel-friend ${waving ? "is-waving" : ""}`}
        aria-label="和小钱打招呼"
        onClick={() => setWaving((value) => !value)}
      >
        <svg viewBox="0 0 32 40" shapeRendering="crispEdges" aria-hidden="true">
          <path
            d="M10 1h12v3H10z M7 4h18v3H7z M4 7h24v20H4z M7 27h18v7H7z M10 34h12v3H10z"
            fill="#35465e"
          />
          <path d="M7 8h18v18H7z M10 26h12v8H10z" fill="#93d5b6" />
          <path d="M10 5h12v3H10z" fill="#f9dfa0" />
          <path d="M10 15h3v4h-3z M19 15h3v4h-3z" fill="#35465e" />
          <path d="M13 22h6v2h-6z" fill="#35465e" />
          <path d="M7 20h3v3H7z M22 20h3v3h-3z" fill="#f2a4ad" />
          <path d="M7 35h6v4H7z M19 35h6v4h-6z" fill="#35465e" />
          <path className="pixel-friend-hand" d="M26 17h4v9h-4z" fill="#93d5b6" />
        </svg>
      </button>
      {waving && (
        <span className="pixel-friend-speech" role="status">
          你好呀，一次做好一件小事。
        </span>
      )}
      {celebrating && (
        <span className="pixel-save-stamp" aria-hidden="true">
          已记好
        </span>
      )}
    </section>
  );
}
