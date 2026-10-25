import type { ReactNode } from "react";

export function V2StatusBadge({
  tone = "success",
  children,
}: {
  tone?: "success" | "warn" | "danger" | "neutral";
  children: ReactNode;
}) {
  const modifier = tone === "success" ? "" : ` v2-badge--${tone}`;
  return <span className={`v2-badge${modifier}`}>{children}</span>;
}
