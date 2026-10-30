import { useMemo, useState } from "react";
import type {
  OnboardingRequirement,
  OnboardingSubmission,
} from "../application/product-service.js";
import { money } from "../model/money.js";
import { localDate } from "./date.js";

const essentials = [
  ["HOUSING", "住房"],
  ["BASIC_FOOD", "基本饮食"],
  ["TRANSPORT", "交通通勤"],
  ["UTILITIES_COMMUNICATIONS", "水电与通讯"],
  ["INSURANCE", "保险"],
  ["FAMILY_FIXED_RESPONSIBILITY", "家庭固定责任"],
  ["OTHER_ESSENTIAL", "其他必要支出"],
] as const;
let uiRowSequence = 0;
const newUiKey = () => `row-${++uiRowSequence}`;
type CashRow = {
  key: string;
  name: string;
  balance: string;
  includeInSafetyResources: "" | "yes" | "no";
};
type AssetRow = CashRow;
type DebtRow = {
  key: string;
  name: string;
  currentBalance: string;
  currentMonthDue: string;
  fixedMonthlyPayment: string;
};
const emptyCash = (): CashRow => ({
  key: newUiKey(),
  name: "",
  balance: "",
  includeInSafetyResources: "",
});
const emptyDebt = (): DebtRow => ({
  key: newUiKey(),
  name: "",
  currentBalance: "",
  currentMonthDue: "",
  fixedMonthlyPayment: "",
});
const blankEssentials = Object.fromEntries(essentials.map(([key]) => [key, ""])) as Record<
  (typeof essentials)[number][0],
  string
>;

export function Onboarding({
  onComplete,
  getRequirement,
}: {
  onComplete: (submission: OnboardingSubmission, asOfDate: string) => Promise<void>;
  getRequirement: (submission: OnboardingSubmission, asOfDate: string) => OnboardingRequirement;
}) {
  const [step, setStep] = useState(0);
  const [displayName, setDisplayName] = useState("");
  const [stableMonthlyIncome, setIncome] = useState("");
  const [essentialValues, setEssentialValues] = useState(blankEssentials);
  const [cashAccounts, setCash] = useState<CashRow[]>([emptyCash()]);
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [debts, setDebts] = useState<DebtRow[]>([]);
  const [target, setTarget] = useState("");
  const [floor, setFloor] = useState("");
  const [desired, setDesired] = useState("");
  const [horizon, setHorizon] = useState("");
  const [needsHorizon, setNeedsHorizon] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const submission = useMemo<OnboardingSubmission | undefined>(() => {
    const submittedAssets = assets.filter((row) => row.name.trim() || row.balance.trim());
    // Keep the form's unselected state out of the strict Application Service
    // contract. A boolean `false` is emitted only for an explicit "no" choice.
    if (
      cashAccounts.some((row) => row.includeInSafetyResources === "") ||
      submittedAssets.some((row) => row.includeInSafetyResources === "")
    )
      return undefined;

    return {
      ...(displayName.trim() ? { displayName: displayName.trim() } : {}),
      stableMonthlyIncome,
      essentialExpenses: essentials.flatMap(([category]) =>
        essentialValues[category].trim()
          ? [{ category, monthlyAmount: essentialValues[category].trim() }]
          : [],
      ),
      cashAccounts: cashAccounts.map((row) => ({
        name: row.name.trim(),
        balance: row.balance.trim(),
        includeInSafetyResources: row.includeInSafetyResources === "yes",
      })),
      assets: submittedAssets.map((row) => ({
        name: row.name.trim(),
        currentValue: row.balance.trim(),
        includeInSafetyResources: row.includeInSafetyResources === "yes",
      })),
      debts: debts
        .filter(
          (row) =>
            row.name.trim() ||
            row.currentBalance.trim() ||
            row.currentMonthDue.trim() ||
            row.fixedMonthlyPayment.trim(),
        )
        .map((row) => ({
          name: row.name.trim(),
          currentBalance: row.currentBalance.trim(),
          ...(row.currentMonthDue.trim() ? { currentMonthDue: row.currentMonthDue.trim() } : {}),
          ...(row.fixedMonthlyPayment.trim()
            ? { fixedMonthlyPayment: row.fixedMonthlyPayment.trim() }
            : {}),
        })),
      safetyCoverageTargetMonths: Number(target),
      minimumCashCoverageMonths: Number(floor),
      desiredMonthlyDiscretionarySpending: desired,
      ...(horizon.trim() ? { safetyRecoveryHorizonMonths: Number(horizon.trim()) } : {}),
    };
  }, [
    displayName,
    stableMonthlyIncome,
    essentialValues,
    cashAccounts,
    assets,
    debts,
    target,
    floor,
    desired,
    horizon,
  ]);

  function fail(message: string) {
    setError(message);
  }
  function validateStep() {
    if (step === 0 && !validMoney(stableMonthlyIncome)) return "请填写有效的每月稳定收入。";
    if (
      step === 1 &&
      Object.values(essentialValues).some(
        (amount) => amount.trim() && (!validMoney(amount) || money(amount).isNegative()),
      )
    )
      return "每项必要支出都必须大于或等于 0。";
    if (step === 2) {
      if (!cashAccounts.length) return "请至少添加一个现金账户。";
      if (
        cashAccounts.some(
          (row) =>
            !row.name.trim() || !validMoney(row.balance) || row.includeInSafetyResources === "",
        )
      )
        return "请补全每个现金账户的名称、余额，并选择是否用于安全储备。";
      if (
        assets.some(
          (row) =>
            (row.name.trim() || row.balance.trim()) &&
            (!row.name.trim() || !validMoney(row.balance) || row.includeInSafetyResources === ""),
        )
      )
        return "请补全每项流动投资资产的名称、金额和安全储备选择。";
      if (
        debts.some((row) => {
          const started =
            row.name.trim() ||
            row.currentBalance.trim() ||
            row.currentMonthDue.trim() ||
            row.fixedMonthlyPayment.trim();
          return (
            Boolean(started) &&
            (!row.name.trim() ||
              !validMoney(row.currentBalance) ||
              (Boolean(row.currentMonthDue) && !validMoney(row.currentMonthDue)) ||
              (Boolean(row.fixedMonthlyPayment) && !validMoney(row.fixedMonthlyPayment)))
          );
        })
      )
        return "请补全每项债务的名称和余额，并检查可选还款金额。";
    }
    if (step === 3) {
      if (!validNonnegative(target)) return "请选择或填写安全覆盖目标（月）。";
      if (!validNonnegative(floor)) return "请选择或填写最低现金覆盖（月）。";
      if (!validMoney(desired)) return "请填写有效的期望每月弹性消费金额。";
    }
    if (step === 4 && needsHorizon && !validPositive(horizon))
      return "请填写大于 0 的安全储备恢复周期（月）。";
    return "";
  }

  async function next() {
    setError("");
    const issue = validateStep();
    if (issue) return fail(issue);
    if (step < 3) {
      setStep(step + 1);
      return;
    }
    if (step === 3 && !needsHorizon) {
      if (!submission) return fail("请补全每个账户和资产的安全储备选择。");
      try {
        const requirement = getRequirement(submission, localDate(new Date()));
        if (requirement.requiresSafetyRecoveryHorizon) {
          setNeedsHorizon(true);
          setStep(4);
          return;
        }
      } catch (cause) {
        return fail(cause instanceof Error ? cause.message : String(cause));
      }
    }
    await save();
  }

  async function save() {
    const issue = validateStep();
    if (issue) return fail(issue);
    if (!submission) return fail("请补全每个账户和资产的安全储备选择。");
    setSaving(true);
    setError("");
    try {
      await onComplete(submission, localDate(new Date()));
    } catch (cause) {
      fail(cause instanceof Error ? cause.message : "保存失败，请检查信息后重试。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="onboarding-page">
      <header className="brand-row">
        <div className="brand-mark" aria-hidden="true">
          ◒
        </div>
        <span>小钱家</span>
        <span className="local-chip">仅保存在本机</span>
      </header>
      <section className="onboarding-card" aria-labelledby="onboarding-title">
        <div className="step-meta">
          <span>
            初次设置 · {step + 1} / {needsHorizon ? 5 : 4}
          </span>
          <div className="step-track">
            <i style={{ width: `${((step + 1) / (needsHorizon ? 5 : 4)) * 100}%` }} />
          </div>
        </div>
        <h1 id="onboarding-title">
          {
            [
              "先认识一下你的收入",
              "必要支出大致是多少？",
              "你现在有哪些储备？",
              "设定适合你的安全目标",
              "补充恢复周期",
            ][step]
          }
        </h1>
        <p className="onboarding-intro">
          {
            [
              "填入你每月比较稳定的收入，其他复杂信息以后再慢慢补充。",
              "只填写你确实承担的项目，留空即可。",
              "按现在的余额填写，并由你决定哪些可用于应急。",
              "目标由你决定；没有系统预设的标准答案。",
              "按照模型需要，补充你希望恢复安全储备的时间。",
            ][step]
          }
        </p>
        {step === 0 && (
          <div className="form-stack">
            <label>
              每月稳定收入（元）
              <input
                inputMode="decimal"
                value={stableMonthlyIncome}
                onChange={(e) => setIncome(e.target.value)}
                placeholder="例如 12000"
              />
            </label>
            <label>
              怎么称呼你（选填）
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="名字或昵称"
              />
            </label>
          </div>
        )}
        {step === 1 && (
          <div className="expense-grid">
            {essentials.map(([key, label]) => (
              <label key={key}>
                {label}
                <div className="input-suffix">
                  <input
                    inputMode="decimal"
                    value={essentialValues[key]}
                    onChange={(e) =>
                      setEssentialValues({ ...essentialValues, [key]: e.target.value })
                    }
                    placeholder="可留空"
                  />
                  <span>元 / 月</span>
                </div>
              </label>
            ))}
          </div>
        )}
        {step === 2 && (
          <div className="form-stack">
            <section className="entry-group">
              <div className="entry-heading">
                <div>
                  <h2>现金账户</h2>
                  <p>至少填写一个账户</p>
                </div>
                <button
                  className="text-button"
                  type="button"
                  onClick={() => setCash([...cashAccounts, emptyCash()])}
                >
                  ＋ 添加
                </button>
              </div>
              {cashAccounts.map((row, i) => (
                <div className="entry-row" key={row.key}>
                  <label>
                    账户名称
                    <input
                      value={row.name}
                      onChange={(e) =>
                        setCash(
                          updateRow(cashAccounts, setCash, i, { ...row, name: e.target.value }),
                        )
                      }
                      placeholder="例如：日常账户"
                    />
                  </label>
                  <label>
                    当前余额
                    <input
                      inputMode="decimal"
                      value={row.balance}
                      onChange={(e) =>
                        setCash(
                          updateRow(cashAccounts, setCash, i, { ...row, balance: e.target.value }),
                        )
                      }
                      placeholder="金额"
                    />
                  </label>
                  <label>
                    可用于安全储备
                    <select
                      value={row.includeInSafetyResources}
                      onChange={(e) =>
                        setCash(
                          updateRow(cashAccounts, setCash, i, {
                            ...row,
                            includeInSafetyResources: e.target
                              .value as CashRow["includeInSafetyResources"],
                          }),
                        )
                      }
                    >
                      <option value="">请选择</option>
                      <option value="yes">可以</option>
                      <option value="no">不可以</option>
                    </select>
                  </label>
                  {cashAccounts.length > 1 && (
                    <button
                      className="remove-button"
                      type="button"
                      aria-label="删除现金账户"
                      onClick={() => setCash(cashAccounts.filter((_, index) => index !== i))}
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
            </section>
            <section className="entry-group">
              <div className="entry-heading">
                <div>
                  <h2>流动投资资产</h2>
                  <p>例如可以较容易变现的投资；没有可跳过</p>
                </div>
                <button
                  className="text-button"
                  type="button"
                  onClick={() => setAssets([...assets, emptyCash()])}
                >
                  ＋ 添加
                </button>
              </div>
              {assets.map((row, i) => (
                <div className="entry-row" key={row.key}>
                  <label>
                    资产名称
                    <input
                      value={row.name}
                      onChange={(e) =>
                        setAssets(updateRow(assets, setAssets, i, { ...row, name: e.target.value }))
                      }
                      placeholder="例如：基金"
                    />
                  </label>
                  <label>
                    当前金额
                    <input
                      inputMode="decimal"
                      value={row.balance}
                      onChange={(e) =>
                        setAssets(
                          updateRow(assets, setAssets, i, { ...row, balance: e.target.value }),
                        )
                      }
                      placeholder="金额"
                    />
                  </label>
                  <label>
                    纳入安全储备
                    <select
                      value={row.includeInSafetyResources}
                      onChange={(e) =>
                        setAssets(
                          updateRow(assets, setAssets, i, {
                            ...row,
                            includeInSafetyResources: e.target
                              .value as AssetRow["includeInSafetyResources"],
                          }),
                        )
                      }
                    >
                      <option value="">请选择</option>
                      <option value="yes">纳入</option>
                      <option value="no">不纳入</option>
                    </select>
                  </label>
                  <button
                    className="remove-button"
                    type="button"
                    aria-label="删除投资资产"
                    onClick={() => setAssets(assets.filter((_, index) => index !== i))}
                  >
                    ×
                  </button>
                </div>
              ))}
            </section>
            <section className="entry-group">
              <div className="entry-heading">
                <div>
                  <h2>债务</h2>
                  <p>本月有明确应还金额时，优先填写本月应还</p>
                </div>
                <button
                  className="text-button"
                  type="button"
                  onClick={() => setDebts([...debts, emptyDebt()])}
                >
                  ＋ 添加
                </button>
              </div>
              {debts.map((row, i) => (
                <div className="debt-row" key={row.key}>
                  <label>
                    债务名称
                    <input
                      value={row.name}
                      onChange={(e) =>
                        setDebts(updateRow(debts, setDebts, i, { ...row, name: e.target.value }))
                      }
                      placeholder="例如：贷款"
                    />
                  </label>
                  <label>
                    当前余额
                    <input
                      inputMode="decimal"
                      value={row.currentBalance}
                      onChange={(e) =>
                        setDebts(
                          updateRow(debts, setDebts, i, { ...row, currentBalance: e.target.value }),
                        )
                      }
                      placeholder="金额"
                    />
                  </label>
                  <label>
                    本月应还（选填）
                    <input
                      inputMode="decimal"
                      value={row.currentMonthDue}
                      onChange={(e) =>
                        setDebts(
                          updateRow(debts, setDebts, i, {
                            ...row,
                            currentMonthDue: e.target.value,
                          }),
                        )
                      }
                      placeholder="金额"
                    />
                  </label>
                  <label>
                    固定月供（选填）
                    <input
                      inputMode="decimal"
                      value={row.fixedMonthlyPayment}
                      onChange={(e) =>
                        setDebts(
                          updateRow(debts, setDebts, i, {
                            ...row,
                            fixedMonthlyPayment: e.target.value,
                          }),
                        )
                      }
                      placeholder="金额"
                    />
                  </label>
                  <button
                    className="remove-button"
                    type="button"
                    aria-label="删除债务"
                    onClick={() => setDebts(debts.filter((_, index) => index !== i))}
                  >
                    ×
                  </button>
                </div>
              ))}
            </section>
          </div>
        )}
        {step === 3 && (
          <div className="form-stack settings-fields">
            <fieldset>
              <legend>安全覆盖目标（月）</legend>
              <p>必要支出和必须还款的目标储备周期，由你选择。</p>
              <ChoiceField
                values={["3", "6", "9", "12"]}
                value={target}
                onChange={setTarget}
                customLabel="自定义"
              />
            </fieldset>
            <fieldset>
              <legend>最低现金覆盖（月）</legend>
              <p>现金底线只按你选中的可用现金计算。</p>
              <ChoiceField
                values={["1", "2", "3"]}
                value={floor}
                onChange={setFloor}
                customLabel="自定义"
              />
            </fieldset>
            <label>
              期望每月弹性消费（元）
              <input
                inputMode="decimal"
                value={desired}
                onChange={(e) => setDesired(e.target.value)}
                placeholder="由你设定的目标"
              />
              <small>这是你的目标值；实际建议金额由模型计算。</small>
            </label>
          </div>
        )}
        {step === 4 && (
          <div className="form-stack">
            <fieldset>
              <legend>安全储备恢复周期（月）</legend>
              <ChoiceField
                values={["6", "12", "18", "24"]}
                value={horizon}
                onChange={setHorizon}
                customLabel="自定义"
              />
            </fieldset>
            <p className="inline-note">这是你的设定，模型会据此计算每月恢复金额。</p>
          </div>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <footer className="form-actions">
          {step > 0 && (
            <button
              className="button button-secondary"
              type="button"
              onClick={() => {
                setError("");
                setStep(step - 1);
              }}
            >
              上一步
            </button>
          )}
          <button
            className="button button-primary"
            type="button"
            onClick={() => void next()}
            disabled={saving}
          >
            {saving
              ? "正在保存…"
              : step === 3 && !needsHorizon
                ? "完成设置"
                : step === 4
                  ? "完成设置"
                  : "继续"}
            <span aria-hidden="true">→</span>
          </button>
        </footer>
      </section>
      <p className="onboarding-footnote">之后可在本机继续记录消费，你的数据不会自动上传。</p>
    </main>
  );
}

function ChoiceField({
  values,
  value,
  onChange,
  customLabel,
}: {
  values: string[];
  value: string;
  onChange: (value: string) => void;
  customLabel: string;
}) {
  const custom = value === "custom" || (value !== "" && !values.includes(value));
  return (
    <div className="choice-wrap">
      <div className="choice-row">
        {values.map((item) => (
          <button
            type="button"
            key={item}
            className={`choice ${value === item ? "selected" : ""}`}
            aria-pressed={value === item}
            onClick={() => onChange(item)}
          >
            {item} 个月
          </button>
        ))}
        <button
          type="button"
          className={`choice ${custom ? "selected" : ""}`}
          aria-pressed={custom}
          onClick={() => onChange("custom")}
        >
          {customLabel}
        </button>
      </div>
      {(value === "custom" || custom) && (
        <input
          className="custom-month"
          inputMode="decimal"
          aria-label={`${customLabel}月数`}
          placeholder="输入月数"
          value={custom ? value : ""}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}

function updateRow<T>(rows: T[], _setter: (rows: T[]) => void, index: number, value: T) {
  return rows.map((row, i) => (i === index ? value : row));
}
function validMoney(value: string) {
  return /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value.trim());
}
function validNonnegative(value: string) {
  return /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value.trim());
}
function validPositive(value: string) {
  return validNonnegative(value) && Number(value) > 0;
}
