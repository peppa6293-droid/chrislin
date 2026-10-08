import { type FormEvent, useEffect, useRef, useState } from "react";
import type {
  FinancialMaintenancePatch,
  FinancialMaintenanceState,
} from "../application/financial-maintenance-service.js";
import { MoneyAmount } from "./MoneyAmount.js";

const essentialCategories = [
  ["HOUSING", "住房"],
  ["BASIC_FOOD", "基本饮食"],
  ["TRANSPORT", "交通"],
  ["UTILITIES_COMMUNICATIONS", "水电通讯"],
  ["INSURANCE", "保险"],
  ["FAMILY_FIXED_RESPONSIBILITY", "家庭固定责任"],
  ["OTHER_ESSENTIAL", "其他必要支出"],
] as const;
const essentialNames = Object.fromEntries(essentialCategories) as Record<string, string>;

function displayEssentialName(item: { name: string; category: string }) {
  return item.name === item.category ? (essentialNames[item.category] ?? item.name) : item.name;
}

type MaintenanceForm = {
  stableMonthlyIncome: string;
  actualIncomeRecords: FinancialMaintenanceState["actualIncomeRecords"];
  newIncome: Array<{
    key: string;
    amount: string;
    date: string;
    status: "" | "EXPECTED" | "PENDING" | "RECEIVED";
  }>;
  essentialExpenses: Array<
    Omit<FinancialMaintenanceState["essentialExpenses"][number], "id"> & { id?: string }
  >;
  cashAccounts: Array<
    Omit<FinancialMaintenanceState["cashAccounts"][number], "id"> & { id?: string }
  >;
  assets: Array<Omit<FinancialMaintenanceState["assets"][number], "id"> & { id?: string }>;
  debts: Array<Omit<FinancialMaintenanceState["debts"][number], "id"> & { id?: string }>;
  settings: FinancialMaintenanceState["settings"];
};

function fromState(state: FinancialMaintenanceState): MaintenanceForm {
  return {
    stableMonthlyIncome: state.stableMonthlyIncome,
    actualIncomeRecords: state.actualIncomeRecords.map((item) => ({ ...item })),
    newIncome: [],
    essentialExpenses: state.essentialExpenses.map((item) => ({
      ...item,
      name: displayEssentialName(item),
    })),
    cashAccounts: state.cashAccounts.map((item) => ({ ...item })),
    assets: state.assets.map((item) => ({ ...item })),
    debts: state.debts.map((item) => ({ ...item })),
    settings: { ...state.settings },
  };
}

function buildPatch(
  initial: FinancialMaintenanceState,
  form: MaintenanceForm,
): FinancialMaintenancePatch {
  const patch: FinancialMaintenancePatch = {};
  if (form.stableMonthlyIncome !== initial.stableMonthlyIncome)
    patch.stableMonthlyIncome = form.stableMonthlyIncome;
  const actualIncomeEntries = form.newIncome
    .filter((item) => item.amount.trim() && item.date && item.status)
    .map((item) => ({
      amount: item.amount.trim(),
      date: item.date,
      status: item.status as "EXPECTED" | "PENDING" | "RECEIVED",
    }));
  if (actualIncomeEntries.length) patch.actualIncomeEntries = actualIncomeEntries;
  const changedEssentials = form.essentialExpenses.filter((item) => {
    const original = initial.essentialExpenses.find((candidate) => candidate.id === item.id);
    return original
      ? displayEssentialName(original) !== item.name ||
          original.category !== item.category ||
          original.monthlyAmount !== item.monthlyAmount
      : Boolean(item.name.trim() && item.monthlyAmount.trim());
  });
  if (changedEssentials.length) patch.essentialExpenses = changedEssentials;
  const changedCash = form.cashAccounts.filter((item) => {
    const original = initial.cashAccounts.find((candidate) => candidate.id === item.id);
    return original
      ? original.name !== item.name ||
          original.balance !== item.balance ||
          original.includeInSafetyResources !== item.includeInSafetyResources
      : Boolean(item.name.trim() && item.balance.trim());
  });
  if (changedCash.length) patch.cashAccounts = changedCash;
  const changedAssets = form.assets.filter((item) => {
    const original = initial.assets.find((candidate) => candidate.id === item.id);
    return original
      ? original.name !== item.name ||
          original.currentValue !== item.currentValue ||
          original.kind !== item.kind ||
          original.includeInSafetyResources !== item.includeInSafetyResources
      : Boolean(item.name.trim() && item.currentValue.trim());
  });
  if (changedAssets.length) patch.assets = changedAssets;
  const changedDebts = form.debts.filter((item) => {
    const original = initial.debts.find((candidate) => candidate.id === item.id);
    return original
      ? original.needsCurrentMonthFact ||
          original.name !== item.name ||
          original.currentBalance !== item.currentBalance ||
          original.currentMonthDue !== item.currentMonthDue ||
          original.fixedMonthlyPayment !== item.fixedMonthlyPayment
      : Boolean(item.name.trim() && item.currentBalance.trim());
  });
  if (changedDebts.length)
    patch.debts = changedDebts.map((item) => ({
      ...(item.id === undefined ? {} : { id: item.id }),
      name: item.name,
      currentBalance: item.currentBalance,
      currentMonthDue: item.currentMonthDue,
      fixedMonthlyPayment: item.fixedMonthlyPayment,
    }));
  const settingsPatch: NonNullable<FinancialMaintenancePatch["settings"]> = {};
  for (const key of [
    "safetyCoverageTargetMonths",
    "minimumCashCoverageMonths",
    "desiredMonthlyDiscretionarySpending",
  ] as const) {
    if (form.settings[key] !== initial.settings[key])
      settingsPatch[key] = form.settings[key] as never;
  }
  if (
    form.settings.safetyRecoveryHorizonMonths !== initial.settings.safetyRecoveryHorizonMonths &&
    form.settings.safetyRecoveryHorizonMonths !== undefined
  ) {
    settingsPatch.safetyRecoveryHorizonMonths = form.settings.safetyRecoveryHorizonMonths;
  }
  if (Object.keys(settingsPatch).length) patch.settings = settingsPatch;
  return patch;
}

function validateNewIncomeDrafts(
  drafts: MaintenanceForm["newIncome"],
  asOfDate: string,
): string | null {
  const targetMonth = asOfDate.slice(0, 7);
  for (const [index, draft] of drafts.entries()) {
    const started = Boolean(draft.amount.trim() || draft.date || draft.status);
    if (!started) continue;
    if (!draft.amount.trim()) return `第 ${index + 1} 笔本月收入缺少金额。`;
    if (!draft.date) return `第 ${index + 1} 笔本月收入缺少日期。`;
    if (draft.date.slice(0, 7) !== targetMonth)
      return `第 ${index + 1} 笔本月收入日期必须属于 ${targetMonth}。`;
    if (draft.date > asOfDate) return `第 ${index + 1} 笔本月收入日期不能晚于 ${asOfDate}。`;
    if (!draft.status) return `第 ${index + 1} 笔本月收入缺少到账状态。`;
  }
  return null;
}

export function FinancialMaintenanceDialog({
  initial,
  loading,
  error,
  onClose,
  onLoad,
  onSave,
  getRequirement,
}: {
  initial: FinancialMaintenanceState | null;
  loading: boolean;
  error: string;
  onClose: () => void;
  onLoad: () => Promise<void>;
  onSave: (patch: FinancialMaintenancePatch) => Promise<void>;
  getRequirement: (
    patch: FinancialMaintenancePatch,
  ) => Promise<{ requiresSafetyRecoveryHorizon: boolean }>;
}) {
  const [form, setForm] = useState<MaintenanceForm | null>(initial ? fromState(initial) : null);
  const [showRecoveryHorizon, setShowRecoveryHorizon] = useState(false);
  const [saving, setSaving] = useState(false);
  const [prevalidationError, setPrevalidationError] = useState("");
  const titleRef = useRef<HTMLHeadingElement>(null);
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!initial) return;
    setForm(fromState(initial));
    titleRef.current?.focus();
  }, [initial]);
  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onClose();
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previousFocus?.focus();
    };
  }, [onClose, saving]);

  function update<K extends keyof MaintenanceForm>(key: K, value: MaintenanceForm[K]) {
    setPrevalidationError("");
    setForm((current) => (current ? { ...current, [key]: value } : current));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!initial || !form) return;
    const incomeError = validateNewIncomeDrafts(form.newIncome, initial.asOfDate);
    if (incomeError) {
      setPrevalidationError(incomeError);
      return;
    }
    const patch = buildPatch(initial, form);
    if (!Object.keys(patch).length) {
      onClose();
      return;
    }
    setSaving(true);
    let requirement: { requiresSafetyRecoveryHorizon: boolean };
    try {
      requirement = await getRequirement(patch);
    } catch {
      setPrevalidationError("数据检查失败，尚未保存。请检查输入后重试。");
      setSaving(false);
      return;
    }
    if (
      requirement.requiresSafetyRecoveryHorizon &&
      form.settings.safetyRecoveryHorizonMonths === undefined
    ) {
      setShowRecoveryHorizon(true);
      setSaving(false);
      return;
    }
    try {
      await onSave(patch);
    } catch {
      setPrevalidationError("保存失败，数据未更改。请检查后重试。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="dialog-backdrop">
      <section
        ref={dialogRef}
        className="maintenance-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="maintenance-title"
      >
        <header className="dialog-header">
          <div>
            <p className="eyebrow">本月数据更新 · {initial?.asOfDate ?? ""}</p>
            <h2 id="maintenance-title" ref={titleRef} tabIndex={-1}>
              更新财务数据
            </h2>
          </div>
          <button
            type="button"
            className="close-button"
            onClick={onClose}
            disabled={saving}
            aria-label="关闭"
          >
            ×
          </button>
        </header>
        {loading && <p role="status">正在读取当前数据…</p>}
        {initial && form && (
          <form className="maintenance-form" onSubmit={submit}>
            <section className="maintenance-section">
              <h3>收入</h3>
              <label>
                稳定月收入
                <input
                  inputMode="decimal"
                  value={form.stableMonthlyIncome}
                  onChange={(e) => update("stableMonthlyIncome", e.target.value)}
                />
              </label>
              {initial.actualIncomeRecords.map((item) => (
                <p className="maintenance-readonly" key={item.id}>
                  {incomeStatus(item.status)} · {item.date} ·{" "}
                  <MoneyAmount value={item.amount} size="inline" />
                </p>
              ))}
              {form.newIncome.map((item, index) => (
                <div className="maintenance-row" key={item.key}>
                  <label>
                    金额
                    <input
                      inputMode="decimal"
                      value={item.amount}
                      onChange={(e) =>
                        update(
                          "newIncome",
                          form.newIncome.map((row, i) =>
                            i === index ? { ...row, amount: e.target.value } : row,
                          ),
                        )
                      }
                    />
                  </label>
                  <label>
                    日期
                    <input
                      type="date"
                      value={item.date}
                      onChange={(e) =>
                        update(
                          "newIncome",
                          form.newIncome.map((row, i) =>
                            i === index ? { ...row, date: e.target.value } : row,
                          ),
                        )
                      }
                    />
                  </label>
                  <label>
                    到账状态
                    <select
                      value={item.status}
                      onChange={(e) =>
                        update(
                          "newIncome",
                          form.newIncome.map((row, i) =>
                            i === index
                              ? { ...row, status: e.target.value as typeof row.status }
                              : row,
                          ),
                        )
                      }
                    >
                      <option value="">请选择</option>
                      <option value="EXPECTED">预计</option>
                      <option value="PENDING">待到账</option>
                      <option value="RECEIVED">已到账</option>
                    </select>
                  </label>
                </div>
              ))}
              <button
                className="text-button"
                type="button"
                onClick={() =>
                  update("newIncome", [
                    ...form.newIncome,
                    {
                      key: globalThis.crypto.randomUUID(),
                      amount: "",
                      date: "",
                      status: "",
                    },
                  ])
                }
              >
                ＋ 记录本月收入
              </button>
              <p className="field-hint">空白草稿会忽略；开始填写后需补齐金额、日期和到账状态。</p>
            </section>

            <section className="maintenance-section">
              <h3>必要支出</h3>
              {form.essentialExpenses.map((item, index) => (
                <div className="maintenance-row" key={item.id || `essential-${index}`}>
                  <label>
                    项目名称
                    <input
                      value={item.name}
                      onChange={(e) =>
                        update(
                          "essentialExpenses",
                          form.essentialExpenses.map((row, i) =>
                            i === index ? { ...row, name: e.target.value } : row,
                          ),
                        )
                      }
                    />
                  </label>
                  <label>
                    分类
                    <select
                      value={item.category}
                      onChange={(e) =>
                        update(
                          "essentialExpenses",
                          form.essentialExpenses.map((row, i) =>
                            i === index
                              ? { ...row, category: e.target.value as typeof row.category }
                              : row,
                          ),
                        )
                      }
                    >
                      {essentialCategories.map(([key, label]) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    月金额
                    <input
                      inputMode="decimal"
                      value={item.monthlyAmount}
                      onChange={(e) =>
                        update(
                          "essentialExpenses",
                          form.essentialExpenses.map((row, i) =>
                            i === index ? { ...row, monthlyAmount: e.target.value } : row,
                          ),
                        )
                      }
                    />
                  </label>
                </div>
              ))}
              <button
                className="text-button"
                type="button"
                onClick={() =>
                  update("essentialExpenses", [
                    ...form.essentialExpenses,
                    { name: "", category: "HOUSING", monthlyAmount: "" },
                  ])
                }
              >
                ＋ 添加必要支出
              </button>
            </section>

            <section className="maintenance-section">
              <h3>现金账户</h3>
              {form.cashAccounts.map((item, index) => (
                <div className="maintenance-row" key={item.id ?? `cash-${index}`}>
                  <label>
                    账户
                    <input
                      value={item.name}
                      onChange={(e) =>
                        update(
                          "cashAccounts",
                          form.cashAccounts.map((row, i) =>
                            i === index ? { ...row, name: e.target.value } : row,
                          ),
                        )
                      }
                    />
                  </label>
                  <label>
                    当前余额
                    <input
                      inputMode="decimal"
                      value={item.balance}
                      onChange={(e) =>
                        update(
                          "cashAccounts",
                          form.cashAccounts.map((row, i) =>
                            i === index ? { ...row, balance: e.target.value } : row,
                          ),
                        )
                      }
                    />
                  </label>
                  <label className="maintenance-check">
                    <input
                      type="checkbox"
                      checked={item.includeInSafetyResources}
                      onChange={(e) =>
                        update(
                          "cashAccounts",
                          form.cashAccounts.map((row, i) =>
                            i === index
                              ? { ...row, includeInSafetyResources: e.target.checked }
                              : row,
                          ),
                        )
                      }
                    />
                    计入安全储备
                  </label>
                </div>
              ))}
              <button
                className="text-button"
                type="button"
                onClick={() =>
                  update("cashAccounts", [
                    ...form.cashAccounts,
                    { name: "", balance: "0", includeInSafetyResources: true },
                  ])
                }
              >
                ＋ 添加现金账户
              </button>
            </section>

            <section className="maintenance-section">
              <h3>资产</h3>
              {form.assets.map((item, index) => (
                <div className="maintenance-row" key={item.id ?? `asset-${index}`}>
                  <label>
                    资产名称
                    <input
                      value={item.name}
                      onChange={(e) =>
                        update(
                          "assets",
                          form.assets.map((row, i) =>
                            i === index ? { ...row, name: e.target.value } : row,
                          ),
                        )
                      }
                    />
                  </label>
                  <label>
                    当前价值
                    <input
                      inputMode="decimal"
                      value={item.currentValue}
                      onChange={(e) =>
                        update(
                          "assets",
                          form.assets.map((row, i) =>
                            i === index ? { ...row, currentValue: e.target.value } : row,
                          ),
                        )
                      }
                    />
                  </label>
                  <label className="maintenance-check">
                    <input
                      type="checkbox"
                      checked={item.includeInSafetyResources}
                      onChange={(e) =>
                        update(
                          "assets",
                          form.assets.map((row, i) =>
                            i === index
                              ? { ...row, includeInSafetyResources: e.target.checked }
                              : row,
                          ),
                        )
                      }
                    />
                    计入安全储备
                  </label>
                </div>
              ))}
              <button
                className="text-button"
                type="button"
                onClick={() =>
                  update("assets", [
                    ...form.assets,
                    {
                      name: "",
                      kind: "LIQUID_INVESTMENT",
                      currentValue: "0",
                      includeInSafetyResources: false,
                    },
                  ])
                }
              >
                ＋ 添加资产
              </button>
            </section>

            <section className="maintenance-section">
              <h3>债务</h3>
              {form.debts.map((item, index) => (
                <div className="maintenance-row" key={item.id ?? `debt-${index}`}>
                  <label>
                    债务名称
                    <input
                      value={item.name}
                      onChange={(e) =>
                        update(
                          "debts",
                          form.debts.map((row, i) =>
                            i === index ? { ...row, name: e.target.value } : row,
                          ),
                        )
                      }
                    />
                  </label>
                  <label>
                    当前余额
                    <input
                      inputMode="decimal"
                      value={item.currentBalance}
                      onChange={(e) =>
                        update(
                          "debts",
                          form.debts.map((row, i) =>
                            i === index ? { ...row, currentBalance: e.target.value } : row,
                          ),
                        )
                      }
                    />
                  </label>
                  <label>
                    本月应还
                    <input
                      inputMode="decimal"
                      value={item.currentMonthDue ?? ""}
                      onChange={(e) =>
                        update(
                          "debts",
                          form.debts.map((row, i) =>
                            i === index ? { ...row, currentMonthDue: e.target.value || null } : row,
                          ),
                        )
                      }
                    />
                  </label>
                  <label>
                    固定月还款
                    <input
                      inputMode="decimal"
                      value={item.fixedMonthlyPayment ?? ""}
                      onChange={(e) =>
                        update(
                          "debts",
                          form.debts.map((row, i) =>
                            i === index
                              ? { ...row, fixedMonthlyPayment: e.target.value || null }
                              : row,
                          ),
                        )
                      }
                    />
                  </label>
                </div>
              ))}
              <button
                className="text-button"
                type="button"
                onClick={() =>
                  update("debts", [
                    ...form.debts,
                    {
                      name: "",
                      currentBalance: "",
                      currentMonthDue: null,
                      fixedMonthlyPayment: null,
                      needsCurrentMonthFact: false,
                    },
                  ])
                }
              >
                ＋ 添加债务
              </button>
            </section>

            <section className="maintenance-section maintenance-settings">
              <h3>本月计划</h3>
              <label>
                期望每月可选消费
                <input
                  inputMode="decimal"
                  value={form.settings.desiredMonthlyDiscretionarySpending}
                  onChange={(e) =>
                    update("settings", {
                      ...form.settings,
                      desiredMonthlyDiscretionarySpending: e.target.value,
                    })
                  }
                />
              </label>
              <label>
                安全储备目标（月）
                <input
                  inputMode="decimal"
                  value={form.settings.safetyCoverageTargetMonths}
                  onChange={(e) =>
                    update("settings", {
                      ...form.settings,
                      safetyCoverageTargetMonths: Number(e.target.value),
                    })
                  }
                />
              </label>
              <label>
                现金安全底线（月）
                <input
                  inputMode="decimal"
                  value={form.settings.minimumCashCoverageMonths}
                  onChange={(e) =>
                    update("settings", {
                      ...form.settings,
                      minimumCashCoverageMonths: Number(e.target.value),
                    })
                  }
                />
              </label>
              {showRecoveryHorizon && (
                <label>
                  安全储备恢复期限（月）
                  <input
                    required
                    inputMode="decimal"
                    value={form.settings.safetyRecoveryHorizonMonths ?? ""}
                    onChange={(e) =>
                      update("settings", {
                        ...form.settings,
                        safetyRecoveryHorizonMonths: Number(e.target.value),
                      })
                    }
                  />
                </label>
              )}
            </section>
            {(prevalidationError || error) && (
              <p className="form-error" role="alert">
                {prevalidationError || error}
              </p>
            )}
            <div className="dialog-actions">
              <button
                type="button"
                className="button button-secondary"
                disabled={saving}
                onClick={onClose}
              >
                取消
              </button>
              <button type="submit" className="button button-primary" disabled={saving}>
                {saving ? "保存中…" : "保存并更新"}
              </button>
            </div>
          </form>
        )}
        {!loading && !initial && error && (
          <>
            <p className="form-error" role="alert">
              {error}
            </p>
            <button className="button button-secondary" type="button" onClick={() => void onLoad()}>
              重新读取
            </button>
          </>
        )}
      </section>
    </div>
  );
}

function incomeStatus(status: FinancialMaintenanceState["actualIncomeRecords"][number]["status"]) {
  return status === "EXPECTED" ? "预计" : status === "PENDING" ? "待到账" : "已到账";
}
