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

export type DuoTaskKind = "income" | "spending" | "cash" | "debt" | "safety";

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
}: {
  tasks: DuoTaskKind[];
  completed: Set<DuoTaskKind>;
  onTask: (kind: DuoTaskKind) => void;
}) {
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
      <div className="duo-task-list">
        {tasks.map((kind, index) => {
          const task = taskArt[kind];
          const Icon = task.icon;
          const done = completed.has(kind);
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
