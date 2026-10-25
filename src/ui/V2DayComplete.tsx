/** Day-complete track: today, yesterday, streak (§5.2). */
export function V2DayComplete({
  consecutiveDays,
  onClose,
}: {
  consecutiveDays: number;
  onClose: () => void;
}) {
  const streak = Math.max(1, consecutiveDays);
  return (
    <section className="v2-feedback-stage v2-day-complete" role="status" aria-label="今天记账完成">
      <span className="v2-card__kicker">今天</span>
      <h2 className="v2-feedback-title">今天的账，记完了</h2>
      <p className="v2-feedback-note">
        {streak > 1 ? `已经连续记了 ${streak} 天` : "今天是一个很好的开始"}
      </p>
      <div className="v2-day-track" aria-hidden="true">
        <span className="v2-day-track__point is-done is-current" />
        <span className="v2-day-track__line is-done" />
        <span className={`v2-day-track__point ${streak > 1 ? "is-done" : ""}`} />
        <span className="v2-day-track__line" />
        <span className="v2-day-track__point" />
      </div>
      <div className="v2-day-labels" aria-hidden="true">
        <span>今天</span>
        <span>昨天</span>
        <span>连续</span>
      </div>
      <div className="v2-feedback-actions">
        <button className="v2-btn v2-btn--primary" type="button" onClick={onClose}>
          看看今天
        </button>
      </div>
    </section>
  );
}
