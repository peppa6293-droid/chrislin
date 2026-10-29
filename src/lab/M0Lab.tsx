import { vibrate } from "@tauri-apps/plugin-haptics";
import {
  isPermissionGranted,
  requestPermission,
  Schedule,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { useCallback, useEffect, useState } from "react";
import { TauriSqlDatabase } from "../persistence/tauri-database.js";

type M0Record = {
  id: number;
  value: string;
  created_at: string;
};

const db = new TauriSqlDatabase();
const LIST_ROWS = Array.from({ length: 200 }, (_, index) => `第 ${index + 1} 行`);

export function M0Lab() {
  const [records, setRecords] = useState<M0Record[]>([]);
  const [databasePath, setDatabasePath] = useState("");
  const [status, setStatus] = useState("准备中…");
  const [busy, setBusy] = useState(false);
  const [notificationStatus, setNotificationStatus] = useState("通知权限未知");
  const [notificationPermission, setNotificationPermission] = useState<boolean | null>(null);

  const readRecords = useCallback(async () => {
    const pathRows = await db.select<{ file: string }>("PRAGMA database_list");
    setDatabasePath(pathRows[0]?.file ?? "");
    const rows = await db.select<M0Record>(
      "SELECT id, value, created_at FROM m0_spike ORDER BY id DESC LIMIT 20",
    );
    setRecords(rows);
    setStatus(`读取成功：${rows.length} 条记录`);
  }, []);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        await db.execute(
          "CREATE TABLE IF NOT EXISTS m0_spike (id INTEGER PRIMARY KEY AUTOINCREMENT, value TEXT NOT NULL, created_at TEXT NOT NULL)",
        );
        if (!mounted) return;
        await readRecords();
      } catch (error) {
        if (mounted) setStatus(`初始化失败：${errorText(error)}`);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [readRecords]);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const granted = await isPermissionGranted();
        if (!mounted) return;
        setNotificationPermission(granted);
        setNotificationStatus(granted ? "通知权限已授予" : "通知权限未授予");
      } catch (error) {
        if (mounted) setNotificationStatus(`检查通知权限失败：${errorText(error)}`);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  async function writeRecord() {
    setBusy(true);
    try {
      const value = `M0-${new Date().toISOString()}-${randomSuffix()}`;
      await db.execute("INSERT INTO m0_spike (value, created_at) VALUES (?, ?)", [
        value,
        new Date().toISOString(),
      ]);
      await readRecords();
      setStatus(`已写入：${value}`);
    } catch (error) {
      setStatus(`写入失败：${errorText(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function refresh() {
    setBusy(true);
    try {
      await readRecords();
    } catch (error) {
      setStatus(`读取失败：${errorText(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function requestNotificationPermission() {
    try {
      const permission = await requestPermission();
      const granted = permission === "granted";
      setNotificationPermission(granted);
      setNotificationStatus(granted ? "通知权限已授予" : `通知权限：${permission}`);
    } catch (error) {
      setNotificationStatus(`请求通知权限失败：${errorText(error)}`);
    }
  }

  async function ensureNotificationPermission(): Promise<boolean> {
    try {
      let granted = await isPermissionGranted();
      if (!granted) {
        const permission = await requestPermission();
        granted = permission === "granted";
      }
      setNotificationPermission(granted);
      setNotificationStatus(granted ? "通知权限已授予" : "通知权限未授予");
      return granted;
    } catch (error) {
      setNotificationStatus(`检查通知权限失败：${errorText(error)}`);
      return false;
    }
  }

  async function sendImmediateNotification() {
    if (!(await ensureNotificationPermission())) return;
    try {
      sendNotification({
        title: "M0 立即通知",
        body: `立即通知 ${new Date().toLocaleTimeString()}`,
      });
      setNotificationStatus("已发送立即通知");
    } catch (error) {
      setNotificationStatus(`发送通知失败：${errorText(error)}`);
    }
  }

  async function sendScheduledNotification() {
    if (!(await ensureNotificationPermission())) return;
    try {
      const at = new Date(Date.now() + 60_000);
      sendNotification({
        title: "M0 定时通知",
        body: `计划 ${at.toLocaleTimeString()} 送达`,
        schedule: Schedule.at(at),
      });
      setNotificationStatus(`已排程 ${at.toLocaleTimeString()}`);
    } catch (error) {
      setNotificationStatus(`排程失败：${errorText(error)}`);
    }
  }

  async function triggerVibration() {
    try {
      await vibrate(400);
      setNotificationStatus("震动调用完成（模拟器无物理震动）");
    } catch (error) {
      setNotificationStatus(`震动失败：${errorText(error)}`);
    }
  }

  return (
    <main className="m0-lab">
      <header className="m0-lab__header">
        <p className="m0-lab__eyebrow">M0 SPIKE · 仅模拟器</p>
        <h1 className="m0-lab__title">玻璃 / SQLite / 通知验证</h1>
        <p className="m0-lab__status" aria-live="polite">
          {status}
        </p>
      </header>

      <section className="m0-lab__section" aria-labelledby="m0-glass-heading">
        <h2 className="m0-lab__heading" id="m0-glass-heading">
          三块玻璃卡片
        </h2>
        <div className="m0-lab__glass-stage">
          <span className="m0-lab__blob m0-lab__blob--teal" aria-hidden="true" />
          <span className="m0-lab__blob m0-lab__blob--yellow" aria-hidden="true" />
          <span className="m0-lab__blob m0-lab__blob--purple" aria-hidden="true" />
          <div className="m0-lab__glass-grid">
            <article className="m0-glass m0-glass--a">
              <p className="m0-glass__label">blur 10px</p>
              <p className="m0-glass__value">01</p>
            </article>
            <article className="m0-glass m0-glass--b">
              <p className="m0-glass__label">blur 20px</p>
              <p className="m0-glass__value">02</p>
            </article>
            <article className="m0-glass m0-glass--c">
              <p className="m0-glass__label">blur 32px</p>
              <p className="m0-glass__value">03</p>
            </article>
          </div>
        </div>
      </section>

      <section className="m0-lab__section" aria-labelledby="m0-list-heading">
        <h2 className="m0-lab__heading" id="m0-list-heading">
          200 行滚动列表
        </h2>
        <ul className="m0-lab__list">
          {LIST_ROWS.map((label) => (
            <li className="m0-lab__row" key={label}>
              <span>{label}</span>
              <span className="m0-lab__row-meta">scroll</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="m0-lab__section" aria-labelledby="m0-notify-heading">
        <h2 className="m0-lab__heading" id="m0-notify-heading">
          通知 / 震动
        </h2>
        <p className="m0-lab__status" aria-live="polite">
          通知权限：
          {notificationPermission === null ? "未知" : notificationPermission ? "已授予" : "未授予"}{" "}
          · {notificationStatus}
        </p>
        <div className="m0-lab__actions">
          <button
            className="m0-lab__button m0-lab__button--secondary"
            type="button"
            onClick={() => void requestNotificationPermission()}
          >
            请求通知权限
          </button>
          <button
            className="m0-lab__button"
            type="button"
            onClick={() => void sendImmediateNotification()}
          >
            立即通知
          </button>
          <button
            className="m0-lab__button"
            type="button"
            onClick={() => void sendScheduledNotification()}
          >
            1 分钟后定时通知
          </button>
          <button
            className="m0-lab__button m0-lab__button--secondary"
            type="button"
            onClick={() => void triggerVibration()}
          >
            震动
          </button>
        </div>
      </section>

      <section className="m0-lab__section" aria-labelledby="m0-db-heading">
        <h2 className="m0-lab__heading" id="m0-db-heading">
          SQLite 写入 / 重启回读
        </h2>
        <div className="m0-lab__actions">
          <button
            className="m0-lab__button"
            type="button"
            onClick={() => void writeRecord()}
            disabled={busy}
          >
            写入测试记录
          </button>
          <button
            className="m0-lab__button m0-lab__button--secondary"
            type="button"
            onClick={() => void refresh()}
            disabled={busy}
          >
            重新读取
          </button>
        </div>
        <p className="m0-lab__path">DB: {databasePath || "未读取"}</p>
        {records.length === 0 ? (
          <p className="m0-lab__empty">暂无记录</p>
        ) : (
          <ul className="m0-lab__records">
            {records.map((record) => (
              <li className="m0-lab__record" key={record.id}>
                <code>{record.value}</code>
                <span>{record.created_at}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function randomSuffix(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID().slice(0, 8);
  }
  return String(Date.now()).slice(-8);
}
