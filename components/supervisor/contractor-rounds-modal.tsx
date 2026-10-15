'use client';
import { Chip } from '@/components/ui/chip';
import { Modal } from '@/components/ui/overlay';
import { Skeleton } from '@/components/ui/skeleton';
import type { Tone } from '@/lib/domain/catalog';
import { dayLabel, timeHM } from '@/lib/domain/format';

export interface ContractorRoundsData {
  date: string;
  isToday: boolean;
  rounds: {
    id: string;
    shift: 'am' | 'pm';
    label: string;
    status: 'pending' | 'submitted' | 'missed';
    statusLabel: string;
    tone: Tone;
    executedBy: string | null;
    onBehalfOf: string | null;
    submittedAt: string | null;
    counts: { done: number; partial: number; notDone: number };
    answers: { title: string; answer: 'done' | 'partial' | 'not_done'; answerLabel: string; deep: boolean }[];
    note: string | null;
  }[];
}

const ANSWER_COLOR = { done: '#3F7A62', partial: '#94711C', not_done: '#B5512F' } as const;

export function ContractorRoundsModal({
  open,
  onClose,
  data,
  loading,
  error,
}: {
  open: boolean;
  onClose: () => void;
  data: ContractorRoundsData | null;
  loading: boolean;
  error: string | null;
}) {
  const subtitle = data ? `${dayLabel(data.date)}${data.isToday ? ' · اليوم' : ' · آخر يوم سابق'}` : undefined;
  return (
    <Modal open={open} onClose={onClose} title="تقييم جولة المقاول لنفس الموقع" subtitle={subtitle}>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,260px),1fr))] gap-3 pb-2.5" data-testid="contractor-rounds">
        {loading && !data && (
          <>
            <Skeleton className="h-[180px]" />
            <Skeleton className="h-[180px]" />
          </>
        )}
        {error && <div className="text-[13.5px] text-err-ink">{error}</div>}
        {data && data.rounds.length === 0 && <div className="text-[13.5px] text-muted">لا توجد جولات مسجلة لهذا الموقع بعد.</div>}
        {data?.rounds.map((r) => (
          <div key={r.id} className="rounded-[13px] border border-divider bg-[#F6F9F7] px-3.5 py-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[14.5px] font-semibold">{r.label}</span>
              <Chip tone={r.tone}>{r.statusLabel}</Chip>
            </div>
            <div className="mt-1 text-[12.5px] text-muted">
              {r.status === 'submitted'
                ? `المنفّذ: ${r.executedBy ?? '—'}${r.onBehalfOf ? ` (بالنيابة عن ${r.onBehalfOf})` : ''} · ${timeHM(r.submittedAt)}`
                : r.status === 'missed'
                  ? 'لم تُنفّذ'
                  : 'لم تُرسل بعد'}
            </div>
            {r.status === 'submitted' && (
              <>
                <div className="mt-2.5 mb-2 flex flex-wrap gap-1.5">
                  <Chip tone="success" size="sm">تم {r.counts.done}</Chip>
                  <Chip tone="warning" size="sm">جزئي {r.counts.partial}</Chip>
                  <Chip tone="error" size="sm">لم يتم {r.counts.notDone}</Chip>
                </div>
                {r.answers.map((a, i) => (
                  <div key={i} className="flex justify-between gap-2 border-t border-divider py-[5px] text-[12.5px]">
                    <span>
                      {a.title}
                      {a.deep && <span className="text-muted"> (تنظيف عميق)</span>}
                    </span>
                    <span className="font-semibold whitespace-nowrap" style={{ color: ANSWER_COLOR[a.answer] }}>
                      {a.answerLabel}
                    </span>
                  </div>
                ))}
                {r.note && <div className="mt-1.5 text-[12.5px] text-muted">ملاحظة المقاول: {r.note}</div>}
              </>
            )}
          </div>
        ))}
      </div>
    </Modal>
  );
}
