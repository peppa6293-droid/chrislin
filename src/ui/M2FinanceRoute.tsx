import { BarChart3, ChevronRight, Home as HomeIcon, ListChecks, Wallet } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  FinancialMaintenancePatch,
  FinancialMaintenanceState,
} from "../application/financial-maintenance-service.js";
import type { ExpenseSubmission, HomeApplicationState } from "../application/product-service.js";
import type { EssentialPaymentRecord } from "../application/ux-ledger-service.js";
import { money } from "../model/money.js";
import type { ExpenseCategory } from "../model/types.js";
import type { ApplicationDataError } from "../persistence/database.js";
import type { ProductApplicationServices } from "./contracts.js";
import { localDate } from "./date.js";
import {
  FinancialMaintenanceDialog,
  type MaintenanceDeactivation,
} from "./FinancialMaintenanceDialog.js";
import { M1Home } from "./M1Home.js";
import { M2FixedExpensesPage } from "./M2FixedExpensesPage.js";
import type { DeductionAccountOption, ExpenseSaveReceipt } from "./V2HomeSurface.js";
import "./m2-fixed-expenses.css";
import "./m2-theme.css";

type Tab = "TODAY" | "RECORDS" | "PROGRESS" | "MONEY";

/**
 * 业务阶段（REWORK-02 §5.2）：草稿 → 写前核查 → 提交中 → 读回中 → 已确认；
 * 任何写在派发后的异常/读回失败/不匹配都只能落到 UNKNOWN（待核查）。
 */
export type OperationPhase =
  | "DRAFT"
  | "PRE_CHECK"
  | "SUBMITTING"
  | "READBACK"
  | "CONFIRMED"
  | "UNKNOWN";

/**
 * 固定支出业务操作由宿主唯一持有（§5.1）：令牌、会话业务日、冻结草稿、
 * 新增的固定 UUID 与写前集合/合计、付款收据、派发标记、阶段、锁与文案。
 * 子页面只保留未提交编辑与展示状态。
 */
export type AddOperation = {
  kind: "ADD";
  /** 唯一前端操作令牌；晚回调只认这一个。 */
  token: string;
  /** 会话业务日：跨过它就不再用旧日期写入。 */
  asOfDate: string;
  phase: OperationPhase;
  /** 整个未确认流程复用的同一个 UUID。 */
  itemId: string;
  draft: { name: string; category: string; amount: string };
  /** 写前项目集合与合计。 */
  beforeIds: string[];
  beforeTotal: string;
  /** 写服务是否已派发：派发后不得再派发第二次。 */
  dispatched: boolean;
  /** 未知结果/身份不符时锁死整条固定支出写入。 */
  locked: boolean;
  message: string;
};

export type PayOperation = {
  kind: "PAY";
  token: string;
  asOfDate: string;
  phase: OperationPhase;
  itemId: string;
  itemName: string;
  amount: string;
  paidOn: string;
  note: string;
  targetMonth: string;
  beforeTotal: string;
  dispatched: boolean;
  /** 正常返回后取得的完整付款收据；reject 时保持 null。 */
  receipt: EssentialPaymentRecord | null;
  locked: boolean;
  message: string;
};

export type FixedExpenseOperation = AddOperation | PayOperation;

const UNKNOWN_MESSAGE = "暂时无法确认是否保存，请先不要重复操作";
const CROSS_DAY_MESSAGE = "日期已变化，暂时不能添加。";
const PAY_CROSS_DAY_MESSAGE = "日期已变化，暂时不能记录这笔付款。请完全退出应用后重新打开。";
const ADD_MISMATCH_MESSAGE = "已找到这项支出，但金额核对还没完成，请先不要重复添加";
/** 事务前即可证明零写入的四个码；其余异常仍按 UNKNOWN 锁定。 */
const PAY_REJECTION_MESSAGES: Record<string, string> = {
  INVALID_PAYMENT_AMOUNT: "没有保存。付款金额不正确，请检查后再试。",
  INVALID_DATE: "没有保存。付款日期不正确，请重新选择日期。",
  ESSENTIAL_ITEM_NOT_FOUND:
    "没有保存。这个固定支出项目不存在或已停用，请返回固定支出列表确认后再试。",
  INVALID_ESSENTIAL_CATEGORY: "没有保存。这个项目的类别不能记为固定支出，请返回列表确认。",
};

function payRejectionMessage(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const candidate = error as Partial<ApplicationDataError>;
  if (candidate.name !== "ApplicationDataError" || typeof candidate.code !== "string") return null;
  return PAY_REJECTION_MESSAGES[candidate.code] ?? null;
}

function sumAmounts(values: string[]): string {
  return values.reduce((total, value) => total.plus(money(value)), money("0")).toString();
}

function fileNameOf(path: string): string {
  return path.split("/").pop() ?? path;
}

function inFlight(operation: FixedExpenseOperation | null): boolean {
  if (!operation) return false;
  return (
    operation.phase === "PRE_CHECK" ||
    operation.phase === "SUBMITTING" ||
    operation.phase === "READBACK"
  );
}

/**
 * M2 导航壳：常驻底部/侧边导航 + 我的财务分组页。
 *
 * 导航必须渲染在 [data-testid="m1-home"] 之外——M1 首页是被保护的基线，
 * 它内部不允许出现 navigation、也不允许出现「我的财务」等入口文案。
 * 首页快捷入口保持 0 个：进入固定支出只有「我的财务 → 固定支出」这一条路。
 *
 * 「记录」「进展」两页本卡未设计，按已批设计只显示标题与「暂未开放」。
 */
export function M2FinanceRoute({
  services,
  asOfDate,
  home,
  onHome,
  onRecordExpense,
}: {
  services: ProductApplicationServices;
  asOfDate: string;
  home: HomeApplicationState;
  onHome: (home: HomeApplicationState) => void;
  onRecordExpense: (expense: ExpenseSubmission, asOfDate: string) => Promise<ExpenseSaveReceipt>;
}) {
  const [tab, setTab] = useState<Tab>("TODAY");
  const [fixedExpensesOpen, setFixedExpensesOpen] = useState(false);
  const [operation, setOperation] = useState<FixedExpenseOperation | null>(null);
  const [dataVersion, setDataVersion] = useState(0);
  const [deductionAccounts, setDeductionAccounts] = useState<DeductionAccountOption[]>([]);
  const [maintenanceOpen, setMaintenanceOpen] = useState(false);
  const [maintenanceData, setMaintenanceData] = useState<FinancialMaintenanceState | null>(null);
  const [maintenanceLoading, setMaintenanceLoading] = useState(false);
  const [maintenanceError, setMaintenanceError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportNote, setExportNote] = useState("");
  const [exportError, setExportError] = useState("");
  // 扣减下拉走 S1 维护状态（现金账户 + 记账卡），不碰 V2 accounts 表。
  // dataVersion 变化=停用/保存后重读，已停用账户不再出现在下拉里。
  // biome-ignore lint/correctness/useExhaustiveDependencies: dataVersion 是重读触发器，不是推导值
  useEffect(() => {
    let cancelled = false;
    services
      .getFinancialMaintenanceState(asOfDate)
      .then((state) => {
        if (cancelled) return;
        setDeductionAccounts([
          ...state.cashAccounts.map((account) => ({ id: account.id, label: account.name })),
          ...state.debts
            .filter((debt) => debt.dailySpendingMode)
            .map((debt) => ({ id: debt.id, label: `${debt.name}（记账卡）` })),
        ]);
      })
      .catch(() => {
        if (!cancelled) setDeductionAccounts([]);
      });
    return () => {
      cancelled = true;
    };
  }, [services, asOfDate, dataVersion]);

  const loadMaintenance = useCallback(async () => {
    setMaintenanceLoading(true);
    try {
      setMaintenanceData(await services.getFinancialMaintenanceState(asOfDate));
      setMaintenanceError("");
    } catch {
      setMaintenanceError("无法读取当前财务数据，请稍后重试。");
    } finally {
      setMaintenanceLoading(false);
    }
  }, [services, asOfDate]);

  /** 导出走既有备份服务（B1），M2 壳此前没有入口；只报文件名，路径不进界面。 */
  const runExport = useCallback(
    async (kind: "LEDGER" | "DATABASE") => {
      const backup = services.exportDatabaseBackup;
      if (kind === "DATABASE" && !backup) return;
      setExporting(true);
      setExportError("");
      setExportNote("");
      try {
        if (kind === "DATABASE" && backup) {
          const result = await backup();
          setExportNote(`数据库备份已保存：${fileNameOf(result.path)}`);
        } else {
          const result = await services.exportLedger(asOfDate);
          setExportNote(
            `备份已保存：${fileNameOf(result.jsonPath)}、${fileNameOf(result.csvPath)}`,
          );
        }
      } catch {
        setExportError("导出未完成，请稍后再试。");
      } finally {
        setExporting(false);
      }
    },
    [asOfDate, services],
  );

  /** 停用/软删除后：先读回首页，再让固定支出清单与扣减下拉重读。 */
  const afterDeactivate = useCallback(async () => {
    try {
      onHome(await services.getHomeApplicationState(asOfDate));
    } catch {
      // 停用已落库；首页读回失败不改变结果，下次进入再刷新。
    } finally {
      setDataVersion((value) => value + 1);
    }
  }, [asOfDate, onHome, services]);

  const deactivateEssential = useCallback(
    async (item: { id: string; name: string; category: string; monthlyAmount: string }) => {
      const result = await services.saveEssentialItems(
        [
          {
            id: item.id,
            name: item.name,
            category: item.category as ExpenseCategory,
            monthlyAmount: item.monthlyAmount,
            active: false,
          },
        ],
        asOfDate,
      );
      onHome(result.home);
      setDataVersion((value) => value + 1);
    },
    [asOfDate, onHome, services],
  );

  const deactivateMaintenance = useCallback(
    async (target: MaintenanceDeactivation) => {
      if (target.kind === "ESSENTIAL") {
        await deactivateEssential(target);
        return;
      }
      const result =
        target.kind === "CASH"
          ? await services.deactivateCashAccount(target.id, asOfDate)
          : target.kind === "ASSET"
            ? await services.deactivateAsset(target.id, asOfDate)
            : await services.deactivateDebt(target.id, asOfDate.slice(0, 7), asOfDate);
      if (result.status !== "SAVED" && result.status !== "NO_CHANGE") throw new Error("停用未完成");
      await afterDeactivate();
    },
    [afterDeactivate, asOfDate, deactivateEssential, services],
  );
  // 异步链必须读到最新操作，不能依赖下一轮渲染的 state。
  const opRef = useRef<FixedExpenseOperation | null>(null);
  const seqRef = useRef(0);
  // 同步提交守卫：首次 await 之前占用，ADD/PAY 共用固定支出写入互斥。
  const writeGuard = useRef<string | null>(null);

  const commit = useCallback((next: FixedExpenseOperation | null) => {
    opRef.current = next;
    setOperation(next);
  }, []);

  const nextToken = useCallback(() => {
    seqRef.current += 1;
    return `op-${seqRef.current}`;
  }, []);

  /** 未确认草稿的挂起与复用：同一个未确认流程只用一个 UUID。 */
  const prepareAdd = useCallback(
    (draft: { name: string; category: string; amount: string }) => {
      if (writeGuard.current) return;
      const current = opRef.current;
      if (current?.locked) return;
      const reuse = current?.kind === "ADD" && !current.dispatched ? current : null;
      commit({
        kind: "ADD",
        token: reuse ? reuse.token : nextToken(),
        asOfDate,
        phase: "DRAFT",
        itemId: reuse ? reuse.itemId : globalThis.crypto.randomUUID(),
        draft,
        beforeIds: [],
        beforeTotal: "0",
        dispatched: false,
        locked: false,
        message: "",
      });
    },
    [asOfDate, commit, nextToken],
  );

  /** 新增完整核对：写前集合 → 写 → 独立读回四字段与合计 → 独立会话日 home。 */
  const runAdd = useCallback(
    async (base: AddOperation) => {
      const token = base.token;
      const live = () => {
        const now = opRef.current;
        return now !== null && now.kind === "ADD" && now.token === token ? now : null;
      };
      const fail = (message: string) => {
        const now = live();
        if (!now) return;
        commit({ ...now, phase: "UNKNOWN", locked: true, message });
      };

      commit({ ...base, phase: "PRE_CHECK", message: "" });
      let before: Awaited<ReturnType<ProductApplicationServices["listEssentialPaymentItems"]>>;
      try {
        before = await services.listEssentialPaymentItems(base.asOfDate);
      } catch {
        writeGuard.current = null;
        fail(UNKNOWN_MESSAGE);
        return;
      }
      const beforeNow = live();
      if (!beforeNow) return;
      if (before.some((item) => item.id === base.itemId)) {
        writeGuard.current = null;
        fail(UNKNOWN_MESSAGE);
        return;
      }
      const beforeIds = before.map((item) => item.id);
      const beforeTotal = sumAmounts(before.map((item) => item.monthlyAmount));
      commit({
        ...beforeNow,
        phase: "SUBMITTING",
        dispatched: true,
        beforeIds,
        beforeTotal,
      });

      try {
        await services.saveEssentialItems(
          [
            {
              id: base.itemId,
              name: base.draft.name,
              category: base.draft.category as "HOUSING",
              monthlyAmount: base.draft.amount,
            },
          ],
          base.asOfDate,
        );
      } catch {
        writeGuard.current = null;
        // reject 后先做只读核查：只读、不写、不重试、不解锁。
        // 空清单或读到同 id 都不能证明「未保存」或「已完成」，一律保持待核查。
        try {
          await services.listEssentialPaymentItems(base.asOfDate);
        } catch {
          // 读不到也不改变「待核查」的结论。
        }
        fail(UNKNOWN_MESSAGE);
        return;
      }

      const submittingNow = live();
      if (!submittingNow) return;
      commit({ ...submittingNow, phase: "READBACK" });
      let readback: Awaited<ReturnType<ProductApplicationServices["listEssentialPaymentItems"]>>;
      try {
        readback = await services.listEssentialPaymentItems(base.asOfDate);
      } catch {
        writeGuard.current = null;
        fail(UNKNOWN_MESSAGE);
        return;
      }
      const readbackNow = live();
      if (!readbackNow) return;
      const found = readback.filter((item) => item.id === base.itemId);
      if (found.length !== 1) {
        writeGuard.current = null;
        fail(UNKNOWN_MESSAGE);
        return;
      }
      const item = found[0];
      const totalOk =
        readback.length === beforeIds.length + 1 &&
        money(beforeTotal)
          .plus(money(base.draft.amount))
          .eq(money(sumAmounts(readback.map((row) => row.monthlyAmount))));
      const fieldsOk =
        item !== undefined &&
        item.name === base.draft.name &&
        item.category === base.draft.category &&
        money(item.monthlyAmount).eq(money(base.draft.amount));
      if (!fieldsOk || !totalOk) {
        writeGuard.current = null;
        fail(ADD_MISMATCH_MESSAGE);
        return;
      }

      let refreshed: HomeApplicationState;
      try {
        refreshed = await services.getHomeApplicationState(base.asOfDate);
      } catch {
        writeGuard.current = null;
        fail(UNKNOWN_MESSAGE);
        return;
      }
      if (!live()) return;
      writeGuard.current = null;
      onHome(refreshed);
      commit({ ...readbackNow, phase: "CONFIRMED", locked: false, message: "已添加" });
      setDataVersion((value) => value + 1);
    },
    [commit, onHome, services],
  );

  const confirmAdd = useCallback(() => {
    const current = opRef.current;
    if (current?.kind !== "ADD") return;
    if (current.locked || current.phase !== "DRAFT") return;
    if (writeGuard.current) return;
    // 二次确认时再挡一次：草稿可能在核对页停留很久。
    if (current.asOfDate !== localDate(new Date())) {
      commit({ ...current, message: CROSS_DAY_MESSAGE });
      return;
    }
    writeGuard.current = current.token;
    void runAdd(current);
  }, [commit, runAdd]);

  /** 付款完整核对：写前目标月合计 → 写 → 按收据 id 八字段 → 目标月合计 → 会话日 home。 */
  const runPay = useCallback(
    async (base: PayOperation) => {
      const token = base.token;
      const live = () => {
        const now = opRef.current;
        return now !== null && now.kind === "PAY" && now.token === token ? now : null;
      };
      const fail = (message: string) => {
        const now = live();
        if (!now) return;
        commit({ ...now, phase: "UNKNOWN", locked: true, message });
      };

      commit({ ...base, phase: "PRE_CHECK", message: "" });
      let beforeTotal: string;
      try {
        const rows = await services.listEssentialPayments(base.targetMonth);
        beforeTotal = sumAmounts(rows.map((row) => row.amount));
      } catch {
        writeGuard.current = null;
        fail(UNKNOWN_MESSAGE);
        return;
      }
      const beforeNow = live();
      if (!beforeNow) return;
      commit({ ...beforeNow, phase: "SUBMITTING", dispatched: true, beforeTotal });

      let receipt: EssentialPaymentRecord;
      try {
        const result = await services.recordEssentialPayment({
          itemId: base.itemId,
          amount: base.amount,
          paidOn: base.paidOn,
          ...(base.note ? { note: base.note } : {}),
        });
        receipt = result.payment;
      } catch (error) {
        writeGuard.current = null;
        const rejection = payRejectionMessage(error);
        if (rejection !== null) {
          const now = live();
          if (now) {
            // 事务前拒绝可证明未写入：解锁回草稿，保留输入，允许修正后重新发起。
            commit({
              ...now,
              phase: "DRAFT",
              dispatched: false,
              locked: false,
              message: rejection,
            });
          }
          return;
        }
        // 没有可靠 payment.id：按原 V08 只读核查目标月，但不认领、不解锁、不重写。
        try {
          await services.listEssentialPayments(base.targetMonth);
        } catch {
          // 读不到同样保持待核查。
        }
        fail(UNKNOWN_MESSAGE);
        return;
      }

      const submittingNow = live();
      if (!submittingNow) return;
      commit({ ...submittingNow, phase: "READBACK", receipt });
      let rows: Awaited<ReturnType<ProductApplicationServices["listEssentialPayments"]>>;
      try {
        rows = await services.listEssentialPayments(base.targetMonth);
      } catch {
        writeGuard.current = null;
        fail(UNKNOWN_MESSAGE);
        return;
      }
      const readbackNow = live();
      if (!readbackNow) return;
      const found = rows.filter((row) => row.id === receipt.id);
      const row = found[0];
      const fieldsOk =
        found.length === 1 &&
        row !== undefined &&
        row.itemId === receipt.itemId &&
        row.itemName === receipt.itemName &&
        row.category === receipt.category &&
        money(row.amount).eq(money(receipt.amount)) &&
        row.paidOn === receipt.paidOn &&
        (row.note ?? "") === (receipt.note ?? "") &&
        row.recordedAt === receipt.recordedAt;
      const monthOk = money(sumAmounts(rows.map((candidate) => candidate.amount))).eq(
        money(beforeTotal).plus(money(base.amount)),
      );
      if (!fieldsOk || !monthOk) {
        writeGuard.current = null;
        fail(UNKNOWN_MESSAGE);
        return;
      }

      let refreshed: HomeApplicationState;
      try {
        refreshed = await services.getHomeApplicationState(base.asOfDate);
      } catch {
        writeGuard.current = null;
        fail(UNKNOWN_MESSAGE);
        return;
      }
      if (!live()) return;
      writeGuard.current = null;
      onHome(refreshed);
      commit({ ...readbackNow, phase: "CONFIRMED", locked: false, message: "已保存" });
      setDataVersion((value) => value + 1);
    },
    [commit, onHome, services],
  );

  const confirmPay = useCallback(
    (draft: { itemId: string; itemName: string; amount: string; paidOn: string; note: string }) => {
      if (writeGuard.current) return;
      const current = opRef.current;
      if (current?.locked) return;
      if (current?.kind === "PAY" && inFlight(current)) return;
      const token = nextToken();
      const next: PayOperation = {
        kind: "PAY",
        token,
        asOfDate,
        phase: "DRAFT",
        itemId: draft.itemId,
        itemName: draft.itemName,
        amount: draft.amount,
        paidOn: draft.paidOn,
        note: draft.note,
        targetMonth: draft.paidOn.slice(0, 7),
        beforeTotal: "0",
        dispatched: false,
        receipt: null,
        locked: false,
        message: "",
      };
      // 页面已挡一次；宿主再挡一次，避免跨日后仍拿旧会话日期派发。
      if (asOfDate !== localDate(new Date())) {
        commit({ ...next, message: PAY_CROSS_DAY_MESSAGE });
        return;
      }
      writeGuard.current = token;
      commit(next);
      void runPay(next);
    },
    [asOfDate, commit, nextToken, runPay],
  );

  /** 开始新一笔或取消未提交草稿；已派发的操作身份不得被清除。 */
  /**
   * 切 tab：只收起展示，不动操作身份与锁。
   * 「我的财务」固定回到分组页，待核查的冻结屏由「固定支出」入口重新进入（§5.2）。
   */
  const goTab = useCallback((id: Tab) => {
    setTab(id);
    setFixedExpensesOpen(false);
  }, []);

  const startOperation = useCallback(() => {
    const current = opRef.current;
    if (current?.dispatched && current.phase !== "CONFIRMED") return;
    if (current) commit(null);
  }, [commit]);

  const closeOperation = useCallback(() => {
    const current = opRef.current;
    if (!current) return;
    if (current.dispatched && current.phase !== "CONFIRMED") return;
    commit(null);
  }, [commit]);

  const tabs: Array<{ id: Tab; label: string; icon: typeof HomeIcon }> = [
    { id: "TODAY", label: "今天", icon: HomeIcon },
    { id: "RECORDS", label: "记录", icon: ListChecks },
    { id: "PROGRESS", label: "进展", icon: BarChart3 },
    { id: "MONEY", label: "我的财务", icon: Wallet },
  ];

  const fixedExpenses = (
    <M2FixedExpensesPage
      services={services}
      asOfDate={asOfDate}
      operation={operation}
      dataVersion={dataVersion}
      onPrepareAdd={prepareAdd}
      onConfirmAdd={confirmAdd}
      onConfirmPay={confirmPay}
      onStartOperation={startOperation}
      onCloseOperation={closeOperation}
      onDeactivateItem={deactivateEssential}
      onBack={() => setFixedExpensesOpen(false)}
    />
  );

  let content: React.ReactNode;
  if (tab === "TODAY") {
    content = (
      <M1Home home={home} deductionAccounts={deductionAccounts} onRecordExpense={onRecordExpense} />
    );
  } else if (tab === "MONEY") {
    content = fixedExpensesOpen ? (
      fixedExpenses
    ) : (
      <main className="v2-shell m2-shell">
        <section className="v2-content">
          <div className="v2-page">
            <h1 className="m2-title">我的财务</h1>
            <nav className="m2-menu" aria-label="我的财务">
              <button
                className="m2-menu__row"
                type="button"
                onClick={() => setFixedExpensesOpen(true)}
              >
                <span>
                  <strong>固定支出</strong>
                </span>
                <ChevronRight size={17} aria-hidden="true" />
              </button>
              <button
                className="m2-menu__row"
                type="button"
                onClick={() => {
                  setMaintenanceOpen(true);
                  void loadMaintenance();
                }}
              >
                <span>
                  <strong>资料维护</strong>
                </span>
                <ChevronRight size={17} aria-hidden="true" />
              </button>
              <button
                className="m2-menu__row"
                type="button"
                disabled={exporting}
                onClick={() => void runExport("LEDGER")}
              >
                <span>
                  <strong>{exporting ? "正在导出…" : "导出备份"}</strong>
                </span>
                <ChevronRight size={17} aria-hidden="true" />
              </button>
              {services.exportDatabaseBackup && (
                <button
                  className="m2-menu__row"
                  type="button"
                  disabled={exporting}
                  onClick={() => void runExport("DATABASE")}
                >
                  <span>
                    <strong>导出数据库备份</strong>
                  </span>
                  <ChevronRight size={17} aria-hidden="true" />
                </button>
              )}
            </nav>
            {exportNote && <p className="m2-note">{exportNote}</p>}
            {exportError && <p className="m2-note">{exportError}</p>}
          </div>
        </section>
      </main>
    );
  } else {
    content = (
      <main className="v2-shell m2-shell">
        <section className="v2-content">
          <div className="v2-page">
            <h1 className="m2-title">{tab === "RECORDS" ? "记录" : "进展"}</h1>
            <p className="m2-empty">暂未开放</p>
          </div>
        </section>
      </main>
    );
  }

  return (
    <div className="m2-theme">
      <nav className="v2-primary-nav m2-nav" aria-label="主导航">
        {tabs.map((entry) => {
          const Icon = entry.icon;
          return (
            <button
              className="v2-nav-button m2-nav__button"
              type="button"
              key={entry.id}
              aria-current={tab === entry.id ? "page" : undefined}
              onClick={() => goTab(entry.id)}
            >
              <Icon className="v2-nav-icon" size={20} aria-hidden="true" />
              <span>{entry.label}</span>
            </button>
          );
        })}
      </nav>
      {content}
      {maintenanceOpen && (
        <FinancialMaintenanceDialog
          initial={maintenanceData}
          loading={maintenanceLoading}
          error={maintenanceError}
          onClose={() => {
            setMaintenanceOpen(false);
            setMaintenanceData(null);
          }}
          onLoad={loadMaintenance}
          getRequirement={(patch: FinancialMaintenancePatch) =>
            services.getFinancialMaintenanceRequirement(patch, asOfDate)
          }
          onSave={async (patch: FinancialMaintenancePatch) => {
            const result = await services.updateFinancialDataAndRecalculate(patch, asOfDate);
            onHome(result.home);
            setDataVersion((value) => value + 1);
            setMaintenanceOpen(false);
            setMaintenanceData(null);
          }}
          onDeactivate={deactivateMaintenance}
        />
      )}
    </div>
  );
}
