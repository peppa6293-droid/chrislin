import { useEffect, useState } from "react";
import type { V2ImportService } from "../application/v2-import-service.js";
import {
  applyCandidateEdits,
  confirmImportBatch,
  dedupeImportCandidates,
  type ImportedExpenseCandidate,
  type ImportProvider,
  parseImportFile,
} from "../model/v2-import.js";
import type { Repositories } from "../persistence/repositories.js";
import "./v2-import.css";

interface V2ImportProps {
  importService: V2ImportService;
  repositories: Repositories;
  profileId: string;
}

type ImportPreview = {
  batchId: string;
  provider: ImportProvider;
  content: string;
  candidates: ImportedExpenseCandidate[];
  existingKeys: number;
};

export function V2Import({ importService, repositories, profileId }: V2ImportProps) {
  const [provider, setProvider] = useState<ImportProvider>("ALIPAY_CSV");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
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
        const [loadedCategories, loadedAccounts] = await Promise.all([
          repositories.listExpenseCategories(profileId),
          repositories.listAccounts(profileId),
        ]);
        if (cancelled) return;
        const activeCategories = loadedCategories.filter((category) => category.active);
        const cashAccounts = loadedAccounts.filter(
          (account) => account.active && account.type === "CASH",
        );
        setCategories(activeCategories);
        setAccounts(cashAccounts);
        setSelectedCategoryId(activeCategories[0]?.id ?? "");
        setSelectedAccountId(cashAccounts[0]?.id ?? "");
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
  }, [profileId, repositories]);

  const handleFile = async (file: File) => {
    const content = await file.text();
    const batchId = globalThis.crypto.randomUUID();
    const candidates = parseImportFile(content, provider, batchId);
    const existingKeys = new Set(await repositories.listImportedDedupeKeys(profileId));
    const deduped = dedupeImportCandidates(candidates, existingKeys);
    setPreview({
      batchId,
      provider,
      content,
      candidates: [...deduped.toImport, ...deduped.skipped],
      existingKeys: existingKeys.size,
    });
    setError("");
    setResult(null);
  };

  const pending =
    preview?.candidates.filter((candidate) => candidate.reviewStatus === "PENDING") ?? [];
  const duplicated =
    preview?.candidates.filter((candidate) => candidate.reviewStatus === "SKIPPED") ?? [];
  const errors =
    preview?.candidates.filter((candidate) => candidate.reviewStatus === "ERROR") ?? [];
  const canConfirm = preview !== null && categories.length > 0 && accounts.length > 0 && !importing;

  const confirm = async () => {
    if (!preview) return;
    setImporting(true);
    setError("");
    try {
      const edited = preview.candidates.map((candidate) =>
        candidate.reviewStatus === "PENDING"
          ? applyCandidateEdits(candidate, {
              category: selectedCategoryId,
              accountId: selectedAccountId,
            })
          : candidate,
      );
      const { confirmed, skipped } = confirmImportBatch(edited);
      const result = await importService.writeConfirmedImport({
        importBatchId: preview.batchId,
        profileId,
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
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setImporting(false);
    }
  };

  const reset = () => {
    setPreview(null);
    setResult(null);
    setError("");
  };

  return (
    <section className="v2-import" aria-label="账单导入">
      <h2 className="v2-import__title">账单导入</h2>

      <fieldset className="v2-import__field">
        <legend>选择平台</legend>
        <label>
          <input
            type="radio"
            name="v2-import-provider"
            checked={provider === "ALIPAY_CSV"}
            onChange={() => setProvider("ALIPAY_CSV")}
          />
          支付宝账单
        </label>
        <label>
          <input
            type="radio"
            name="v2-import-provider"
            checked={provider === "WECHAT_CSV"}
            onChange={() => setProvider("WECHAT_CSV")}
          />
          微信账单
        </label>
      </fieldset>

      <label className="v2-import__field">
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
            </p>

            <label className="v2-import__field">
              <span>默认分类</span>
              <select
                aria-label="默认分类"
                value={selectedCategoryId}
                disabled={importing}
                onChange={(event) => setSelectedCategoryId(event.target.value)}
              >
                {categories.length === 0 ? (
                  <option value="">请先在记录页准备好分类和现金账户</option>
                ) : null}
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="v2-import__field">
              <span>默认账户</span>
              <select
                aria-label="默认账户"
                value={selectedAccountId}
                disabled={importing}
                onChange={(event) => setSelectedAccountId(event.target.value)}
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
              {preview.candidates.map((candidate) => (
                <li
                  key={`${candidate.sourceRowKey}:${candidate.dedupeKey}`}
                  className="v2-import__row"
                >
                  <span className="v2-import__amount">{candidate.amount}</span>
                  <span>{candidate.businessDate}</span>
                  <span>{candidate.merchant ?? candidate.note ?? "—"}</span>
                  <span>
                    {candidate.reviewStatus === "PENDING"
                      ? "可导入"
                      : candidate.reviewStatus === "SKIPPED"
                        ? "已重复"
                        : "异常"}
                  </span>
                </li>
              ))}
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
