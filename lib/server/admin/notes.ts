import 'server-only';
import type { NoteSeverity } from '@/lib/domain/scoring';
import { namesById } from '../people';
import { signPhotoUrls } from '../photos';
import { createUserClient } from '../supabase';
import { loadRestroomRefs, restroomScope, type CommonQuery } from './common';
import { roomView } from './presenters';

export const NOTES_PAGE_SIZE = 20;

export interface NotesQuery extends CommonQuery {
  supervisorId?: string;
  severity?: NoteSeverity;
  offset: number;
  limit: number;
}

/** ملاحظات مشرفي الوزارة (للاطلاع فقط — لا تعديل للحالات) */
export async function listNotes(q: NotesQuery) {
  const client = await createUserClient();
  const rooms = await loadRestroomRefs(client, { includeInactive: true });
  const scope = restroomScope(rooms, q);
  if (scope && scope.size === 0) return { rows: [], total: 0, offset: q.offset, limit: q.limit };
  let query = client
    .from('supervisor_notes')
    .select('id, evaluation_id, restroom_id, supervisor_id, text, severity, created_at', { count: 'exact' })
    .gte('created_at', q.range.fromInstant.toISOString())
    .lt('created_at', q.range.toInstantExclusive.toISOString());
  if (scope) query = query.in('restroom_id', [...scope]);
  if (q.supervisorId) query = query.eq('supervisor_id', q.supervisorId);
  if (q.severity) query = query.eq('severity', q.severity);
  const { data, count, error } = await query
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(q.offset, q.offset + q.limit - 1);
  if (error) throw new Error(error.message);
  const evalIds = (data ?? []).map((n) => n.evaluation_id);
  const [{ data: photos }, names] = await Promise.all([
    evalIds.length ? client.from('supervisor_photos').select('evaluation_id, storage_key, uploaded_at').in('evaluation_id', evalIds).order('uploaded_at') : Promise.resolve({ data: [] as { evaluation_id: string; storage_key: string }[] }),
    namesById((data ?? []).map((n) => n.supervisor_id)),
  ]);
  const urls = await signPhotoUrls((photos ?? []).map((p) => p.storage_key));
  const roomMap = new Map(rooms.map((r) => [r.id, r]));
  return {
    total: count ?? 0,
    offset: q.offset,
    limit: q.limit,
    rows: (data ?? []).map((n) => ({
      id: n.id,
      text: n.text,
      severity: n.severity as NoteSeverity,
      createdAt: n.created_at,
      supervisor: names[n.supervisor_id] ?? '—',
      restroom: roomView(roomMap, n.restroom_id),
      photos: (photos ?? []).filter((p) => p.evaluation_id === n.evaluation_id).map((p) => urls[p.storage_key]).filter(Boolean),
    })),
  };
}
