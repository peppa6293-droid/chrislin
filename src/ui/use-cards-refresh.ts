import { useCallback, useEffect, useRef, useState } from "react";
import type { CardStatus } from "./card-status.js";

/** 300ms 内完成的刷新不显示骨架，避免闪烁。 */
export const CARDS_LOADING_DELAY_MS = 300;

/**
 * 把「真实刷新」映射成卡片状态：
 * - 刷新开始计时，满 delayMs 仍在进行 → loading
 * - 刷新在阈值内结束 → 保持 ready（从不出现骨架）
 * - 多个刷新并发时用计数聚合，最后一个结束才回 ready
 */
export function useCardsRefresh(delayMs: number = CARDS_LOADING_DELAY_MS) {
  const [status, setStatus] = useState<CardStatus>("ready");
  const pendingCount = useRef(0);
  const timer = useRef<number | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current !== null) {
        window.clearTimeout(timer.current);
        timer.current = null;
      }
    };
  }, []);

  const track = useCallback(
    async <T>(work: Promise<T>): Promise<T> => {
      pendingCount.current += 1;
      if (pendingCount.current === 1 && timer.current === null) {
        timer.current = window.setTimeout(() => {
          timer.current = null;
          if (mounted.current) setStatus("loading");
        }, delayMs);
      }
      try {
        return await work;
      } finally {
        pendingCount.current -= 1;
        if (pendingCount.current === 0) {
          if (timer.current !== null) {
            window.clearTimeout(timer.current);
            timer.current = null;
          }
          if (mounted.current) setStatus("ready");
        }
      }
    },
    [delayMs],
  );

  return { status, track };
}
