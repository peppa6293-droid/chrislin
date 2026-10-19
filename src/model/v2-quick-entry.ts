export type QuickEntryPermission = "granted" | "denied" | "unsupported";
export type QuickEntryFeedback = "saved" | "failed" | "inline-permission-warning";

export interface QuickEntryDraft { amount: string; categoryId: string; accountId: string; note?: string; }
export interface QuickEntryTemplate { id: string; name: string; draft: QuickEntryDraft; }
export interface QuickEntryState { feedback: QuickEntryFeedback | null; elapsedMs: number; inlineMessage: string | null; lastDraft: QuickEntryDraft | null; }

export interface QuickEntryIpc {
  saveExpense(draft: QuickEntryDraft): Promise<void>;
}

export function resolveQuickEntryPermission(permission: QuickEntryPermission): { canOpen: boolean; message: string | null } {
  if (permission === "granted") return { canOpen: true, message: null };
  return { canOpen: true, message: "系统通知权限不可用，已改为在应用内显示保存结果。" };
}

export async function submitQuickEntry(ipc: QuickEntryIpc, draft: QuickEntryDraft, startedAt: number, now = Date.now()): Promise<QuickEntryState> {
  try {
    await ipc.saveExpense(draft);
    return { feedback: "saved", elapsedMs: now - startedAt, inlineMessage: null, lastDraft: draft };
  } catch {
    return { feedback: "failed", elapsedMs: now - startedAt, inlineMessage: "保存失败，请检查金额、分类和账户后重试。", lastDraft: draft };
  }
}

export function repeatLastEntry(lastDraft: QuickEntryDraft | null): QuickEntryDraft | null {
  return lastDraft ? { ...lastDraft } : null;
}

export function applyTemplate(template: QuickEntryTemplate): QuickEntryDraft { return { ...template.draft }; }
