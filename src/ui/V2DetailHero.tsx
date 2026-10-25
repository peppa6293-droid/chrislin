import type { ReactNode } from "react";
import { V2StatusBadge } from "./V2StatusBadge.js";

/** Shared detail template (§8): one question, one conclusion, one visual. */
export function V2DetailHero({
  question,
  badge,
  badgeTone = "success",
  aside,
  children,
}: {
  question: string;
  badge?: string;
  badgeTone?: "success" | "warn" | "danger" | "neutral";
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="v2-detail-hero">
      <header className="v2-detail-hero__head">
        <p className="v2-detail-question">{question}</p>
        {aside}
      </header>
      {badge && <V2StatusBadge tone={badgeTone}>{badge}</V2StatusBadge>}
      <div className="v2-detail-visual">{children}</div>
    </section>
  );
}

export function V2EvidenceGrid({ children }: { children: ReactNode }) {
  return <div className="v2-evidence-grid">{children}</div>;
}

export function V2EvidenceCard({
  label,
  value,
  tone = "normal",
}: {
  label: string;
  value: ReactNode;
  tone?: "normal" | "teal" | "coral" | "yellow";
}) {
  return (
    <div className={`v2-evidence-card v2-evidence-card--${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function V2HowCalculated({
  title = "怎么算的",
  children,
}: {
  title?: string;
  children: ReactNode;
}) {
  return (
    <details className="v2-detail-technical">
      <summary>{title}</summary>
      <div>{children}</div>
    </details>
  );
}
