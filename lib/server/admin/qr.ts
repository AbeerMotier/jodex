import 'server-only';
import { headers } from 'next/headers';
import QRCode from 'qrcode';
import { env } from '../env';
import { createUserClient } from '../supabase';
import { loadRestroomRefs } from './common';

export async function qrSvg(content: string): Promise<string> {
  return QRCode.toString(content, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 0,
    color: { dark: '#2F4F44', light: '#FFFFFF' },
  });
}

/**
 * عنوان الموقع الذي يُطبع منه الرمز (jodix1 أو jodix11…) — حتى لا يشير الرمز إلى نطاق خاطئ
 * إن اختلف PUBLIC_APP_URL عن الموقع الفعلي. الاحتياط: PUBLIC_APP_URL.
 */
async function siteOrigin(): Promise<string> {
  try {
    const h = await headers();
    const host = (h.get('x-forwarded-host') ?? h.get('host') ?? '').split(',')[0].trim();
    if (host && /^[a-z0-9.-]+(:\d+)?$/i.test(host)) {
      const proto = (h.get('x-forwarded-proto') ?? '').split(',')[0].trim() || (/^(localhost|127\.)/.test(host) ? 'http' : 'https');
      return `${proto === 'http' ? 'http' : 'https'}://${host}`;
    }
  } catch {
    // خارج سياق الطلب
  }
  return env.publicAppUrl;
}

/** محتوى رمز QR: رابط صفحة التقييم المنتهي بترميز دورة المياه (بلا اسم ولا معرّف داخلي) — تفتحه كاميرا الجوال مباشرة */
export function rateUrl(origin: string, code: string) {
  return `${origin}/r/${encodeURIComponent(code)}`;
}

/** بطاقات رموز QR: محتوى الرمز = ترميز دورة المياه فقط */
export async function listQrCards(buildingId?: string) {
  const client = await createUserClient();
  const rooms = await loadRestroomRefs(client);
  const { data: codes, error } = await client.from('qr_codes').select('id, restroom_id, token').eq('is_active', true);
  if (error) throw new Error(error.message);
  const byRoom = new Map((codes ?? []).map((c) => [c.restroom_id, c]));
  const origin = await siteOrigin();
  const cards = [];
  for (const r of rooms) {
    if (buildingId && r.building_id !== buildingId) continue;
    const code = byRoom.get(r.id);
    if (!code) continue;
    cards.push({
      id: code.id,
      restroom: { id: r.id, code: r.code, name: r.name, floor: r.floor_label, building: r.building_name },
      url: rateUrl(origin, r.code),
      content: rateUrl(origin, r.code),
      svg: await qrSvg(rateUrl(origin, r.code)),
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
  const url = rateUrl(await siteOrigin(), r.code);
  return {
    id: code.id,
    restroom: { code: r.code, name: r.name, floor: r.floor_label, building: r.building_name },
    url,
    content: url,
    svg: await qrSvg(url),
  };
}
