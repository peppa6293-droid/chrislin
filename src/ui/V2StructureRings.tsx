import { formatCurrency } from "./money-format.js";
import { type RingDatum, structureRings } from "./structure-ring.js";

const SIZE = 240;
const CENTRE = SIZE / 2;
const STROKE = 13;
/** R-J02：分界层比品牌弧每侧再露 2 个 SVG 单位，保证弧/轨之间始终有一条 ≥3:1 的分界线。 */
const BOUNDARY = 4;
const OUTER_RADIUS = 104;
const INNER_RADIUS = 78;
const OUTER_CIRCUMFERENCE = 2 * Math.PI * OUTER_RADIUS;
const INNER_CIRCUMFERENCE = 2 * Math.PI * INNER_RADIUS;

export type RingKey = "essential" | "debt";

function arcProps(datum: RingDatum, circumference: number) {
  if (!datum.available || datum.capped <= 0) return null;
  return {
    strokeDasharray: `${(circumference * datum.capped).toFixed(2)} ${circumference.toFixed(2)}`,
    transform: `rotate(-90 ${CENTRE} ${CENTRE})`,
    // 弧段角度（度，从 12 点顺时针）：只用于给 butt 端面补径向分界线。
    angle: 360 * datum.capped,
  };
}

function Ring({
  datum,
  radius,
  circumference,
  variant,
  selected,
}: {
  datum: RingDatum;
  radius: number;
  circumference: number;
  variant: "outer" | "inner";
  selected: boolean;
}) {
  const arc = arcProps(datum, circumference);
  const halfBand = STROKE / 2 + BOUNDARY / 2;
  const endRadians = arc ? ((arc.angle - 90) * Math.PI) / 180 : 0;
  const endX = Math.cos(endRadians);
  const endY = Math.sin(endRadians);
  return (
    <g className="v2-ring__band" data-ring={variant} data-selected={selected || undefined}>
      <circle
        className="v2-ring__edge"
        cx={CENTRE}
        cy={CENTRE}
        r={radius - STROKE / 2}
        fill="none"
        strokeWidth={1}
      />
      <circle
        className="v2-ring__edge"
        cx={CENTRE}
        cy={CENTRE}
        r={radius + STROKE / 2}
        fill="none"
        strokeWidth={1}
      />
      <circle
        className={`v2-ring__track is-${variant}`}
        cx={CENTRE}
        cy={CENTRE}
        r={radius}
        fill="none"
        strokeWidth={STROKE}
      />
      {arc && (
        <circle
          className={`v2-ring__arc-edge is-${variant}`}
          cx={CENTRE}
          cy={CENTRE}
          r={radius}
          fill="none"
          strokeWidth={STROKE + BOUNDARY}
          strokeLinecap="butt"
          strokeDasharray={arc.strokeDasharray}
          transform={arc.transform}
        />
      )}
      {arc && arc.angle < 359.5 && (
        <>
          {/* butt 端面不得直接贴轨道：两端各补一条径向分界线（半条被品牌弧盖住）。 */}
          <line
            className="v2-ring__arc-end"
            x1={CENTRE}
            y1={CENTRE - radius - halfBand}
            x2={CENTRE}
            y2={CENTRE - radius + halfBand}
          />
          <line
            className="v2-ring__arc-end"
            x1={CENTRE + endX * (radius + halfBand)}
            y1={CENTRE + endY * (radius + halfBand)}
            x2={CENTRE + endX * (radius - halfBand)}
            y2={CENTRE + endY * (radius - halfBand)}
          />
        </>
      )}
      {arc && (
        <circle
          className={`v2-ring__arc is-${variant}`}
          cx={CENTRE}
          cy={CENTRE}
          r={radius}
          fill="none"
          strokeWidth={STROKE}
          strokeLinecap="butt"
          strokeDasharray={arc.strokeDasharray}
          transform={arc.transform}
        />
      )}
    </g>
  );
}

/**
 * Double concentric ring + the two text rows that carry the same numbers.
 * The rows are the primary entry (44px targets, keyboard, aria-pressed); the
 * ring itself is a pointer-only shortcut, so its hit bands stay aria-hidden.
 */
export function V2StructureRings({
  income,
  essentialExpenses,
  mandatoryDebtService,
  pendingDebt,
  selected,
  onToggle,
}: {
  income: string;
  essentialExpenses: string;
  mandatoryDebtService: string;
  pendingDebt: boolean;
  selected: RingKey | null;
  onToggle: (ring: RingKey) => void;
}) {
  const rings = structureRings({
    income,
    essentialExpenses,
    mandatoryDebtService,
    pendingDebt,
  });

  const described: string[] = [];
  if (rings.outer.percent) described.push(`固定支出占收入 ${rings.outer.percent}`);
  if (rings.inner.percent) described.push(`必须偿还月供占收入 ${rings.inner.percent}`);
  if (pendingDebt) described.push("必须偿还月供 待确认");
  // B-02 缺失不补零：没有实际收入时中心印「—」，可访问名称也只说「收入 —」。
  const missingIncome = rings.incomeZero || rings.incomeNegative;
  const label =
    described.length > 0
      ? described.join("，")
      : missingIncome
        ? "收入 —"
        : `收入 ${formatCurrency(income)}`;

  return (
    <div className="v2-structure-overview">
      <div className="v2-ring" data-selected={selected ?? undefined}>
        <svg
          className="v2-ring__chart"
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          role="img"
          aria-label={label}
        >
          <Ring
            datum={rings.outer}
            radius={OUTER_RADIUS}
            circumference={OUTER_CIRCUMFERENCE}
            variant="outer"
            selected={selected === "essential"}
          />
          <Ring
            datum={rings.inner}
            radius={INNER_RADIUS}
            circumference={INNER_CIRCUMFERENCE}
            variant="inner"
            selected={selected === "debt"}
          />
          {/* 圆环只是指针快捷入口：同一动作在下方明细按钮里已有键盘与读屏入口，
              这里保持装饰语义，避免同一操作在辅助技术里出现两遍。 */}
          {/* biome-ignore lint/a11y/noStaticElementInteractions: 装饰性重复入口，见上 */}
          <circle
            className="v2-ring__hit is-outer"
            cx={CENTRE}
            cy={CENTRE}
            r={OUTER_RADIUS}
            fill="none"
            strokeWidth={STROKE + 16}
            onClick={() => onToggle("essential")}
          />
          {/* biome-ignore lint/a11y/noStaticElementInteractions: 装饰性重复入口，见上 */}
          <circle
            className="v2-ring__hit is-inner"
            cx={CENTRE}
            cy={CENTRE}
            r={INNER_RADIUS}
            fill="none"
            strokeWidth={STROKE + 16}
            onClick={() => onToggle("debt")}
          />
        </svg>
        <div className="v2-ring__centre">
          <span className="v2-ring__centre-label">收入</span>
          <strong className="v2-ring__centre-amount">
            {missingIncome ? "—" : formatCurrency(income)}
          </strong>
        </div>
      </div>

      <ul className="v2-ring-rows">
        <li>
          <button
            type="button"
            className="v2-ring-row"
            data-ring="outer"
            aria-pressed={selected === "essential"}
            onClick={() => onToggle("essential")}
          >
            <span className="v2-ring-row__name">固定支出</span>
            <span className="v2-ring-row__value">
              <span className="v2-ring-row__amount">
                {rings.outer.overAmount && (
                  <span className="v2-ring-row__marker" aria-hidden="true" />
                )}
                {formatCurrency(essentialExpenses)}
              </span>
              {rings.outer.percent && (
                <span className="v2-ring-row__percent">占收入 {rings.outer.percent}</span>
              )}
            </span>
            {rings.outer.overAmount && (
              <span className="v2-ring-row__over">
                已超出 {formatCurrency(rings.outer.overAmount)}
              </span>
            )}
          </button>
        </li>
        <li>
          <button
            type="button"
            className="v2-ring-row"
            data-ring="inner"
            aria-pressed={selected === "debt"}
            onClick={() => onToggle("debt")}
          >
            <span className="v2-ring-row__name">必须偿还月供</span>
            <span className="v2-ring-row__value">
              <span className="v2-ring-row__amount">
                {rings.inner.overAmount && (
                  <span className="v2-ring-row__marker" aria-hidden="true" />
                )}
                {pendingDebt ? "待确认" : formatCurrency(mandatoryDebtService)}
              </span>
              {rings.inner.percent && (
                <span className="v2-ring-row__percent">占收入 {rings.inner.percent}</span>
              )}
            </span>
            {rings.inner.overAmount && (
              <span className="v2-ring-row__over">
                已超出 {formatCurrency(rings.inner.overAmount)}
              </span>
            )}
          </button>
        </li>
      </ul>
    </div>
  );
}
