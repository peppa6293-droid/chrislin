import {
  ArrowRight,
  Check,
  Coins,
  Heart,
  ShieldCheck,
  Sparkles,
  Target,
  Wallet,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

export type DuoTaskKind = "income" | "spending" | "cash" | "debt" | "safety";

type RewardState = {
  enabled: boolean;
  streak: number;
  lastCompletedDay: string | null;
  days: Record<string, Partial<Record<"spending" | "safety", boolean>>>;
};
const REWARD_STORAGE_KEY = "xiaoqianjia.duo-reward.v1";
function readRewardState(): RewardState {
  try {
    const raw = localStorage.getItem(REWARD_STORAGE_KEY);
    const value = raw ? (JSON.parse(raw) as Partial<RewardState>) : {};
    return {
      enabled: value.enabled ?? true,
      streak: value.streak ?? 0,
      lastCompletedDay: value.lastCompletedDay ?? null,
      days: value.days ?? {},
    };
  } catch {
    return { enabled: true, streak: 0, lastCompletedDay: null, days: {} };
  }
}
function writeRewardState(state: RewardState) {
  try {
    localStorage.setItem(REWARD_STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* Optional UI preference. */
  }
}
function previousDay(dayKey: string) {
  const date = new Date(`${dayKey}T12:00:00`);
  date.setDate(date.getDate() - 1);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

const taskArt: Record<
  DuoTaskKind,
  { title: string; prompt: string; action: string; icon: typeof Wallet; color: string }
> = {
  income: {
    title: "收入",
    prompt: "确认这个月打算赚多少",
    action: "去设置",
    icon: Coins,
    color: "coral",
  },
  spending: {
    title: "消费",
    prompt: "记下一笔今天的花销",
    action: "开始记录",
    icon: Wallet,
    color: "mint",
  },
  cash: {
    title: "现金",
    prompt: "看看手里的现金够不够安心",
    action: "去看看",
    icon: ShieldCheck,
    color: "blue",
  },
  debt: {
    title: "还款",
    prompt: "确认本月要还的金额",
    action: "去确认",
    icon: Target,
    color: "yellow",
  },
  safety: {
    title: "安全垫",
    prompt: "看看离你的目标还有多远",
    action: "看进度",
    icon: Heart,
    color: "purple",
  },
};

export function DuoGuide({
  tasks,
  completed,
  onTask,
  dayKey,
}: {
  tasks: DuoTaskKind[];
  completed: Set<DuoTaskKind>;
  onTask: (kind: DuoTaskKind) => void;
  dayKey: string;
}) {
  const [reward, setReward] = useState<RewardState>(() => readRewardState());
  const [restored, setRestored] = useState<Set<DuoTaskKind>>(() => new Set());
  useEffect(() => {
    const state = readRewardState();
    setReward(state);
    const saved = state.days[dayKey] ?? {};
    setRestored(
      new Set(
        (Object.keys(saved) as DuoTaskKind[]).filter((key) => saved[key as "spending" | "safety"]),
      ),
    );
  }, [dayKey]);
  const visibleCompleted = useMemo(
    () => new Set<DuoTaskKind>([...restored, ...completed]),
    [completed, restored],
  );
  const spendingDone = visibleCompleted.has("spending");
  const safetyDone = visibleCompleted.has("safety");
  useEffect(() => {
    if (!reward.enabled || (!spendingDone && !safetyDone)) return;
    const currentState = readRewardState();
    const savedToday = currentState.days[dayKey];
    if (savedToday?.spending === spendingDone && savedToday?.safety === safetyDone) return;
    const next: RewardState = {
      ...currentState,
      days: { ...currentState.days, [dayKey]: { spending: spendingDone, safety: safetyDone } },
    };
    if (spendingDone && safetyDone && currentState.lastCompletedDay !== dayKey) {
      next.streak =
        currentState.lastCompletedDay === previousDay(dayKey) ? currentState.streak + 1 : 1;
      next.lastCompletedDay = dayKey;
    }
    setReward(next);
    writeRewardState(next);
  }, [dayKey, reward.enabled, safetyDone, spendingDone]);
  const toggleRewardMode = () => {
    const next = { ...reward, enabled: !reward.enabled };
    setReward(next);
    writeRewardState(next);
  };
  return (
    <section className="duo-guide" aria-label="今天的财务任务">
      <div className="duo-guide-header">
        <div>
          <p className="duo-eyebrow">今天的练习</p>
          <h2>照顾好今天的一小步</h2>
          <p>不用一次理完，完成一件就很棒。</p>
        </div>
        <DuoCharacter mood={completed.size > 0 ? "happy" : "hello"} />
      </div>
      <div className="duo-reward-bar">
        <div className="duo-reward-progress">
          <span aria-hidden="true">✦</span>
          <span>今天 {Number(spendingDone) + Number(safetyDone)} / 2</span>
          {reward.enabled && reward.streak > 0 && <strong>连续 {reward.streak} 天</strong>}
        </div>
        <button
          type="button"
          className={`duo-reward-toggle ${reward.enabled ? "is-on" : ""}`}
          aria-pressed={reward.enabled}
          onClick={toggleRewardMode}
        >
          {reward.enabled ? "鼓励模式已开" : "鼓励模式已关"}
        </button>
      </div>
      <div className="duo-task-list">
        {tasks
          .filter((kind) => kind === "spending" || kind === "safety")
          .map((kind, index) => {
            const task = taskArt[kind];
            const Icon = task.icon;
            const done = visibleCompleted.has(kind);
            return (
              <button
                key={kind}
                type="button"
                className={`duo-task duo-task--${task.color} ${done ? "is-done" : ""}`}
                onClick={() => onTask(kind)}
              >
                <span className="duo-task-step">
                  {done ? <Check size={17} strokeWidth={3} /> : index + 1}
                </span>
                <span className="duo-task-icon">
                  <Icon size={22} strokeWidth={2.2} />
                </span>
                <span className="duo-task-copy">
                  <strong>{task.title}</strong>
                  <small>{done ? "已完成，随时可以再看看" : task.prompt}</small>
                </span>
                <span className="duo-task-action">
                  {done ? "完成" : task.action}
                  <ArrowRight size={15} />
                </span>
              </button>
            );
          })}
      </div>
    </section>
  );
}

export function DuoCharacter({ mood = "hello" }: { mood?: "hello" | "happy" }) {
  return (
    <div className={`duo-character duo-character--${mood}`} aria-hidden="true">
      <div className="duo-character-hair" />
      <div className="duo-character-face">
        <i />
        <i />
        <b />
      </div>
      <div className="duo-character-body" />
      <Sparkles className="duo-character-sparkle" size={14} />
    </div>
  );
}
