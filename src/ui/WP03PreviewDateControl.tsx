import { useEffect, useState } from "react";

export function WP03PreviewDateControl({
  asOfDate,
  onApply,
}: {
  asOfDate: string;
  onApply: (testDate: string | null) => Promise<void>;
}) {
  const [draft, setDraft] = useState(asOfDate);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => setDraft(asOfDate), [asOfDate]);

  async function apply(testDate: string | null) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await onApply(testDate);
      setMessage(testDate ? `本次测试 session 使用 ${testDate}` : "已恢复使用系统当前日期");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "验收日期未应用。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="wp03-preview-date" aria-label="WP-03 验收日期">
      <div>
        <strong>WP-03 验收日期</strong>
        <span>仅影响当前测试 session；重启后默认恢复系统日期，不写入财务账本。</span>
      </div>
      <label>
        测试日期
        <input
          aria-label="WP-03 验收日期"
          type="date"
          value={draft}
          disabled={busy}
          onChange={(event) => setDraft(event.target.value)}
        />
      </label>
      <button
        className="button button-secondary"
        type="button"
        disabled={busy || !/^\d{4}-\d{2}-\d{2}$/.test(draft)}
        onClick={() => void apply(draft)}
      >
        应用测试日期
      </button>
      <button
        className="text-button"
        type="button"
        disabled={busy}
        onClick={() => void apply(null)}
      >
        恢复真实日期
      </button>
      {message && <span role="status">{message}</span>}
      {error && <span role="alert">{error}</span>}
    </section>
  );
}
