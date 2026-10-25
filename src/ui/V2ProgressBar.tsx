export function V2ProgressBar({
  value,
  max = 100,
  tone = "normal",
  large = false,
  showEnd = false,
  label,
}: {
  value: number;
  /** Visual ceiling; over-target values keep their numeric label above this width. */
  max?: number;
  tone?: "normal" | "warn" | "over";
  large?: boolean;
  showEnd?: boolean;
  label?: string;
}) {
  const clamped = Math.min(max, Math.max(0, value));
  const modifier = tone === "normal" ? "" : ` v2-progress--${tone}`;
  return (
    <div
      className={`v2-progress${large ? " v2-progress--large" : ""}${modifier}`}
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={Math.round(max)}
      aria-valuetext={`${Math.round(value)}%`}
    >
      <span className="v2-progress__fill" style={{ width: `${clamped}%` }} />
      {showEnd && clamped > 0 && (
        <span className="v2-progress__end" style={{ left: `${clamped}%` }} aria-hidden="true" />
      )}
    </div>
  );
}
