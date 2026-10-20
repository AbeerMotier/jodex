import 'server-only';
import { restroomLabel } from '@/lib/domain/format';
import { newQrToken } from '@/lib/accounts';
import type { RestroomInput } from '@/lib/domain/validation';
import type { SessionUser } from '../auth';
import { audit } from '../audit';
import { ApiError } from '../http';
import { createServiceClient } from '../supabase';

function dbError(message: string): ApiError {
  if (message.includes('buildings_name_key')) return new ApiError(409, 'name_taken', 'يوجد مبنى بنفس الاسم.', { name: 'يوجد مبنى بنفس الاسم.' });
  if (message.includes('restrooms_code_key')) return new ApiError(409, 'code_taken', 'الترميز مستخدم لدورة مياه أخرى.', { code: 'الترميز مستخدم مسبقًا.' });
  if (message.includes('restroom_monitor_must_be_primary')) return new ApiError(422, 'invalid_monitor', 'المسؤول يجب أن يكون مراقبًا أساسيًا.');
  return new ApiError(500, 'server_error', 'تعذّر حفظ التعديل. حاول مرة أخرى.');
}

/** المباني ودورات المياه (النشطة وغير النشطة) مع المراقب المسؤول وعدد المشرفين وحالة رمز QR */
export async function listPlaces() {
  const svc = createServiceClient();
  const [{ data: buildings, error }, { data: rooms, error: roomErr }, { data: monitors }, { data: assigns }, { data: codes }] = await Promise.all([
    svc.from('buildings').select('id, name').order('name'),
    svc.from('restrooms').select('id, code, name, floor_label, building_id, monitor_id, is_active').order('code'),
    svc.from('users').select('id, full_name, username, is_active').eq('role', 'contractor_monitor').eq('monitor_kind', 'primary').order('full_name'),
    svc.from('supervisor_assignments').select('restroom_id'),
    svc.from('qr_codes').select('restroom_id').eq('is_active', true),
  ]);
  if (error) throw new Error(error.message);
  if (roomErr) throw new Error(roomErr.message);
  const supCount = new Map<string, number>();
  for (const a of assigns ?? []) supCount.set(a.restroom_id, (supCount.get(a.restroom_id) ?? 0) + 1);
  const hasQr = new Set((codes ?? []).map((c) => c.restroom_id as string));
  const monitorName = new Map((monitors ?? []).map((m) => [m.id as string, m.full_name as string]));
  return {
    buildings: (buildings ?? []).map((b) => ({
      id: b.id as string,
      name: b.name as string,
      restroomCount: (rooms ?? []).filter((r) => r.building_id === b.id).length,
    })),
    restrooms: (rooms ?? []).map((r) => ({
      id: r.id as string,
      code: r.code as string,
      name: r.name as string,
      label: restroomLabel(r.name as string),
      floor: r.floor_label as string,
      buildingId: r.building_id as string,
      monitorId: (r.monitor_id as string | null) ?? null,
      monitorName: r.monitor_id ? monitorName.get(r.monitor_id) ?? null : null,
      supervisors: supCount.get(r.id) ?? 0,
      hasQr: hasQr.has(r.id),
      isActive: r.is_active as boolean,
    })),
    monitors: (monitors ?? []).map((m) => ({ id: m.id as string, name: m.full_name as string, username: m.username as string, isActive: m.is_active as boolean })),
  };
}

export async function createBuilding(actor: SessionUser, name: string) {
  const { data, error } = await createServiceClient().from('buildings').insert({ name }).select('id').single();
  if (error) throw dbError(error.message);
  await audit(actor.id, 'buildings.create', 'buildings', data.id, { name });
  return { id: data.id as string };
}

export async function renameBuilding(actor: SessionUser, id: string, name: string) {
  const svc = createServiceClient();
  const { data: before } = await svc.from('buildings').select('name').eq('id', id).maybeSingle();
  if (!before) throw new ApiError(404, 'not_found', 'المبنى غير موجود.');
  const { error } = await svc.from('buildings').update({ name }).eq('id', id);
  if (error) throw dbError(error.message);
  await audit(actor.id, 'buildings.update', 'buildings', id, { before: before.name, after: name });
  return { ok: true };
}

async function assertBuilding(id: string) {
  const { data } = await createServiceClient().from('buildings').select('id').eq('id', id).maybeSingle();
  if (!data) throw new ApiError(422, 'validation', 'اختر المبنى.', { buildingId: 'اختر المبنى.' });
}

/** إضافة دورة مياه مع رمز QR فعّال جديد */
export async function createRestroom(actor: SessionUser, input: RestroomInput) {
  await assertBuilding(input.buildingId);
  const svc = createServiceClient();
  const { data, error } = await svc
    .from('restrooms')
    .insert({
      code: input.code,
      name: input.name,
      floor_label: input.floor,
      building_id: input.buildingId,
      monitor_id: input.monitorId,
      is_active: input.isActive,
    })
    .select('id')
    .single();
  if (error) throw dbError(error.message);
  const qr = await svc.from('qr_codes').insert({ restroom_id: data.id, token: newQrToken() });
  if (qr.error) console.error('[jodex] qr create failed', qr.error.message);
  await audit(actor.id, 'restrooms.create', 'restrooms', data.id, { ...input });
  return { id: data.id as string };
}

export async function updateRestroom(actor: SessionUser, id: string, input: RestroomInput) {
  await assertBuilding(input.buildingId);
  const svc = createServiceClient();
  const { data: before } = await svc
    .from('restrooms')
    .select('code, name, floor_label, building_id, monitor_id, is_active')
    .eq('id', id)
    .maybeSingle();
  if (!before) throw new ApiError(404, 'not_found', 'دورة المياه غير موجودة.');
  const { error } = await svc
    .from('restrooms')
    .update({
      code: input.code,
      name: input.name,
      floor_label: input.floor,
      building_id: input.buildingId,
      monitor_id: input.monitorId,
      is_active: input.isActive,
    })
    .eq('id', id);
  if (error) throw dbError(error.message);
  // دورة مياه أُعيد تفعيلها بلا رمز QR فعّال تحصل على رمز جديد
  if (input.isActive) {
    const { data: qr } = await svc.from('qr_codes').select('id').eq('restroom_id', id).eq('is_active', true).maybeSingle();
    if (!qr) await svc.from('qr_codes').insert({ restroom_id: id, token: newQrToken() });
  }
  await audit(actor.id, 'restrooms.update', 'restrooms', id, { before, after: input });
  return { ok: true };
}

/** إسناد عدة دورات مياه لمراقب أساسي واحد (أو إلغاء الإسناد) */
export async function assignMonitor(actor: SessionUser, restroomIds: string[], monitorId: string | null) {
  const svc = createServiceClient();
  const ids = [...new Set(restroomIds)];
  if (monitorId) {
    const { data: m } = await svc.from('users').select('id, role, monitor_kind, is_active').eq('id', monitorId).maybeSingle();
    if (!m || m.role !== 'contractor_monitor' || m.monitor_kind !== 'primary' || !m.is_active) {
      throw new ApiError(422, 'invalid_monitor', 'اختر مراقبًا أساسيًا نشطًا.');
    }
  }
  const { data, error } = await svc.from('restrooms').update({ monitor_id: monitorId }).in('id', ids).select('id');
  if (error) throw dbError(error.message);
  await audit(actor.id, 'restrooms.assign_monitor', 'restrooms', null, { restroom_ids: ids, monitor_id: monitorId });
  return { count: (data ?? []).length };
}

/** حذف دورة مياه بلا سجل تاريخي (جولات مرسلة/فائتة أو تقييمات). ذات السجل تُعطَّل بدل الحذف. */
export async function deleteRestroom(actor: SessionUser, id: string) {
  const svc = createServiceClient();
  const { data: room } = await svc.from('restrooms').select('id, code, name').eq('id', id).maybeSingle();
  if (!room) throw new ApiError(404, 'not_found', 'دورة المياه غير موجودة.');
  const [rounds, evals, feedback] = await Promise.all([
    svc.from('rounds').select('id', { count: 'exact', head: true }).eq('restroom_id', id).neq('status', 'pending'),
    svc.from('supervisor_evaluations').select('id', { count: 'exact', head: true }).eq('restroom_id', id),
    svc.from('beneficiary_feedback').select('id', { count: 'exact', head: true }).eq('restroom_id', id),
  ]);
  if ((rounds.count ?? 0) + (evals.count ?? 0) + (feedback.count ?? 0) > 0) {
    throw new ApiError(409, 'has_history', 'لدورة المياه جولات أو تقييمات محفوظة، فلا يمكن حذفها حفاظًا على السجل. عطّلها بدلًا من ذلك.');
  }
  const { error: roundsErr } = await svc.from('rounds').delete().eq('restroom_id', id).eq('status', 'pending');
  if (roundsErr) throw new Error(roundsErr.message);
  const { error } = await svc.from('restrooms').delete().eq('id', id);
  if (error) throw new ApiError(409, 'has_history', 'تعذّر حذف دورة المياه لارتباطها بسجلات أخرى. عطّلها بدلًا من ذلك.');
  await audit(actor.id, 'restrooms.delete', 'restrooms', id, { code: room.code, name: room.name });
  return { ok: true };
}

/** حذف مبنى فارغ (بلا دورات مياه) */
export async function deleteBuilding(actor: SessionUser, id: string) {
  const svc = createServiceClient();
  const { data: building } = await svc.from('buildings').select('id, name').eq('id', id).maybeSingle();
  if (!building) throw new ApiError(404, 'not_found', 'المبنى غير موجود.');
  const { count } = await svc.from('restrooms').select('id', { count: 'exact', head: true }).eq('building_id', id);
  if ((count ?? 0) > 0) throw new ApiError(409, 'building_not_empty', 'لا يمكن حذف مبنى فيه دورات مياه. احذفها أو انقلها لمبنى آخر أولًا.');
  const { error } = await svc.from('buildings').delete().eq('id', id);
  if (error) throw new Error(error.message);
  await audit(actor.id, 'buildings.delete', 'buildings', id, { name: building.name });
  return { ok: true };
}
