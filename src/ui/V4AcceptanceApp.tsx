import { useCallback, useEffect, useState } from "react";
import {
  ACCEPTANCE_ACTUAL_IDS,
  ACCEPTANCE_AS_OF,
  ACCEPTANCE_CASH_NAME,
  ACCEPTANCE_MONTH,
  type AcceptanceHistories,
  type AcceptanceRuntimeInfo,
  createV4AcceptanceSandboxService,
  type V4AcceptanceSandboxService,
} from "../application/v4-acceptance-sandbox-service.js";
import type { V4FinancialReadState } from "../application/v4-foundation-service.js";

const checklist = [
  "10 月可以单独设置收入",
  "11 月会恢复按平时收入计算",
  "可以恢复“按平时收入算”",
  "修改平时收入不会覆盖本月单独设置",
  "可以查看收入修改前后的历史",
  "未来日期的修改不会让旧收入重新出现",
  "作废后会从指定日期开始失效",
  "现金账户停用后，过去的状态仍能查看",
  "关闭再打开后，验收数据仍然存在",
];

const actualLabels: Record<string, string> = {
  "acceptance-actual-a": "场景 A · 普通修改",
  "acceptance-actual-future": "场景 B · 收入日期在未来",
  "acceptance-actual-void": "场景 C · 修改后再作废",
  "acceptance-actual-legacy": "场景 D · 后来补录以前的收入",
};

const actualScenarioHints: Record<string, string> = {
  "acceptance-actual-a": "用于检查普通修改前后，过去和现在分别显示什么。",
  "acceptance-actual-future": "用于检查收入日期在未来时，旧记录不会提前显示。",
  "acceptance-actual-void": "用于检查作废后，这笔收入从指定日期起不再显示。",
  "acceptance-actual-legacy": "用于检查补录后，过去的记录还能不能正确查看。",
};

const statusLabels: Record<string, string> = {
  EXPECTED: "预计收入",
  PENDING: "待到账",
  RECEIVED: "已到账",
};

const planningSourceLabels: Record<string, string> = {
  STABLE_BASELINE: "按平时收入",
  MONTH_OVERRIDE: "本月单独设置",
  MONTH_INHERIT: "跟随平时收入",
};

function money(value: string | number | null | undefined) {
  return value === null || value === undefined
    ? "无记录"
    : `¥${Number(value).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function V4AcceptanceApp() {
  const [service, setService] = useState<V4AcceptanceSandboxService>();
  const [runtime, setRuntime] = useState<AcceptanceRuntimeInfo>();
  const [read, setRead] = useState<V4FinancialReadState>();
  const [actualRead, setActualRead] = useState<V4FinancialReadState>();
  const [cashRead, setCashRead] = useState<V4FinancialReadState>();
  const [histories, setHistories] = useState<AcceptanceHistories>();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [month, setMonth] = useState(ACCEPTANCE_MONTH);
  const [asOfDate, setAsOfDate] = useState(ACCEPTANCE_AS_OF);
  const [planningAmount, setPlanningAmount] = useState("15500");
  const [stableAmount, setStableAmount] = useState("13000");
  const [actualId, setActualId] = useState<string>(ACCEPTANCE_ACTUAL_IDS[0]);
  const [actualAsOf, setActualAsOf] = useState("2026-10-03");
  const [revisionEffective, setRevisionEffective] = useState("2026-10-04");
  const [businessDate, setBusinessDate] = useState("2026-10-02");
  const [revisionAmount, setRevisionAmount] = useState("950");
  const [revisionStatus, setRevisionStatus] = useState<"EXPECTED" | "PENDING" | "RECEIVED">(
    "PENDING",
  );
  const [cashAsOf, setCashAsOf] = useState("2026-10-14");
  const [cashDeactivateDate, setCashDeactivateDate] = useState("2026-10-15");
  const [checked, setChecked] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem("v4-acceptance-checklist") ?? "{}");
    } catch {
      return {};
    }
  });
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(
    async (activeService: V4AcceptanceSandboxService, readDate: string, period: string) => {
      const next = await activeService.read(period, readDate);
      setRead(next);
      setStableAmount(await activeService.stableIncome(period, readDate));
      setHistories(await activeService.histories());
    },
    [],
  );

  useEffect(() => {
    let alive = true;
    void createV4AcceptanceSandboxService()
      .then(async ({ service: created, runtime: info }) => {
        if (!alive) return;
        setService(created);
        setRuntime(info);
        await Promise.all([
          refresh(created, ACCEPTANCE_AS_OF, ACCEPTANCE_MONTH),
          created.read(ACCEPTANCE_MONTH, "2026-10-03").then(setActualRead),
          created.read(ACCEPTANCE_MONTH, "2026-10-14").then(setCashRead),
        ]);
      })
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : String(reason)),
      );
    return () => {
      alive = false;
    };
  }, [refresh]);

  async function run(action: () => Promise<unknown>, success: string) {
    if (!service) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await action();
      if (
        result &&
        typeof result === "object" &&
        "status" in result &&
        (result as { status: string }).status !== "SAVED" &&
        (result as { status: string }).status !== "NO_CHANGE"
      ) {
        throw new Error(`操作未保存：${JSON.stringify(result)}`);
      }
      setMessage(success);
      await Promise.all([
        refresh(service, asOfDate, month),
        service.read(ACCEPTANCE_MONTH, actualAsOf).then(setActualRead),
        service.read(ACCEPTANCE_MONTH, cashAsOf).then(setCashRead),
      ]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function refreshForDate(
    date: string,
    period = month,
    domain: "planning" | "actual" | "cash" = "planning",
  ) {
    if (!service) return;
    setBusy(true);
    setError("");
    try {
      const next = await service.read(period, date);
      if (domain === "planning") setRead(next);
      if (domain === "actual") setActualRead(next);
      if (domain === "cash") setCashRead(next);
      setHistories(await service.histories());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  const selectedActual = actualRead?.actualIncome.find((record) => record.id === actualId);
  const selectedCash = cashRead?.cashAccounts.find(
    (account) => account.name === ACCEPTANCE_CASH_NAME,
  );

  function toggleChecklist(item: string, value: boolean) {
    const next = { ...checked, [item]: value };
    setChecked(next);
    localStorage.setItem("v4-acceptance-checklist", JSON.stringify(next));
  }

  return (
    <main className="acceptance-shell">
      <header className="acceptance-header">
        <div>
          <p className="eyebrow">PERSONAL FINANCE · V0.1.2</p>
          <h1>小钱家 V4 验收版</h1>
          <p>新版功能验收</p>
          <p>功能验收环境 · 使用独立测试数据，不影响正式账本</p>
        </div>
        <strong>这是独立验收环境，不会修改你的正式数据</strong>
      </header>

      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      {message && (
        <div className="notice success" role="status">
          {message}
        </div>
      )}
      {!service || !runtime ? (
        <section className="panel">
          <h2>正在验证验收环境</h2>
          <p>数据库初始化与身份路径校验完成前不会启用操作。</p>
        </section>
      ) : (
        <>
          <details className="panel runtime">
            <summary>验收环境信息</summary>
            <dl>
              <dt>Bundle ID</dt>
              <dd>{runtime.identifier}</dd>
              <dt>验收数据库</dt>
              <dd>{runtime.databasePath}</dd>
              <dt>Schema</dt>
              <dd>V4 · migrations [1, 2, 3, 4]</dd>
            </dl>
          </details>

          <section className="panel">
            <h2>1 · 每月收入怎么安排</h2>
            <div className="field-grid">
              <label>
                平时每月收入
                <input
                  value={stableAmount}
                  onChange={(event) => setStableAmount(event.target.value)}
                  inputMode="decimal"
                />
              </label>
              <p className="hint">没有特殊情况时，每个月默认按这个收入计算</p>
              <label>
                要设置的月份
                <input
                  type="month"
                  value={month}
                  onChange={(event) => {
                    setMonth(event.target.value);
                    void refreshForDate(asOfDate, event.target.value, "planning");
                  }}
                />
              </label>
              <label>
                从哪天开始按新设置计算
                <input
                  type="date"
                  value={asOfDate}
                  onChange={(event) => setAsOfDate(event.target.value)}
                />
              </label>
            </div>
            <div className="button-row">
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(
                    () => service.updateStableIncome(stableAmount, asOfDate),
                    "平时收入已保存",
                  )
                }
              >
                保存平时收入
              </button>
            </div>
            <div className="result-card">
              <span>
                {month.slice(0, 4)} 年 {Number(month.slice(5, 7))} 月现在按多少收入算
              </span>
              <strong>{money(read?.planningIncome.amount)}</strong>
              <span>
                计算方式：{planningSourceLabels[read?.planningIncome.source ?? ""] ?? "—"}
              </span>
              <details className="technical-detail">
                <summary>技术详情</summary>
                <span>内部来源：{read?.planningIncome.source ?? "—"}</span>
              </details>
            </div>
            <div className="field-grid">
              <label>
                这个月想按多少收入算
                <input
                  value={planningAmount}
                  onChange={(event) => setPlanningAmount(event.target.value)}
                  inputMode="decimal"
                />
              </label>
            </div>
            <div className="button-row">
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(
                    () => service.savePlanning(month, asOfDate, planningAmount),
                    "本月收入设置已保存",
                  )
                }
              >
                这个月按这个金额算
              </button>
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() =>
                  void run(
                    () => service.savePlanning(month, asOfDate, null),
                    "已恢复按平时收入计算",
                  )
                }
              >
                恢复按平时收入算
              </button>
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => void refreshForDate(asOfDate, month, "planning")}
              >
                刷新结果
              </button>
            </div>
            <p className="hint">
              切换到 2026 年 11
              月，确认本月单独设置不会带到下个月。恢复平时收入会保留此前的修改记录。
            </p>
          </section>

          <section className="panel">
            <h2>2 · 实际收入记录</h2>
            <div className="field-grid">
              <label>
                测试场景
                <select value={actualId} onChange={(event) => setActualId(event.target.value)}>
                  {ACCEPTANCE_ACTUAL_IDS.map((id) => (
                    <option key={id} value={id}>
                      {actualLabels[id]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                查看哪一天的状态
                <input
                  type="date"
                  value={actualAsOf}
                  onChange={(event) => setActualAsOf(event.target.value)}
                />
              </label>
              <label>
                从哪天开始按新记录算
                <input
                  type="date"
                  value={revisionEffective}
                  onChange={(event) => setRevisionEffective(event.target.value)}
                />
              </label>
              <label>
                收入日期
                <input
                  type="date"
                  value={businessDate}
                  onChange={(event) => setBusinessDate(event.target.value)}
                />
              </label>
              <label>
                修改后的金额
                <input
                  value={revisionAmount}
                  onChange={(event) => setRevisionAmount(event.target.value)}
                  inputMode="decimal"
                />
              </label>
              <label>
                收入状态
                <select
                  value={revisionStatus}
                  onChange={(event) =>
                    setRevisionStatus(event.target.value as typeof revisionStatus)
                  }
                >
                  <option value="EXPECTED">预计收入</option>
                  <option value="PENDING">待到账</option>
                  <option value="RECEIVED">已到账</option>
                </select>
              </label>
            </div>
            <div className="button-row">
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(
                    () =>
                      service.reviseActual({
                        incomeId: actualId,
                        asOfDate: revisionEffective,
                        date: businessDate,
                        amount: revisionAmount,
                        status: revisionStatus,
                      }),
                    "收入记录已保存",
                  )
                }
              >
                保存修改
              </button>
              <button
                type="button"
                className="danger"
                disabled={busy}
                onClick={() =>
                  void run(
                    () =>
                      service.reviseActual({
                        incomeId: actualId,
                        asOfDate: revisionEffective,
                        date: businessDate,
                        amount: revisionAmount,
                        status: revisionStatus,
                        void: true,
                      }),
                    "这笔收入已作废",
                  )
                }
              >
                作废这笔收入
              </button>
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => void refreshForDate(actualAsOf, ACCEPTANCE_MONTH, "actual")}
              >
                查看这一天
              </button>
            </div>
            <div className="result-card">
              <span>{new Date(`${actualAsOf}T00:00:00`).toLocaleDateString("zh-CN")} 当天</span>
              <strong>
                {selectedActual
                  ? `${money(String(selectedActual.amount))} · ${statusLabels[selectedActual.status] ?? selectedActual.status}`
                  : "这一天没有收入记录"}
              </strong>
              <span>收入日期：{selectedActual?.date ?? "—"}</span>
              <details className="technical-detail">
                <summary>技术详情</summary>
                <span>内部状态：{selectedActual?.status ?? "—"}</span>
              </details>
            </div>
            <p className="hint">{actualScenarioHints[actualId]}</p>
            <p className="hint">四条测试记录彼此独立。作废不会删除此前的记录。</p>
          </section>

          <section className="panel">
            <h2>3 · 现金账户状态</h2>
            <div className="result-card">
              <span>余额宝 · 余额 ¥4,805.61</span>
              <strong>
                {selectedCash ? `使用中 · ${money(selectedCash.balance)}` : "这一天账户已停用"}
              </strong>
              <span>账户状态：{selectedCash ? "使用中" : "已停用"}</span>
            </div>
            <div className="field-grid">
              <label>
                查看哪一天的状态
                <input
                  type="date"
                  value={cashAsOf}
                  onChange={(event) => setCashAsOf(event.target.value)}
                />
              </label>
              <label>
                从哪天开始停用
                <input
                  type="date"
                  value={cashDeactivateDate}
                  onChange={(event) => setCashDeactivateDate(event.target.value)}
                />
              </label>
            </div>
            <div className="button-row">
              <button
                type="button"
                disabled={busy}
                onClick={() => void refreshForDate(cashAsOf, ACCEPTANCE_MONTH, "cash")}
              >
                查看这一天
              </button>
              <button
                type="button"
                className="danger"
                disabled={busy}
                onClick={() =>
                  void run(() => service.deactivateCash(cashDeactivateDate), "账户已停用")
                }
              >
                停用这个账户
              </button>
            </div>
            <p className="hint">
              10 月 14 日仍在使用；从 10 月 15 日起显示已停用。过去的账户状态和余额仍可查看。
            </p>
          </section>

          <section className="panel">
            <h2>4 · 历史记录</h2>
            <p className="hint">这里只用来查看修改记录，不会直接修改数据。</p>
            <HistoryTable
              title="月收入设置记录"
              headers={["记录编号", "月份", "从哪天开始", "设置方式", "金额"]}
              rows={
                histories?.planning.map((row) => [
                  row.revision_id,
                  row.period_month,
                  row.as_of_date,
                  planningSourceLabels[row.decision] ?? row.decision,
                  row.amount ?? "—",
                ]) ?? []
              }
            />
            <HistoryTable
              title="收入修改记录"
              headers={[
                "记录编号",
                "收入编号",
                "从哪天开始",
                "收入日期",
                "状态",
                "金额",
                "是否有效",
              ]}
              rows={
                histories?.actual.map((row) => [
                  row.revision_id,
                  row.income_id,
                  row.as_of_date,
                  row.date,
                  statusLabels[row.status] ?? row.status,
                  row.amount,
                  row.active ? "有效" : "已作废",
                ]) ?? []
              }
            />
            <HistoryTable
              title="现金账户状态记录"
              headers={["记录编号", "账户编号", "从哪天开始", "是否有效"]}
              rows={
                histories?.cash.map((row) => [
                  row.revision_id,
                  row.account_id,
                  row.as_of_date,
                  row.active ? "使用中" : "已停用",
                ]) ?? []
              }
            />
            <details className="technical-detail">
              <summary>技术详情（原始记录值）</summary>
              <p className="hint">
                本表仅展示当前记录中的编号和日期；内部枚举值可在技术日志中核对。
              </p>
            </details>
          </section>

          <section className="panel">
            <h2>5 · 我已经确认这些功能</h2>
            <p className="hint">仅由你手动勾选；应用不会自动代勾。</p>
            <div className="checklist">
              {checklist.map((item) => (
                <label key={item}>
                  <input
                    type="checkbox"
                    checked={Boolean(checked[item])}
                    onChange={(event) => toggleChecklist(item, event.target.checked)}
                  />
                  {item}
                </label>
              ))}
            </div>
          </section>

          <section className="panel reset-panel">
            <h2>重新开始验收</h2>
            <p>会清空这个验收版里的测试记录并恢复初始测试数据。不会影响你的正式账本。</p>
            <button
              type="button"
              className="danger"
              disabled={busy}
              onClick={() => {
                if (
                  window.confirm(
                    "确定清空这个验收版里的测试记录并恢复初始测试数据吗？不会影响你的正式账本。",
                  )
                )
                  void run(() => service.reset(), "验收数据已重置为初始合成场景");
              }}
            >
              恢复初始测试数据
            </button>
          </section>
        </>
      )}
      <footer>测试数据均为合成数据 · 关闭后重新打开会继续使用同一验收数据库</footer>
    </main>
  );
}

function HistoryTable({
  title,
  headers,
  rows,
}: {
  title: string;
  headers: string[];
  rows: Array<Array<string | number>>;
}) {
  return (
    <div className="history-block">
      <h3>{title}</h3>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {headers.map((header) => (
                <th key={header}>{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((row) => (
                <tr key={`${title}-${row[0]}`}>
                  {row.map((value, cell) => (
                    <td key={headers[cell]}>{value}</td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={headers.length}>暂无历史记录</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
