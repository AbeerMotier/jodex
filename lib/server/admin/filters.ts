import 'server-only';
import { createUserClient } from '../supabase';
import { loadRestroomRefs } from './common';

/** خيارات الفلاتر من البيانات الفعلية (مبانٍ، أدوار، دورات مياه، موظفون) */
export async function filterOptions() {
  const client = await createUserClient();
  const rooms = await loadRestroomRefs(client, { includeInactive: true });
  const { data: users } = await client
    .from('users')
    .select('id, full_name, role, monitor_kind, is_active')
    .in('role', ['contractor_monitor', 'supervisor'])
    .order('full_name');
  const buildings = new Map<string, string>();
  for (const r of rooms) buildings.set(r.building_id, r.building_name);
  return {
    buildings: [...buildings.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'ar')),
    restrooms: rooms.map((r) => ({ id: r.id, code: r.code, name: r.name, floor: r.floor_label, buildingId: r.building_id, building: r.building_name, active: r.is_active })),
    monitors: (users ?? [])
      .filter((u) => u.role === 'contractor_monitor')
      .map((u) => ({ id: u.id, name: u.full_name, kind: u.monitor_kind, active: u.is_active })),
    supervisors: (users ?? []).filter((u) => u.role === 'supervisor').map((u) => ({ id: u.id, name: u.full_name, active: u.is_active })),
  };
}
