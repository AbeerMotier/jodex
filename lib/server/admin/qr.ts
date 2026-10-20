import 'server-only';
import QRCode from 'qrcode';
import { env } from '../env';
import { createUserClient } from '../supabase';
import { loadRestroomRefs } from './common';

/** رمز QR بمحتوى نصي فقط (ترميز دورة المياه، بلا رابط أو اسم أو بيانات إضافية) */
export async function qrSvg(content: string): Promise<string> {
  return QRCode.toString(content, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 0,
    color: { dark: '#2F4F44', light: '#FFFFFF' },
  });
}

export function publicRateUrl(ref: string) {
  return `${env.publicAppUrl}/r/${encodeURIComponent(ref)}`;
}

/** صفحة مسح الرمز بالكاميرا (رمز QR يحتوي الترميز فقط فلا يفتح رابطًا بنفسه) */
export function scanPageUrl() {
  return `${env.publicAppUrl}/scan`;
}

/** بطاقات رموز QR: محتوى الرمز = ترميز دورة المياه فقط */
export async function listQrCards(buildingId?: string) {
  const client = await createUserClient();
  const rooms = await loadRestroomRefs(client);
  const { data: codes, error } = await client.from('qr_codes').select('id, restroom_id, token').eq('is_active', true);
  if (error) throw new Error(error.message);
  const byRoom = new Map((codes ?? []).map((c) => [c.restroom_id, c]));
  const cards = [];
  for (const r of rooms) {
    if (buildingId && r.building_id !== buildingId) continue;
    const code = byRoom.get(r.id);
    if (!code) continue;
    cards.push({
      id: code.id,
      restroom: { id: r.id, code: r.code, name: r.name, floor: r.floor_label, building: r.building_name },
      url: publicRateUrl(r.code),
      content: r.code,
      scanUrl: scanPageUrl().replace(/^https?:\/\//, ''),
      svg: await qrSvg(r.code),
    });
  }
  return { cards };
}

export async function qrCardById(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const client = await createUserClient();
  const { data: code } = await client.from('qr_codes').select('id, restroom_id, token, is_active').eq('id', id).maybeSingle();
  if (!code || !code.is_active) return null;
  const rooms = await loadRestroomRefs(client, { includeInactive: true });
  const r = rooms.find((x) => x.id === code.restroom_id);
  if (!r) return null;
  return {
    id: code.id,
    restroom: { code: r.code, name: r.name, floor: r.floor_label, building: r.building_name },
    url: publicRateUrl(r.code),
    content: r.code,
    scanUrl: scanPageUrl().replace(/^https?:\/\//, ''),
    svg: await qrSvg(r.code),
  };
}
