/**
 * أداة إدارية (سطر أوامر) لإدارة المستخدمين ودورات المياه والإسناد ورموز QR.
 * [قرار مطلوب] لا توجد صفحات لهذه الإدارة في التصميم، لذلك تُنفّذ هنا مؤقتًا.
 *
 *   npm run admin -- help
 */
import { generatePassword, newQrToken, upsertAccount } from './lib/accounts';
import { serviceClient } from './lib/env';

type Args = Record<string, string | boolean>;

function parseArgs(argv: string[]): { command: string; args: Args } {
  const [command = 'help', ...rest] = argv;
  const args: Args = {};
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = rest[i + 1];
    if (next === undefined || next.startsWith('--')) args[key] = true;
    else {
      args[key] = next;
      i++;
    }
  }
  return { command, args };
}

function need(args: Args, key: string): string {
  const v = args[key];
  if (typeof v !== 'string' || !v.trim()) {
    console.error(`✗ الخيار --${key} مطلوب`);
    process.exit(1);
  }
  return v.trim();
}

const HELP = `
جُودِكس — الأداة الإدارية
الاستخدام: npm run admin -- <أمر> [خيارات]

المستخدمون:
  users:list
  users:add --username <u> --name "<الاسم>" --role admin|supervisor|monitor [--kind primary|substitute]
            [--restroom <CODE>[,<CODE>…]] [--substitute-for <username>]
  users:update --username <u> [--name "<الاسم>"] [--restroom <CODE>[,<CODE>…]] [--substitute-for <username>]
  users:deactivate --username <u>        (يمنع الدخول ويُنهي الجلسات)
  users:activate --username <u>
  users:reset-password --username <u>    (كلمة مرور عشوائية تُطبع مرة واحدة)

دورات المياه والمباني:
  buildings:list
  buildings:add --name "<اسم المبنى>"
  restrooms:list
  restrooms:add --code <CODE> --name "<الاسم>" --building "<المبنى>" --floor "<الدور>"
  restrooms:update --code <CODE> [--name ...] [--building ...] [--floor ...]
  restrooms:deactivate --code <CODE>
  restrooms:activate --code <CODE>

الإسناد ورموز QR:
  assign --supervisor <username> --restroom <CODE>
  unassign --supervisor <username> --restroom <CODE>
  qr:rotate --restroom <CODE>            (يعطّل الرمز الحالي وينشئ رمزًا جديدًا)
`;

async function main() {
  const { command, args } = parseArgs(process.argv.slice(2));
  if (command === 'help' || command === '--help') {
    console.log(HELP);
    return;
  }
  const svc = serviceClient();

  const audit = async (action: string, entity: string, entityId: string | null, data: Record<string, unknown>) => {
    await svc.from('audit_log').insert({ actor_id: null, action: `cli.${action}`, entity, entity_id: entityId, data });
  };
  const restroomByCode = async (code: string) => {
    const { data } = await svc.from('restrooms').select('id, code, name, is_active').eq('code', code.toUpperCase()).maybeSingle();
    if (!data) {
      console.error(`✗ لا توجد دورة مياه بالرمز ${code}`);
      process.exit(1);
    }
    return data;
  };
  /** --restroom A0M أو عدة رموز مفصولة بفاصلة: A0M,A0F */
  const restroomIdsByCodes = async (value: unknown) => {
    if (typeof value !== 'string' || !value.trim()) return [];
    const ids: string[] = [];
    for (const code of value.split(',').map((c) => c.trim()).filter(Boolean)) ids.push((await restroomByCode(code)).id);
    return ids;
  };
  const userByUsername = async (username: string) => {
    const { data } = await svc
      .from('users')
      .select('id, username, full_name, role, monitor_kind, substitute_for_id, is_active')
      .eq('username', username.toLowerCase())
      .maybeSingle();
    if (!data) {
      console.error(`✗ لا يوجد مستخدم باسم ${username}`);
      process.exit(1);
    }
    return data;
  };
  const buildingByName = async (name: string) => {
    const { data } = await svc.from('buildings').select('id, name').eq('name', name).maybeSingle();
    if (!data) {
      console.error(`✗ لا يوجد مبنى باسم «${name}». أضِفه أولًا: buildings:add`);
      process.exit(1);
    }
    return data;
  };

  switch (command) {
    case 'users:list': {
      const [{ data: users }, { data: rooms }] = await Promise.all([
        svc.from('users').select('id, username, full_name, role, monitor_kind, is_active, substitute_for_id').order('role').order('username'),
        svc.from('restrooms').select('code, monitor_id').order('code'),
      ]);
      const codesOf = new Map<string, string[]>();
      for (const r of rooms ?? []) if (r.monitor_id) codesOf.set(r.monitor_id, [...(codesOf.get(r.monitor_id) ?? []), r.code]);
      const uname = new Map((users ?? []).map((u) => [u.id, u.username]));
      console.table(
        (users ?? []).map((u) => ({
          username: u.username,
          name: u.full_name,
          role: u.role,
          kind: u.monitor_kind ?? '',
          restrooms: (codesOf.get(u.id) ?? []).join(' '),
          substitute_for: u.substitute_for_id ? uname.get(u.substitute_for_id) : '',
          active: u.is_active,
        })),
      );
      return;
    }
    case 'users:add': {
      const username = need(args, 'username').toLowerCase();
      const name = need(args, 'name');
      const roleArg = need(args, 'role');
      const role = roleArg === 'monitor' ? 'contractor_monitor' : roleArg;
      if (!['admin', 'supervisor', 'contractor_monitor'].includes(role)) {
        console.error('✗ الدور يجب أن يكون admin أو supervisor أو monitor');
        process.exit(1);
      }
      let monitor_kind: 'primary' | 'substitute' | null = null;
      let restroom_ids: string[] = [];
      let substitute_for_id: string | null = null;
      if (role === 'contractor_monitor') {
        monitor_kind = (args.kind === 'substitute' ? 'substitute' : 'primary') as 'primary' | 'substitute';
        if (monitor_kind === 'primary') restroom_ids = await restroomIdsByCodes(args.restroom);
        else substitute_for_id = (await userByUsername(need(args, 'substitute-for'))).id;
      }
      const res = await upsertAccount(svc, {
        username,
        full_name: name,
        role: role as 'admin' | 'supervisor' | 'contractor_monitor',
        monitor_kind,
        restroom_ids,
        substitute_for_id,
      });
      await audit('users.add', 'users', res.id, { username, role });
      console.log(res.created ? `✓ أُنشئ الحساب ${username}` : `✓ حُدّث الحساب ${username}`);
      if (res.password) console.log(`كلمة المرور (تُعرض مرة واحدة): ${res.password}`);
      return;
    }
    case 'users:update': {
      const user = await userByUsername(need(args, 'username'));
      const patch: Record<string, unknown> = {};
      if (typeof args.name === 'string') patch.full_name = args.name;
      if (typeof args['substitute-for'] === 'string') patch.substitute_for_id = (await userByUsername(args['substitute-for'])).id;
      if (Object.keys(patch).length) {
        const { error } = await svc.from('users').update(patch).eq('id', user.id);
        if (error) throw error;
      }
      if (typeof args.restroom === 'string') {
        if (user.monitor_kind !== 'primary') {
          console.error('✗ إسناد دورات المياه للمراقب الأساسي فقط');
          process.exit(1);
        }
        const ids = await restroomIdsByCodes(args.restroom);
        const { error } = await svc.from('restrooms').update({ monitor_id: user.id }).in('id', ids);
        if (error) throw error;
        patch.restrooms = args.restroom;
      }
      await audit('users.update', 'users', user.id, patch);
      console.log(`✓ حُدّث ${user.username}`);
      return;
    }
    case 'users:deactivate':
    case 'users:activate': {
      const user = await userByUsername(need(args, 'username'));
      const active = command === 'users:activate';
      const { error } = await svc.from('users').update({ is_active: active }).eq('id', user.id);
      if (error) throw error;
      await svc.auth.admin.updateUserById(user.id, { ban_duration: active ? 'none' : '876000h' });
      await audit(command.replace('users:', 'users.'), 'users', user.id, { username: user.username });
      console.log(`✓ ${active ? 'فُعّل' : 'عُطّل'} الحساب ${user.username}`);
      return;
    }
    case 'users:reset-password': {
      const user = await userByUsername(need(args, 'username'));
      const password = generatePassword();
      const { error } = await svc.auth.admin.updateUserById(user.id, { password });
      if (error) throw error;
      await svc.rpc('clear_login_failures', { p_username: user.username });
      await audit('users.reset_password', 'users', user.id, { username: user.username });
      console.log(`✓ كلمة المرور الجديدة لـ ${user.username} (تُعرض مرة واحدة): ${password}`);
      return;
    }
    case 'buildings:list': {
      const { data } = await svc.from('buildings').select('name, created_at').order('name');
      console.table(data ?? []);
      return;
    }
    case 'buildings:add': {
      const name = need(args, 'name');
      const { data, error } = await svc.from('buildings').upsert({ name }, { onConflict: 'name' }).select('id').single();
      if (error) throw error;
      await audit('buildings.add', 'buildings', data.id, { name });
      console.log(`✓ المبنى «${name}» جاهز`);
      return;
    }
    case 'restrooms:list': {
      const [{ data: rooms }, { data: blds }] = await Promise.all([
        svc.from('restrooms').select('code, name, floor_label, is_active, building_id').order('code'),
        svc.from('buildings').select('id, name'),
      ]);
      const bname = new Map((blds ?? []).map((b) => [b.id, b.name]));
      console.table(
        (rooms ?? []).map((r) => ({ code: r.code, name: r.name, floor: r.floor_label, building: bname.get(r.building_id), active: r.is_active })),
      );
      return;
    }
    case 'restrooms:add': {
      const code = need(args, 'code').toUpperCase();
      const building = await buildingByName(need(args, 'building'));
      const { data, error } = await svc
        .from('restrooms')
        .insert({ code, name: need(args, 'name'), floor_label: need(args, 'floor'), building_id: building.id })
        .select('id')
        .single();
      if (error) throw error;
      await svc.from('qr_codes').insert({ restroom_id: data.id, token: newQrToken() });
      await audit('restrooms.add', 'restrooms', data.id, { code });
      console.log(`✓ أُضيفت دورة المياه ${code} مع رمز QR. أسند لها مراقبًا أساسيًا: users:add ... --restroom ${code}`);
      return;
    }
    case 'restrooms:update': {
      const restroom = await restroomByCode(need(args, 'code'));
      const patch: Record<string, unknown> = {};
      if (typeof args.name === 'string') patch.name = args.name;
      if (typeof args.floor === 'string') patch.floor_label = args.floor;
      if (typeof args.building === 'string') patch.building_id = (await buildingByName(args.building)).id;
      const { error } = await svc.from('restrooms').update(patch).eq('id', restroom.id);
      if (error) throw error;
      await audit('restrooms.update', 'restrooms', restroom.id, patch);
      console.log(`✓ حُدّثت ${restroom.code}`);
      return;
    }
    case 'restrooms:deactivate':
    case 'restrooms:activate': {
      const restroom = await restroomByCode(need(args, 'code'));
      const active = command === 'restrooms:activate';
      const { error } = await svc.from('restrooms').update({ is_active: active }).eq('id', restroom.id);
      if (error) throw error;
      await audit(command.replace('restrooms:', 'restrooms.'), 'restrooms', restroom.id, { code: restroom.code });
      console.log(`✓ ${active ? 'فُعّلت' : 'عُطّلت'} ${restroom.code}${active ? '' : ' (رمز QR الخاص بها يصبح غير صالح)'}`);
      return;
    }
    case 'assign':
    case 'unassign': {
      const sup = await userByUsername(need(args, 'supervisor'));
      if (sup.role !== 'supervisor') {
        console.error('✗ المستخدم ليس مشرف وزارة');
        process.exit(1);
      }
      const restroom = await restroomByCode(need(args, 'restroom'));
      if (command === 'assign') {
        const { error } = await svc
          .from('supervisor_assignments')
          .upsert({ supervisor_id: sup.id, restroom_id: restroom.id }, { onConflict: 'supervisor_id,restroom_id', ignoreDuplicates: true });
        if (error) throw error;
      } else {
        const { error } = await svc.from('supervisor_assignments').delete().eq('supervisor_id', sup.id).eq('restroom_id', restroom.id);
        if (error) throw error;
      }
      await audit(command, 'supervisor_assignments', sup.id, { restroom: restroom.code });
      console.log(`✓ ${command === 'assign' ? 'أُسند' : 'أُلغي إسناد'} ${restroom.code} ${command === 'assign' ? 'إلى' : 'من'} ${sup.username}`);
      return;
    }
    case 'qr:rotate': {
      const restroom = await restroomByCode(need(args, 'restroom'));
      const { error: offErr } = await svc.from('qr_codes').update({ is_active: false }).eq('restroom_id', restroom.id).eq('is_active', true);
      if (offErr) throw offErr;
      const { data, error } = await svc.from('qr_codes').insert({ restroom_id: restroom.id, token: newQrToken() }).select('id').single();
      if (error) throw error;
      await audit('qr.rotate', 'qr_codes', data.id, { restroom: restroom.code });
      console.log(`✓ أُنشئ رمز QR جديد لـ ${restroom.code}؛ الرمز السابق أصبح غير صالح — اطبع البطاقة الجديدة من لوحة الأدمن.`);
      return;
    }
    default:
      console.error(`✗ أمر غير معروف: ${command}`);
      console.log(HELP);
      process.exit(1);
  }
}

main().catch((e) => {
  console.error('✗ فشل التنفيذ:', e?.message ?? e);
  process.exit(1);
});
