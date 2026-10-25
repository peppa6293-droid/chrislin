import { CheckCircle2, Sprout } from "lucide-react";
import { useState } from "react";
import type { HomeApplicationState } from "../application/product-service.js";
import { money } from "../model/money.js";
import { MoneyAmount } from "./MoneyAmount.js";
import { V2ProgressBar } from "./V2ProgressBar.js";
import { V2StatusBadge } from "./V2StatusBadge.js";

/** §7 "建立余地": same data as before, new visual; never a hero pair of amounts. */
export function V2SavingsRoomPage({
  home,
  onUpdate,
}: {
  home: HomeApplicationState;
  onUpdate?: () => void;
}) {
  const [explained, setExplained] = useState(false);
  const target = home.safetyCoverageTargetMonths;
  const current = Number(home.safetyCoverageMonths);
  const valid = home.safetyCoverageMonths != null && Number.isFinite(current) && current >= 0;
  const gap = money(home.safetyGap);
  const tooMuch = gap.lt(0);
  const complete = target > 0 && valid && current >= target;
  const percent = target > 0 && valid ? (current / target) * 100 : 0;
  const visual = Math.min(110, Math.max(0, percent));
  const title =
    target <= 0
      ? "先定一个你想留下的数"
      : complete
        ? "这份余地，已经建立起来了"
        : current <= 0
          ? "先定一个你想留下的数"
          : "一点点来，余地会长出来";

  return (
    <section className="v2-savings-room" aria-labelledby="savings-room-heading">
      <div className={`v2-savings-hero ${complete ? "is-complete" : ""}`}>
        <div className="v2-savings-illustration" aria-hidden="true">
          <Sprout size={96} />
          {complete && <CheckCircle2 className="v2-savings-check" size={28} />}
        </div>
        <p className="v2-savings-subtitle">给未来留一点空间</p>
        <h2 id="savings-room-heading">{title}</h2>
        {complete && <V2StatusBadge>目标完成</V2StatusBadge>}
        <div className="v2-savings-figures">
          <div>
            <span>当前</span>
            <MoneyAmount value={home.safetyResources} size="detail" />
          </div>
          <div>
            <span>目标</span>
            <MoneyAmount value={home.safetyTargetResources} size="detail" />
          </div>
        </div>
        {target > 0 && valid ? (
          <div className="v2-savings-progress">
            <V2ProgressBar
              value={visual}
              max={110}
              large
              showEnd={!complete && visual > 0}
              tone={complete ? "normal" : tooMuch ? "over" : "normal"}
              label="余地目标进度"
            />
            <span className={complete ? "is-complete" : ""}>{Math.round(percent)}%</span>
          </div>
        ) : (
          <p className="v2-savings-note">还没有设目标，先从一个你安心的数字开始。</p>
        )}
        <p className="v2-savings-gap">
          {tooMuch ? (
            <>
              你已经超过目标 <MoneyAmount value={home.safetyGap} size="inline" />
            </>
          ) : gap.gt(0) ? (
            <>
              还差 <MoneyAmount value={home.safetyGap} size="inline" />
            </>
          ) : (
            "已经达到你设的余地目标。"
          )}
        </p>
        <div className="v2-savings-actions">
          <button className="v2-btn v2-btn--primary" type="button" onClick={onUpdate}>
            {target > 0 ? "更新余地" : "设一个目标"}
          </button>
          <button
            className="v2-btn v2-btn--secondary"
            type="button"
            aria-expanded={explained}
            onClick={() => setExplained((value) => !value)}
          >
            查看怎么计算
          </button>
        </div>
        {explained && (
          <p className="v2-savings-explainer">
            余地目标 = 每月必须花的钱 ×
            你想要的月数。准备好的余地只包含明确纳入的现金和符合条件的流动投资，
            不会把不确定的东西算进来。
          </p>
        )}
      </div>

      <section className="v2-savings-steps" aria-labelledby="savings-steps-heading">
        <h3 id="savings-steps-heading">这一步可以做什么</h3>
        <ol>
          <li>
            <span>①</span>先把每月能留下的钱记清楚
          </li>
          <li>
            <span>②</span>有余力时，再把目标往前推
          </li>
        </ol>
      </section>
    </section>
  );
}
