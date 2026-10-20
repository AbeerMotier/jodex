import 'server-only';
import { restroomLabel } from '@/lib/domain/format';
import { DISPLAY_STATUS, SHIFT_SHORT_LABEL } from '@/lib/domain/catalog';
import { roundDisplayStatus, windowText, type ComplianceLevel, type RoundStatus, type Shift } from '@/lib/domain/schedule';
import { riyadhDate, riyadhMinuteOfDay } from '@/lib/domain/time';
import type { SessionUser } from './auth';
import { ApiError } from './http';
import { namesById } from './people';
import { syncRounds } from './rounds-maintenance';
import { createUserClient } from './supabase';

/**
 * صفحة المقاول: دورات المياه المسندة إليه مع المراقب المسؤول وحالة جولتي اليوم — للعرض فقط.
 * القراءة عبر RLS (contractor_assignments)، ولا توجد للمقاول أي عملية كتابة.
 */
export async function contractorRestrooms(user: SessionUser, now: Date) {
  if (user.role !== 'contractor') throw new ApiError(403, 'forbidden', 'لا تملك صلاحية الوصول لهذه الصفحة');
  await syncRounds(now);
  const client = await createUserClient();
  const today = riyadhDate(now);
  const minute = riyadhMinuteOfDay(now);
  const { data: assigns, error } = await client.from('contractor_assignments').select('restroom_id').eq('contractor_id', user.id);
  if (error) throw new Error(error.message);
  const ids = (assigns ?? []).map((a) => a.restroom_id as string);
  if (!ids.length) return { serverNow: now.toISOString(), today, restrooms: [], windows: { am: windowText('am'), pm: windowText('pm') } };

  const [{ data: rooms, error: roomErr }, { data: rounds }] = await Promise.all([
    client.from('restrooms').select('id, code, name, floor_label, building_id, monitor_id').in('id', ids).eq('is_active', true).order('code'),
    client.from('rounds').select('restroom_id, shift, status, compliance_level, round_date').in('restroom_id', ids).eq('round_date', today),
  ]);
  if (roomErr) throw new Error(roomErr.message);
  const buildingIds = [...new Set((rooms ?? []).map((r) => r.building_id as string))];
  const [{ data: buildings }, names] = await Promise.all([
    buildingIds.length ? client.from('buildings').select('id, name').in('id', buildingIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    namesById((rooms ?? []).map((r) => r.monitor_id as string | null)),
  ]);
  const bname = new Map((buildings ?? []).map((b) => [b.id, b.name]));
  const list = (rooms ?? []).map((r) => {
    const status = (shift: Shift) => {
      const round = (rounds ?? []).find((x) => x.restroom_id === r.id && x.shift === shift) as
        | { shift: Shift; status: RoundStatus; compliance_level: ComplianceLevel | null; round_date: string }
        | undefined;
      if (!round) return { label: '—', tone: 'neutral' as const };
      const display = roundDisplayStatus(round, today, minute);
      return { label: DISPLAY_STATUS[display].label, tone: DISPLAY_STATUS[display].tone };
    };
    return {
      id: r.id as string,
      code: r.code as string,
      name: restroomLabel(r.name as string),
      floor: r.floor_label as string,
      building: bname.get(r.building_id) ?? '',
      monitor: r.monitor_id ? names[r.monitor_id] ?? '—' : '—',
      am: status('am'),
      pm: status('pm'),
    };
  });
  list.sort((x, y) => x.building.localeCompare(y.building, 'ar') || x.code.localeCompare(y.code));
  return {
    serverNow: now.toISOString(),
    today,
    restrooms: list,
    shiftLabels: SHIFT_SHORT_LABEL,
    windows: { am: windowText('am'), pm: windowText('pm') },
  };
}
