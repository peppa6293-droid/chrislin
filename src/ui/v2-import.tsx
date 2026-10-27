import { Upload } from "lucide-react";
import { useEffect, useState } from "react";
import {
  type CategoryOption,
  detectImportProvider,
  LOW_CONFIDENCE_THRESHOLD,
  suggestAccount,
  suggestCategory,
} from "../model/import-rules.js";
import {
  applyCandidateEdits,
  confirmImportBatch,
  dedupeImportCandidates,
  type ImportedExpenseCandidate,
  type ImportProvider,
  parseImportFile,
} from "../model/v2-import.js";
import type { V2ImportContext, V2ImportWriteInput, V2ImportWriteResult } from "./contracts.js";
import { formatCurrency } from "./money-format.js";
import "./v2-import.css";

interface V2ImportProps {
  loadImportContext: () => Promise<V2ImportContext>;
  writeImport: (input: V2ImportWriteInput) => Promise<V2ImportWriteResult>;
}

type ImportPreview = {
  batchId: string;
  provider: ImportProvider;
  detectedProvider: ImportProvider | null;
  content: string;
  candidates: ImportedExpenseCandidate[];
  existingKeys: number;
};

/**
 * One row's resolved destination. `RULE` means the local keyword table proposed
 * it, `DEFAULT` means no rule matched and the user's default is used, `USER`
 * means the user changed it by hand and the row is never overwritten again.
 */
type RowDecision = {
  categoryId: string;
  categoryConfidence: number | null;
  categoryMatched: string | null;
  categorySource: "RULE" | "DEFAULT" | "USER";
  accountId: string;
  accountSource: "RULE" | "DEFAULT" | "USER";
};

function categoryOptions(categories: CategoryOption[]) {
  return categories.map((category) => (
    <option key={category.id} value={category.id}>
      {category.name}
    </option>
  ));
}

function decisionKey(candidate: ImportedExpenseCandidate): string {
  return `${candidate.sourceRowKey}:${candidate.dedupeKey}`;
}

function candidateText(candidate: ImportedExpenseCandidate): string {
  return [candidate.merchant, candidate.note].filter(Boolean).join(" ");
}

function buildDecisions(
  candidates: ImportedExpenseCandidate[],
  categories: CategoryOption[],
  accounts: Array<{ id: string; name: string }>,
  defaultCategoryId: string,
  defaultAccountId: string,
): Record<string, RowDecision> {
  const decisions: Record<string, RowDecision> = {};
  for (const candidate of candidates) {
    if (candidate.reviewStatus !== "PENDING") continue;
    const text = candidateText(candidate);
    const category = suggestCategory(text, categories);
    const accountId = suggestAccount(text, accounts);
    decisions[decisionKey(candidate)] = {
      categoryId: category?.categoryId ?? defaultCategoryId,
      categoryConfidence: category?.confidence ?? null,
      categoryMatched: category?.matched ?? null,
      categorySource: category ? "RULE" : "DEFAULT",
      accountId: accountId ?? defaultAccountId,
      accountSource: accountId ? "RULE" : "DEFAULT",
    };
  }
  return decisions;
}

function decisionNeedsReview(decision: RowDecision): boolean {
  if (decision.categorySource === "USER") return false;
  if (decision.categorySource === "DEFAULT") return true;
  return (decision.categoryConfidence ?? 0) < LOW_CONFIDENCE_THRESHOLD;
}

function decisionNote(decision: RowDecision): string {
  if (decision.categorySource === "USER") return "已按你的选择";
  if (decision.categorySource === "DEFAULT") return "没匹配到规则，先用默认分类";
  const percent = Math.round((decision.categoryConfidence ?? 0) * 100);
  return decisionNeedsReview(decision)
    ? `不太确定：按「${decision.categoryMatched}」猜的 · ${percent}%`
    : `按「${decision.categoryMatched}」建议 · ${percent}%`;
}

export function V2Import({ loadImportContext, writeImport }: V2ImportProps) {
  const [provider, setProvider] = useState<ImportProvider>("ALIPAY_CSV");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [decisions, setDecisions] = useState<Record<string, RowDecision>>({});
  const [categories, setCategories] = useState<Array<{ id: string; name: string }>>([]);
  const [accounts, setAccounts] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState("");
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{
    writtenRows: number;
    skippedRows: number;
    errorRows: number;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const context = await loadImportContext();
        if (cancelled) return;
        setCategories(context.categories);
        setAccounts(context.accounts);
        setSelectedCategoryId(context.categories[0]?.id ?? "");
        setSelectedAccountId(context.accounts[0]?.id ?? "");
      } catch {
        if (!cancelled) {
          setCategories([]);
          setAccounts([]);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [loadImportContext]);

  const applyPreview = async (content: string, parseProvider: ImportProvider) => {
    const batchId = globalThis.crypto.randomUUID();
    const candidates = parseImportFile(content, parseProvider, batchId);
    const context = await loadImportContext();
    const existingKeys = new Set(context.dedupeKeys);
    const deduped = dedupeImportCandidates(candidates, existingKeys);
    const merged = [...deduped.toImport, ...deduped.skipped];
    const fallbackCategory = selectedCategoryId || context.categories[0]?.id || "";
    const fallbackAccount = selectedAccountId || context.accounts[0]?.id || "";
    setCategories(context.categories);
    setAccounts(context.accounts);
    if (!selectedCategoryId) setSelectedCategoryId(fallbackCategory);
    if (!selectedAccountId) setSelectedAccountId(fallbackAccount);
    setDecisions(
      buildDecisions(
        merged,
        context.categories,
        context.accounts,
        fallbackCategory,
        fallbackAccount,
      ),
    );
    setPreview({
      batchId,
      provider: parseProvider,
      detectedProvider: detectImportProvider(content),
      content,
      candidates: merged,
      existingKeys: existingKeys.size,
    });
    setError("");
    setResult(null);
  };

  const handleFile = async (file: File) => {
    const content = await file.text();
    // Trust the CSV header over the radio button; fall back to the user's pick.
    const detected = detectImportProvider(content);
    if (detected) setProvider(detected);
    await applyPreview(content, detected ?? provider);
  };

  const chooseProvider = (next: ImportProvider) => {
    setProvider(next);
    if (preview) void applyPreview(preview.content, next);
  };

  const pending =
    preview?.candidates.filter((candidate) => candidate.reviewStatus === "PENDING") ?? [];
  const duplicated =
    preview?.candidates.filter((candidate) => candidate.reviewStatus === "SKIPPED") ?? [];
  const errors =
    preview?.candidates.filter((candidate) => candidate.reviewStatus === "ERROR") ?? [];
  const reviewCount = pending.filter((candidate) => {
    const decision = decisions[decisionKey(candidate)];
    return decision ? decisionNeedsReview(decision) : true;
  }).length;
  const canConfirm = preview !== null && categories.length > 0 && accounts.length > 0 && !importing;

  const decisionFor = (candidate: ImportedExpenseCandidate): RowDecision => {
    return (
      decisions[decisionKey(candidate)] ?? {
        categoryId: selectedCategoryId,
        categoryConfidence: null,
        categoryMatched: null,
        categorySource: "DEFAULT",
        accountId: selectedAccountId,
        accountSource: "DEFAULT",
      }
    );
  };

  const patchDecision = (
    candidate: ImportedExpenseCandidate,
    patch: Partial<Pick<RowDecision, "categoryId" | "accountId">>,
  ) => {
    setDecisions((current) => {
      const key = decisionKey(candidate);
      const base = current[key] ?? decisionFor(candidate);
      return {
        ...current,
        [key]: {
          ...base,
          ...patch,
          ...(patch.categoryId
            ? { categorySource: "USER" as const, categoryConfidence: null, categoryMatched: null }
            : {}),
          ...(patch.accountId ? { accountSource: "USER" as const } : {}),
        },
      };
    });
  };

  const changeDefaultCategory = (id: string) => {
    setSelectedCategoryId(id);
    // Rows a rule classified stay as they are; only the fallback rows follow.
    setDecisions((current) => {
      const next = { ...current };
      for (const [key, decision] of Object.entries(next)) {
        if (decision.categorySource === "DEFAULT") next[key] = { ...decision, categoryId: id };
      }
      return next;
    });
  };

  const changeDefaultAccount = (id: string) => {
    setSelectedAccountId(id);
    setDecisions((current) => {
      const next = { ...current };
      for (const [key, decision] of Object.entries(next)) {
        if (decision.accountSource === "DEFAULT") next[key] = { ...decision, accountId: id };
      }
      return next;
    });
  };

  const confirm = async () => {
    if (!preview) return;
    setImporting(true);
    setError("");
    try {
      // High-confidence rows pass through untouched; every pending row is
      // written with the category/account shown on its own line.
      const edited = preview.candidates.map((candidate) => {
        if (candidate.reviewStatus !== "PENDING") return candidate;
        const decision = decisionFor(candidate);
        return applyCandidateEdits(candidate, {
          category: decision.categoryId,
          accountId: decision.accountId,
        });
      });
      const { confirmed, skipped } = confirmImportBatch(edited);
      const result = await writeImport({
        importBatchId: preview.batchId,
        provider: preview.provider,
        sourceFileContent: preview.content,
        candidates: [...confirmed, ...skipped],
      });
      setResult({
        writtenRows: result.writtenRows,
        skippedRows: result.skippedRows,
        errorRows: result.errorRows,
      });
      setPreview(null);
      setDecisions({});
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setImporting(false);
    }
  };

  const reset = () => {
    setPreview(null);
    setDecisions({});
    setResult(null);
    setError("");
  };

  return (
    <section className="v2-import" aria-label="账单导入">
      <h2 className="v2-import__title">账单导入</h2>

      <fieldset className="v2-import__field v2-import__field--provider">
        <legend>选择平台</legend>
        <label className="v2-import__provider-option">
          <input
            type="radio"
            name="v2-import-provider"
            checked={provider === "ALIPAY_CSV"}
            onChange={() => chooseProvider("ALIPAY_CSV")}
          />
          支付宝账单
        </label>
        <label className="v2-import__provider-option">
          <input
            type="radio"
            name="v2-import-provider"
            checked={provider === "WECHAT_CSV"}
            onChange={() => chooseProvider("WECHAT_CSV")}
          />
          微信账单
        </label>
      </fieldset>

      <label className="v2-import__field v2-import__file">
        <Upload size={18} aria-hidden="true" />
        <span>选择 CSV 文件</span>
        <input
          type="file"
          accept=".csv"
          aria-label="选择 CSV 文件"
          disabled={importing}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void handleFile(file);
          }}
        />
      </label>

      {preview ? (
        preview.candidates.length === 0 ? (
          <p role="status">没有识别到可导入的记录</p>
        ) : (
          <>
            <p className="v2-import__summary" role="status">
              共 {preview.candidates.length} 条｜可导入 {pending.length}｜重复跳过{" "}
              {duplicated.length}｜异常 {errors.length}
              {pending.length > 0
                ? `｜其中 ${pending.length - reviewCount} 条已按本地规则分好，${reviewCount} 条等你确认`
                : ""}
            </p>

            {preview.detectedProvider ? (
              <p className="v2-import__hint">
                已根据文件表头识别为
                {preview.detectedProvider === "ALIPAY_CSV" ? "支付宝账单" : "微信账单"}
                ，分类只在你的电脑上用本地规则匹配，不会上传。
              </p>
            ) : null}

            <label className="v2-import__field">
              <span>没匹配到规则时用的分类</span>
              <select
                aria-label="默认分类"
                value={selectedCategoryId}
                disabled={importing}
                onChange={(event) => changeDefaultCategory(event.target.value)}
              >
                {categories.length === 0 ? (
                  <option value="">请先在记录页准备好分类和现金账户</option>
                ) : null}
                {categoryOptions(categories)}
              </select>
            </label>

            <label className="v2-import__field">
              <span>没匹配到规则时用的账户</span>
              <select
                aria-label="默认账户"
                value={selectedAccountId}
                disabled={importing}
                onChange={(event) => changeDefaultAccount(event.target.value)}
              >
                {accounts.length === 0 ? (
                  <option value="">请先在记录页准备好分类和现金账户</option>
                ) : null}
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
            </label>

            {categories.length === 0 || accounts.length === 0 ? (
              <p className="v2-import__hint">请先在记录页准备好分类和现金账户</p>
            ) : null}

            <ul className="v2-import__list">
              {preview.candidates.map((candidate, index) => {
                const decision = decisionFor(candidate);
                const isPending = candidate.reviewStatus === "PENDING";
                const flagged = isPending && decisionNeedsReview(decision);
                return (
                  <li
                    key={`${candidate.sourceRowKey}:${candidate.dedupeKey}`}
                    className="v2-import__row"
                  >
                    <div className="v2-import__row-main">
                      <span className="v2-import__amount">{formatCurrency(candidate.amount)}</span>
                      <span>{candidate.businessDate}</span>
                      <span>{candidate.merchant ?? candidate.note ?? "—"}</span>
                      <span>
                        {isPending
                          ? "可导入"
                          : candidate.reviewStatus === "SKIPPED"
                            ? "已重复"
                            : "异常"}
                      </span>
                    </div>
                    {isPending ? (
                      <div className="v2-import__row-edit">
                        <select
                          aria-label={`第 ${index + 1} 条的分类`}
                          value={decision.categoryId}
                          disabled={importing}
                          onChange={(event) =>
                            patchDecision(candidate, { categoryId: event.target.value })
                          }
                        >
                          {decision.categoryId === "" ? (
                            <option value="">请先准备分类</option>
                          ) : null}
                          {categoryOptions(categories)}
                        </select>
                        {accounts.length > 1 ? (
                          <select
                            aria-label={`第 ${index + 1} 条的账户`}
                            value={decision.accountId}
                            disabled={importing}
                            onChange={(event) =>
                              patchDecision(candidate, { accountId: event.target.value })
                            }
                          >
                            {decision.accountId === "" ? (
                              <option value="">请先准备账户</option>
                            ) : null}
                            {accounts.map((account) => (
                              <option key={account.id} value={account.id}>
                                {account.name}
                              </option>
                            ))}
                          </select>
                        ) : null}
                        <small className={`v2-import__note ${flagged ? "is-review" : ""}`}>
                          {decisionNote(decision)}
                        </small>
                      </div>
                    ) : candidate.validationErrors.length > 0 ? (
                      <small className="v2-import__note is-review">
                        {candidate.validationErrors[0]}
                      </small>
                    ) : null}
                  </li>
                );
              })}
            </ul>

            <button
              type="button"
              className="v2-import__confirm"
              disabled={!canConfirm}
              onClick={() => void confirm()}
            >
              {importing ? "导入中…" : "确认导入"}
            </button>
          </>
        )
      ) : null}

      {error ? (
        <p className="v2-import__error" role="alert">
          {error}
        </p>
      ) : null}
      {result ? (
        <p className="v2-import__result" role="status">
          已写入 {result.writtenRows} 条，跳过 {result.skippedRows} 条，失败 {result.errorRows} 条
          <button type="button" onClick={reset}>
            再导入一份
          </button>
        </p>
      ) : null}
    </section>
  );
}
