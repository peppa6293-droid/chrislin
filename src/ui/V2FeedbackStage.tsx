import { CheckCircle2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useReducedMotion } from "./use-reduced-motion.js";
import { V2ProgressBar } from "./V2ProgressBar.js";

/** One-shot celebration after a confirmed save (§5.1). */
export function V2FeedbackStage({
  amountText,
  progress,
  startProgress,
  onContinue,
  onShowToday,
}: {
  amountText: string;
  progress: number;
  startProgress: number;
  onContinue: () => void;
  onShowToday: () => void;
}) {
  const reducedMotion = useReducedMotion();
  const [shown, setShown] = useState(reducedMotion);

  useEffect(() => {
    if (reducedMotion) {
      setShown(true);
      return;
    }
    const frame = window.requestAnimationFrame(() => setShown(true));
    return () => window.cancelAnimationFrame(frame);
  }, [reducedMotion]);

  return (
    <section className="v2-feedback-stage" role="status" aria-live="polite" aria-label="记账反馈">
      <div className="v2-feedback-icon" aria-hidden="true">
        <CheckCircle2 size={40} strokeWidth={2.4} />
      </div>
      {!reducedMotion && (
        <div className="v2-feedback-particles" aria-hidden="true">
          {Array.from({ length: 8 }, (_, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: decorative particles have no identity
            <span key={index} className="v2-particle" />
          ))}
        </div>
      )}
      <h2 className="v2-feedback-title">记好了！</h2>
      <p className="v2-feedback-note">这笔 {amountText} 已放进今天的账本</p>
      <V2ProgressBar
        value={shown ? progress : startProgress}
        max={100}
        large
        label="本月消费进度"
      />
      <div className="v2-feedback-actions">
        <button className="v2-btn v2-btn--primary" type="button" onClick={onContinue}>
          继续
        </button>
        <button className="v2-btn v2-btn--secondary" type="button" onClick={onShowToday}>
          查看今天
        </button>
      </div>
    </section>
  );
}
