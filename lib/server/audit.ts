import 'server-only';
import { createServiceClient } from './supabase';

/** سجل التدقيق: دخول، إرسال، تعديل إعدادات، اعتماد مكافأة، طباعة QR، تصدير */
export async function audit(
  actorId: string | null,
  action: string,
  entity: string | null,
  entityId: string | null,
  data?: Record<string, unknown>,
) {
  const { error } = await createServiceClient()
    .from('audit_log')
    .insert({ actor_id: actorId, action, entity, entity_id: entityId, data: data ?? null });
  if (error) console.error('[jodex] audit log failed', action, error.message);
}
