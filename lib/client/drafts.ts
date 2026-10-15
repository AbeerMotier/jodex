'use client';
/** نسخة محلية من المسودة حتى لا تضيع البيانات عند إغلاق المتصفح أو انقطاع الشبكة أو انتهاء الجلسة */
export interface LocalDraft {
  answers: Record<string, 'done' | 'partial' | 'not_done'>;
  note: string;
  updatedAt: string;
}

const key = (userId: string, roundId: string) => `jodex:draft:${userId}:${roundId}`;

export function readLocalDraft(userId: string, roundId: string): LocalDraft | null {
  try {
    const raw = localStorage.getItem(key(userId, roundId));
    return raw ? (JSON.parse(raw) as LocalDraft) : null;
  } catch {
    return null;
  }
}

export function writeLocalDraft(userId: string, roundId: string, draft: LocalDraft) {
  try {
    localStorage.setItem(key(userId, roundId), JSON.stringify(draft));
  } catch {
    /* التخزين غير متاح */
  }
}

export function clearLocalDraft(userId: string, roundId: string) {
  try {
    localStorage.removeItem(key(userId, roundId));
  } catch {
    /* تجاهل */
  }
}
