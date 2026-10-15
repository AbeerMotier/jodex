import 'server-only';
import { createUserClient } from '../supabase';
import type { CommonQuery } from './common';

/** عدّادات الشريط الجانبي حسب الفترة المختارة */
export async function sidebarCounts(q: CommonQuery) {
  const client = await createUserClient();
  const fromIso = q.range.fromInstant.toISOString();
  const toIso = q.range.toInstantExclusive.toISOString();
  const head = { count: 'exact' as const, head: true };
  const [log, feedback, notes, monitors, restrooms] = await Promise.all([
    client.from('admin_log_entries').select('id', head).gte('entry_date', q.range.from).lte('entry_date', q.range.to),
    client.from('beneficiary_feedback').select('id', head).gte('submitted_at', fromIso).lt('submitted_at', toIso),
    client.from('supervisor_notes').select('id', head).gte('created_at', fromIso).lt('created_at', toIso),
    client.from('users').select('id', head).eq('role', 'contractor_monitor').eq('monitor_kind', 'primary').eq('is_active', true),
    client.from('restrooms').select('id', head).eq('is_active', true),
  ]);
  return {
    log: log.count ?? 0,
    feedback: feedback.count ?? 0,
    notes: notes.count ?? 0,
    staff: monitors.count ?? 0,
    qr: restrooms.count ?? 0,
  };
}
