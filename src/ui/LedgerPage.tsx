import { ChevronLeft, ChevronRight, Download, Pencil, Sparkles, Trash2, Undo2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { HomeApplicationState } from "../application/product-service.js";
import type {
  DeletedExpenseSnapshot,
  LedgerExpenseRow,
  RecategorizationAssignment,
} from "../application/ux-ledger-service.js";
import { suggestCategory } from "../model/import-rules.js";
import type { ProductApplicationServices } from "./contracts.js";
import { shiftMonth } from "./DateField.js";
import { formatCurrency } from "./money-format.js";
import { V2CalendarPicker } from "./V2CalendarPicker.js";

const UNDO_WINDOW_MS = 12_000;

interface EditDraft {
  id: string;
  amount: string;
  businessDate: string;
  categoryId: string;
  description: string;
}

export function LedgerPage({
  asOfDate,
  services,
  onApplyHome,
  onBack,
}: {
  asOfDate: string;
  services: ProductApplicationServices;
  onApplyHome: (home: HomeApplicationState) => void;
  onBack: () => void;
}) {
  // The ledger browses its own month; asOfDate stays the session write date.
  const [month, setMonth] = useState(asOfDate.slice(0, 7));
  const [rows, setRows] = useState<LedgerExpenseRow[]>([]);
  const [categories, setCategories] = useState<Array<{ id: string; name: string }>>([]);
  const [draft, setDraft] = useState<EditDraft | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [undoSnapshot, setUndoSnapshot] = useState<DeletedExpenseSnapshot | null>(null);
  const [suggestions, setSuggestions] = useState<RecategorizationAssignment[]>([]);
  const [suggestionNote, setSuggestionNote] = useState("");
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const [nextRows, options] = await Promise.all([
        services.listLedgerExpenses(month),
        services.getV2ImportOptions(),
      ]);
      setRows(nextRows);
      setCategories(options.categories);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "流水读取失败。");
    }
  }, [month, services]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(
    () => () => {
      if (undoTimer.current) clearTimeout(undoTimer.current);
    },
    [],
  );

  function startUndoWindow(snapshot: DeletedExpenseSnapshot) {
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setUndoSnapshot(snapshot);
    undoTimer.current = setTimeout(() => setUndoSnapshot(null), UNDO_WINDOW_MS);
  }

  async function saveEdit() {
    if (!draft) return;
    setBusy(true);
    setError("");
    try {
      const result = await services.editLedgerExpense({
        id: draft.id,
        amount: draft.amount.trim(),
        businessDate: draft.businessDate,
        categoryId: draft.categoryId,
        description: draft.description.trim(),
        asOfDate,
      });
      onApplyHome(result.home);
      setFeedback(
        result.reconciliation.balanced
          ? "改好了，两本账已经同步。"
          : "改好了，但对账还不一致，请先核对。",
      );
      setDraft(null);
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "修改失败。");
    } finally {
      setBusy(false);
    }
  }

  async function deleteRow(id: string) {
    setBusy(true);
    setError("");
    try {
      const result = await services.deleteLedgerExpense(id, asOfDate);
      onApplyHome(result.home);
      startUndoWindow(result.snapshot);
      setPendingDelete(null);
      setFeedback("已删除。12 秒内可以撤回。");
      await load();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "删除失败。");
    } finally {
      setBusy(false);
    }
  }

  async function restore() {
    if (!undoSnapshot) return;
    setBusy(true);
    try {
      const result = await services.restoreLedgerExpense(undoSnapshot, asOfDate);
      onApplyHome(result.home);
      setFeedback("已经撤回，这笔回到账本里了。");
      setUndoSnapshot(null);
      if (undoTimer.current) clearTimeout(undoTimer.current);
      await load();
    } catch (restoreError) {
      setError(restoreError instanceof Error ? restoreError.message : "撤回失败。");
    } finally {
      setBusy(false);
    }
  }

  function previewSuggestions() {
    if (categories.length === 0) return;
    const assignments: RecategorizationAssignment[] = [];
    for (const row of rows) {
      const suggestion = suggestCategory(row.description, categories);
      if (!suggestion || suggestion.categoryId === row.categoryId) continue;
      assignments.push({ expenseId: row.id, categoryId: suggestion.categoryId });
    }
    setSuggestions(assignments);
    setSuggestionNote(
      assignments.length === 0
        ? "没有找到可以改的分类。"
        : `按商户和摘要看，有 ${assignments.length} 笔可以归到更合适的分类。确认后只改分类，金额和日期都不动。`,
    );
  }

  async function applySuggestions() {
    if (suggestions.length === 0) return;
    setBusy(true);
    setError("");
    try {
      const result = await services.recategorizeLedgerExpenses(suggestions, asOfDate);
      onApplyHome(result.home);
      setFeedback(
        `改好 ${result.updated} 笔分类。总金额 ${formatCurrency(result.totalBefore)} 不变。`,
      );
      setSuggestions([]);
      setSuggestionNote("");
      await load();
    } catch (applyError) {
      setError(applyError instanceof Error ? applyError.message : "归类失败。");
    } finally {
      setBusy(false);
    }
  }

  async function exportData() {
    setBusy(true);
    setError("");
    try {
      const result = await services.exportLedger(asOfDate);
      setFeedback(`备份已保存：${result.jsonPath}；流水已保存：${result.csvPath}`);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "导出失败。");
    } finally {
      setBusy(false);
    }
  }

  async function exportDatabase() {
    if (!services.exportDatabaseBackup) return;
    setBusy(true);
    setError("");
    try {
      const result = await services.exportDatabaseBackup();
      setFeedback(`数据库备份已保存：${result.path}（SHA-256 ${result.sha256.slice(0, 16)}…）`);
    } catch (backupError) {
      setError(backupError instanceof Error ? backupError.message : "数据库备份失败。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="home-page detail-page v2-detail-page v2-ledger-page">
      <header className="detail-header">
        <button type="button" className="back-button" onClick={onBack} aria-label="返回首页">
          返回首页
        </button>
        <span>{month}</span>
      </header>
      <h1 className="detail-title">流水</h1>
      <div className="v2-ledger-monthbar">
        <button
          type="button"
          className="v2-icon-btn"
          aria-label="上一月"
          disabled={busy}
          onClick={() => setMonth((current) => shiftMonth(current, -1))}
        >
          <ChevronLeft size={18} aria-hidden="true" />
        </button>
        <span className="v2-ledger-month-pill">{month.replace("-", " 年 ")} 月</span>
        <button
          type="button"
          className="v2-icon-btn"
          aria-label="下一月"
          disabled={busy}
          onClick={() => setMonth((current) => shiftMonth(current, 1))}
        >
          <ChevronRight size={18} aria-hidden="true" />
        </button>
      </div>
      <div className="v2-ledger-toolbar">
        <button
          type="button"
          className="button button-secondary"
          disabled={busy}
          onClick={previewSuggestions}
        >
          <Sparkles size={16} aria-hidden="true" /> 自动归类
        </button>
        <button
          type="button"
          className="button button-secondary"
          disabled={busy}
          onClick={() => void exportData()}
        >
          <Download size={16} aria-hidden="true" /> 导出备份
        </button>
        {services.exportDatabaseBackup && (
          <button
            type="button"
            className="button button-secondary"
            disabled={busy}
            onClick={() => void exportDatabase()}
          >
            <Download size={16} aria-hidden="true" /> 导出数据库备份
          </button>
        )}
      </div>

      {suggestionNote && (
        <section className="detail-panel" role="status">
          <p>{suggestionNote}</p>
          {suggestions.length > 0 && (
            <button
              type="button"
              className="button button-primary"
              disabled={busy}
              onClick={() => void applySuggestions()}
            >
              就按这个改
            </button>
          )}
        </section>
      )}

      {undoSnapshot && (
        <div className="v2-undo-bar" role="status">
          <span>已删除一笔流水。</span>
          <button
            type="button"
            className="v2-text-button"
            disabled={busy}
            onClick={() => void restore()}
          >
            <Undo2 size={15} aria-hidden="true" /> 撤回
          </button>
        </div>
      )}

      <section className="detail-panel" aria-labelledby="ledger-list-heading">
        <h2 id="ledger-list-heading">本月记录</h2>
        {rows.length === 0 ? (
          <p>这个月还没有流水。</p>
        ) : (
          <ul className="v2-plain-list v2-ledger-list">
            {rows.map((row) => (
              <li key={row.id}>
                <span>
                  <strong>{row.categoryName || "未分类"}</strong>
                  <small>
                    {row.businessDate}
                    {row.description ? ` · ${row.description}` : ""}
                  </small>
                </span>
                <span>{formatCurrency(row.amount)}</span>
                <button
                  type="button"
                  className="v2-text-button"
                  disabled={busy}
                  onClick={() =>
                    setDraft({
                      id: row.id,
                      amount: row.amount,
                      businessDate: row.businessDate,
                      categoryId: row.categoryId,
                      description: row.description,
                    })
                  }
                >
                  <Pencil size={15} aria-hidden="true" /> 编辑
                </button>
                {pendingDelete === row.id ? (
                  <span className="v2-delete-confirm">
                    <button
                      type="button"
                      className="v2-text-button is-danger"
                      disabled={busy}
                      onClick={() => void deleteRow(row.id)}
                    >
                      确认删除
                    </button>
                    <button
                      type="button"
                      className="v2-text-button"
                      onClick={() => setPendingDelete(null)}
                    >
                      取消
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    className="v2-text-button"
                    disabled={busy}
                    onClick={() => setPendingDelete(row.id)}
                  >
                    <Trash2 size={15} aria-hidden="true" /> 删除
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {draft && (
        <section className="detail-panel" aria-labelledby="ledger-edit-heading">
          <h2 id="ledger-edit-heading">修改这一笔</h2>
          <label>
            金额
            <input
              inputMode="decimal"
              value={draft.amount}
              onChange={(event) => setDraft({ ...draft, amount: event.target.value })}
            />
          </label>
          <label>
            分类
            <select
              value={draft.categoryId}
              onChange={(event) => setDraft({ ...draft, categoryId: event.target.value })}
            >
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
          <div className="v2-sheet-date">
            <span>日期</span>
            <V2CalendarPicker
              value={draft.businessDate}
              onChange={(value) => setDraft({ ...draft, businessDate: value })}
              label="流水日期"
              disabled={busy}
            />
          </div>
          <label>
            备注
            <input
              value={draft.description}
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
            />
          </label>
          <div className="v2-sheet-actions">
            <button
              type="button"
              className="button button-secondary"
              onClick={() => setDraft(null)}
            >
              取消
            </button>
            <button
              type="button"
              className="button button-primary"
              disabled={busy}
              onClick={() => void saveEdit()}
            >
              保存修改
            </button>
          </div>
        </section>
      )}

      {feedback && (
        <p className="v2-feedback-inline" role="status">
          {feedback}
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
