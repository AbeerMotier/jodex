import 'server-only';
import { DISPLAY_STATUS, SHIFT_SHORT_LABEL, type Role, type Tone } from '@/lib/domain/catalog';
import type { MetricEvaluation, MetricRound, RestroomRef } from '@/lib/domain/metrics';
import { roundDisplayStatus } from '@/lib/domain/schedule';
import { roundEventTime } from '@/lib/domain/metrics';

export interface EntryView {
  kind: 'round' | 'supervisor';
  id: string;
  date: string; // YYYY-MM-DD (الرياض)
  time: string | null; // ISO
  typeLabel: string;
  employee: { name: string; role: Role };
  onBehalfOf: string | null;
  restroom: { id: string; name: string; floor: string; building: string };
  evalType: string;
  result: number | null;
  status: { label: string; tone: Tone };
  urgent: boolean;
}

export function roomView(rooms: Map<string, RestroomRef>, id: string) {
  const r = rooms.get(id);
  return { id, name: r?.name ?? '—', floor: r?.floor_label ?? '—', building: r?.building_name ?? '—' };
}

export function roundEntry(
  r: MetricRound,
  rooms: Map<string, RestroomRef>,
  names: Record<string, string>,
  today: string,
  minute: number,
): EntryView {
  const display = roundDisplayStatus(r, today, minute);
  const employeeId = r.executed_by_id ?? r.assigned_monitor_id;
  return {
    kind: 'round',
    id: r.id,
    date: r.round_date,
    time: r.status === 'submitted' ? r.submitted_at : null,
    typeLabel: SHIFT_SHORT_LABEL[r.shift],
    employee: { name: names[employeeId] ?? '—', role: 'contractor_monitor' },
    onBehalfOf: r.on_behalf_of_id ? names[r.on_behalf_of_id] ?? null : null,
    restroom: roomView(rooms, r.restroom_id),
    evalType: 'تقييم المقاول',
    result: r.status === 'submitted' ? r.quality_score : null,
    status: DISPLAY_STATUS[display],
    urgent: false,
  };
}

export function evaluationEntry(
  e: MetricEvaluation & { needs_urgent?: string | null },
  rooms: Map<string, RestroomRef>,
  names: Record<string, string>,
  dateOf: (iso: string) => string,
): EntryView {
  return {
    kind: 'supervisor',
    id: e.id,
    date: dateOf(e.submitted_at),
    time: e.submitted_at,
    typeLabel: 'زيارة',
    employee: { name: names[e.supervisor_id] ?? '—', role: 'supervisor' },
    onBehalfOf: null,
    restroom: roomView(rooms, e.restroom_id),
    evalType: 'تقييم المشرف',
    result: e.score,
    status: { label: 'مكتملة', tone: 'success' },
    urgent: e.needs_urgent === 'yes',
  };
}

export { roundEventTime };
