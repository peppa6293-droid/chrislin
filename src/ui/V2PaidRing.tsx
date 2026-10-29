const SIZE = 96;
const CENTRE = SIZE / 2;
const RADIUS = 40;
const STROKE = 9;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * Single progress ring for the selected month's paid share.
 * The visible name lives beside the ring; the ring carries the same name plus
 * the number as its accessible label, and never draws an arc without a ratio.
 */
export function V2PaidRing({
  progress,
  percent,
  label,
}: {
  progress: number;
  percent: string | null;
  label: string;
}) {
  const capped = Math.min(1, Math.max(0, progress));
  return (
    <svg
      className="v2-paid-ring"
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      role="img"
      aria-label={percent ? `${label} ${percent}` : label}
    >
      <circle
        className="v2-paid-ring__edge"
        cx={CENTRE}
        cy={CENTRE}
        r={RADIUS - STROKE / 2}
        fill="none"
        strokeWidth={1}
      />
      <circle
        className="v2-paid-ring__edge"
        cx={CENTRE}
        cy={CENTRE}
        r={RADIUS + STROKE / 2}
        fill="none"
        strokeWidth={1}
      />
      <circle
        className="v2-paid-ring__track"
        cx={CENTRE}
        cy={CENTRE}
        r={RADIUS}
        fill="none"
        strokeWidth={STROKE}
      />
      {percent && capped > 0 && (
        <circle
          className="v2-paid-ring__arc"
          cx={CENTRE}
          cy={CENTRE}
          r={RADIUS}
          fill="none"
          strokeWidth={STROKE}
          strokeLinecap="butt"
          strokeDasharray={`${(CIRCUMFERENCE * capped).toFixed(2)} ${CIRCUMFERENCE.toFixed(2)}`}
          transform={`rotate(-90 ${CENTRE} ${CENTRE})`}
        />
      )}
      {percent && (
        <text className="v2-paid-ring__value" x={CENTRE} y={CENTRE} textAnchor="middle">
          {percent}
        </text>
      )}
    </svg>
  );
}
