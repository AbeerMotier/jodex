/**
 * seed: تشغيله مرتين لا ينشئ تكرارًا، ووجود omar.z مرة واحدة كنائب لـ turki.
 */
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { serviceClient } from '../support/world';

function runSeed(): string {
  return execFileSync(process.execPath, ['--import', 'tsx', 'scripts/seed.ts'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: process.env,
    timeout: 120_000,
  });
}

async function snapshot() {
  const svc = serviceClient();
  const count = async (table: string) => {
    const { count, error } = await svc.from(table).select('*', { count: 'exact', head: true });
    if (error) throw new Error(`${table}: ${error.message}`);
    return count ?? 0;
  };
  const authUsers: string[] = [];
  for (let page = 1; page < 50; page++) {
    const { data } = await svc.auth.admin.listUsers({ page, perPage: 200 });
    authUsers.push(...data.users.map((u) => String(u.app_metadata?.jodex_username ?? '')));
    if (data.users.length < 200) break;
  }
  return {
    buildings: await count('buildings'),
    restrooms: await count('restrooms'),
    users: await count('users'),
    items: await count('checklist_items'),
    qr: await count('qr_codes'),
    assignments: await count('supervisor_assignments'),
    settings: await count('settings'),
    reasons: await count('feedback_reasons'),
    authUsers: authUsers.length,
    omarAuth: authUsers.filter((u) => u === 'omar.z').length,
  };
}

describe('seed', () => {
  it('تشغيله مرتين لا ينشئ تكرارًا ولا يطبع كلمات مرور في المرة الثانية', async () => {
    runSeed(); // يضمن وجود البيانات الأساسية (قد تُنشأ الآن في قاعدة جديدة)
    const before = await snapshot();
    const output = runSeed();
    const after = await snapshot();
    expect(after).toEqual(before);
    expect(output).toContain('لا توجد حسابات جديدة');
    expect(output).not.toContain('كلمات مرور الحسابات الجديدة');
    expect(before.settings).toBe(1);
  });

  it('omar.z موجود مرة واحدة كنائب لـ turki', async () => {
    const svc = serviceClient();
    const { data: rows } = await svc.from('users').select('id, role, monitor_kind, substitute_for_id').eq('username', 'omar.z');
    expect(rows).toHaveLength(1);
    const { data: turki } = await svc.from('users').select('id, monitor_kind').eq('username', 'turki').single();
    expect(rows![0]).toMatchObject({ role: 'contractor_monitor', monitor_kind: 'substitute', substitute_for_id: turki!.id });
    expect(turki!.monitor_kind).toBe('primary');
    const snap = await snapshot();
    expect(snap.omarAuth).toBe(1);
  });

  it('لكل دورة مياه نشطة رمز QR فعال واحد، ومراقب أساسي واحد فقط', async () => {
    const svc = serviceClient();
    const { data: rooms } = await svc.from('restrooms').select('id, code, monitor_id').eq('is_active', true);
    const { data: codes } = await svc.from('qr_codes').select('restroom_id, token').eq('is_active', true);
    const { data: primaries } = await svc.from('users').select('id').eq('monitor_kind', 'primary');
    const primaryIds = new Set((primaries ?? []).map((p) => p.id));
    for (const r of rooms ?? []) {
      expect(codes!.filter((c) => c.restroom_id === r.id)).toHaveLength(1);
      if (r.monitor_id) expect(primaryIds.has(r.monitor_id)).toBe(true);
    }
    // الرابط العام لا يكشف أي معرّف داخلي: رمز عشوائي ≥ 128 بت
    for (const c of codes ?? []) expect(c.token).toMatch(/^[A-Za-z0-9_-]{32,}$/);
  });
});
