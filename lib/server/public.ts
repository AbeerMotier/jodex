import 'server-only';
import { createHmac } from 'node:crypto';
import { env } from './env';
import { createServiceClient } from './supabase';

export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{22,128}$/;

export interface PublicRestroom {
  qrId: string;
  restroomId: string;
  name: string;
  floor: string;
  building: string;
}

/** يتحقق من رمز QR (نشط، ودورة المياه نشطة) دون كشف أي معرّف داخلي في الرابط */
export async function resolveQrToken(token: string): Promise<PublicRestroom | null> {
  if (!TOKEN_PATTERN.test(token)) return null;
  const svc = createServiceClient();
  const { data: qr } = await svc.from('qr_codes').select('id, restroom_id, is_active').eq('token', token).maybeSingle();
  if (!qr || !qr.is_active) return null;
  const { data: room } = await svc
    .from('restrooms')
    .select('id, name, floor_label, is_active, building_id')
    .eq('id', qr.restroom_id)
    .maybeSingle();
  if (!room || !room.is_active) return null;
  const { data: building } = await svc.from('buildings').select('name').eq('id', room.building_id).maybeSingle();
  return { qrId: qr.id, restroomId: room.id, name: room.name, floor: room.floor_label, building: building?.name ?? '' };
}

/** بصمة غير قابلة للعكس للجهاز (كوكي عشوائي) أو لعنوان IP + المتصفح عند تعطيل الكوكيز */
export function clientHash(deviceId: string | undefined, ip: string, userAgent: string): string {
  const source = deviceId ? `dev:${deviceId}` : `ip:${ip}|ua:${userAgent.slice(0, 200)}`;
  return createHmac('sha256', env.appSecret).update(source).digest('hex');
}
