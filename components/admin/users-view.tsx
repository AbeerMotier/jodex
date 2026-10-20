'use client';
import { useMemo, useState } from 'react';
import { Chip } from '@/components/ui/chip';
import { IconEdit, IconPlus } from '@/components/ui/icons';
import { Modal } from '@/components/ui/overlay';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { api, ApiClientError } from '@/lib/client/api';
import { useApi } from '@/lib/client/use-api';
import { ADMIN_SCOPE_LABEL, ROLE_LABEL, type AdminScope, type MonitorKind, type Role } from '@/lib/domain/catalog';
import { userCreateSchema, userUpdateSchema } from '@/lib/domain/validation';
import { BTN_PRIMARY, BTN_SMALL, DialogActions, Field, INPUT, PasswordDialog, RestroomChecklist, type PickRoom } from './manage-ui';
import { PageHeader } from './page-header';

interface UserView {
  id: string;
  username: string;
  fullName: string;
  role: Role;
  roleLabel: string;
  monitorKind: MonitorKind | null;
  substituteForId: string | null;
  substituteForName: string | null;
  isActive: boolean;
  adminScope: AdminScope | null;
  restroomIds: string[];
}
interface Room {
  id: string;
  code: string;
  name: string;
  floor: string;
  buildingId: string;
  monitorId: string | null;
  isActive: boolean;
}
interface UsersData {
  users: UserView[];
  buildings: { id: string; name: string }[];
  restrooms: Room[];
}

const ROLE_TABS: { value: Role | 'all'; label: string }[] = [
  { value: 'all', label: 'الكل' },
  { value: 'admin', label: 'الأدمن' },
  { value: 'supervisor', label: 'المشرفون الميدانيون' },
  { value: 'contractor_monitor', label: 'مراقبو المقاول' },
  { value: 'contractor', label: 'المقاول' },
];

const ROLE_TONE: Record<Role, 'brand' | 'supervisor' | 'monitor' | 'neutral'> = {
  admin: 'brand',
  supervisor: 'supervisor',
  contractor_monitor: 'monitor',
  contractor: 'neutral',
};

function assignable(u: UserView) {
  return u.role === 'supervisor' || u.role === 'contractor' || (u.role === 'contractor_monitor' && u.monitorKind === 'primary');
}

function detailText(u: UserView) {
  if (u.role === 'contractor_monitor') {
    if (u.monitorKind === 'substitute') return `نائب عن ${u.substituteForName ?? '—'}`;
    return u.restroomIds.length ? `مسؤول عن ${u.restroomIds.length} دورة مياه` : 'لا توجد دورات مياه مسندة';
  }
  if (u.role === 'supervisor') return u.restroomIds.length ? `يقيّم ${u.restroomIds.length} موقعًا` : 'لا توجد مواقع مسندة';
  if (u.role === 'contractor') return u.restroomIds.length ? `${u.restroomIds.length} دورة مياه مسندة (عرض فقط)` : 'لا توجد دورات مياه مسندة';
  return u.adminScope === 'limited' ? ADMIN_SCOPE_LABEL.limited : 'كل الصلاحيات';
}

export function UsersView() {
  const toast = useToast();
  const { data, error, loading, reload } = useApi<UsersData>('/api/admin/users');
  const [tab, setTab] = useState<Role | 'all'>('all');
  const [q, setQ] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<UserView | 'new' | null>(null);
  const [linking, setLinking] = useState<UserView | null>(null);
  const [secret, setSecret] = useState<{ title: string; username: string; password: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [passwordFor, setPasswordFor] = useState<UserView | null>(null);

  const list = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (data?.users ?? []).filter(
      (u) =>
        (tab === 'all' || u.role === tab) &&
        (showInactive || u.isActive) &&
        (!term || u.fullName.toLowerCase().includes(term) || u.username.includes(term)),
    );
  }, [data, tab, q, showInactive]);

  async function toggleActive(u: UserView) {
    if (u.isActive && !window.confirm(`تعطيل حساب ${u.fullName}؟ لن يتمكن من الدخول حتى يُعاد تفعيله.`)) return;
    setBusy(u.id);
    try {
      await api(`/api/admin/users/${u.id}`, { method: 'PATCH', body: { isActive: !u.isActive } });
      toast.show(u.isActive ? 'عُطّل الحساب' : 'فُعّل الحساب', 'success');
      reload();
    } catch (e) {
      toast.show(e instanceof ApiClientError ? e.message : 'تعذّر الحفظ.', 'error');
    } finally {
      setBusy(null);
    }
  }

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: 0, admin: 0, supervisor: 0, contractor_monitor: 0, contractor: 0 };
    for (const u of data?.users ?? []) {
      if (!showInactive && !u.isActive) continue;
      c.all++;
      c[u.role]++;
    }
    return c;
  }, [data, showInactive]);

  return (
    <>
      <PageHeader
        title="المستخدمون والصلاحيات"
        sub="إضافة الحسابات وتعديل أدوارها، وربط المراقبين بدورات المياه، وتحديد مواقع المشرفين"
        actions={
          <button type="button" className={BTN_PRIMARY} onClick={() => setEditing('new')} data-testid="user-add">
            <IconPlus size={16} /> إضافة مستخدم
          </button>
        }
      />

      <div className="flex animate-fade-up flex-wrap items-center gap-2">
        {ROLE_TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => setTab(t.value)}
            aria-pressed={tab === t.value}
            className="rounded-full border px-3.5 py-1.5 text-[13px] font-semibold"
            style={tab === t.value ? { background: '#2F4F44', color: '#fff', borderColor: '#2F4F44' } : { background: '#fff', borderColor: '#E3EAE6', color: '#2F4F44' }}
          >
            {t.label} <span className="tabular opacity-80">({counts[t.value]})</span>
          </button>
        ))}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="بحث بالاسم أو اسم المستخدم" className={`${INPUT} ms-auto min-w-[220px]`} data-testid="user-search" />
        <label className="flex items-center gap-1.5 text-[13px] text-muted">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} className="h-4 w-4 accent-[#55957A]" />
          إظهار المعطّلين
        </label>
      </div>

      {error && !data && (
        <div className="rounded-[18px] border border-line bg-white p-6 text-center text-[13.5px]">
          {error.message}{' '}
          <button type="button" onClick={reload} className="font-semibold underline">
            إعادة المحاولة
          </button>
        </div>
      )}
      {loading && !data && <Skeleton className="h-[360px] rounded-[18px]" />}

      {data && (
        <div className="animate-fade-up overflow-x-auto rounded-[18px] border border-line bg-white" data-testid="users-table">
          <div className="min-w-[760px]">
            <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.3fr)_90px_minmax(270px,auto)] gap-3 bg-[#F6F9F7] px-[18px] py-3 text-[12.5px] font-semibold text-ink-2">
              <span>الموظف</span>
              <span>الدور</span>
              <span>الإسناد</span>
              <span>الحالة</span>
              <span>إجراءات</span>
            </div>
            {list.length === 0 && <div className="border-t border-divider px-5 py-8 text-center text-[13.5px] text-muted">لا يوجد مستخدمون مطابقون.</div>}
            {list.map((u) => (
              <div
                key={u.id}
                className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.3fr)_90px_minmax(270px,auto)] items-center gap-3 border-t border-divider px-[18px] py-3 text-[13.5px]"
                data-testid={`user-row-${u.username}`}
                style={u.isActive ? undefined : { opacity: 0.6 }}
              >
                <span className="flex min-w-0 flex-col">
                  <span className="font-semibold text-ink">{u.fullName}</span>
                  <span dir="ltr" className="tabular text-right text-[12px] text-muted">
                    {u.username}
                  </span>
                </span>
                <span className="flex flex-wrap items-center gap-1">
                  <Chip tone={ROLE_TONE[u.role]} size="sm">
                    {u.roleLabel}
                  </Chip>
                  {u.monitorKind && (
                    <Chip tone="neutral" size="sm">
                      {u.monitorKind === 'primary' ? 'أساسي' : 'نائب'}
                    </Chip>
                  )}
                </span>
                <span className="text-[12.5px] text-muted">{detailText(u)}</span>
                <span>
                  <Chip tone={u.isActive ? 'success' : 'error'} size="sm" dot>
                    {u.isActive ? 'نشط' : 'معطّل'}
                  </Chip>
                </span>
                <span className="flex flex-wrap gap-1.5">
                  <button type="button" className={BTN_SMALL} onClick={() => setEditing(u)} data-testid={`user-edit-${u.username}`}>
                    <IconEdit size={14} /> تعديل
                  </button>
                  {assignable(u) && (
                    <button type="button" className={BTN_SMALL} onClick={() => setLinking(u)} data-testid={`user-link-${u.username}`}>
                      {u.role === 'supervisor' ? 'المواقع' : 'دورات المياه'}
                    </button>
                  )}
                  <button type="button" className={BTN_SMALL} onClick={() => setPasswordFor(u)} data-testid={`user-reset-${u.username}`}>
                    كلمة المرور
                  </button>
                  <button type="button" className={BTN_SMALL} disabled={busy === u.id} onClick={() => toggleActive(u)} data-testid={`user-toggle-${u.username}`}>
                    {u.isActive ? 'تعطيل' : 'تفعيل'}
                  </button>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <UserDialog
        target={editing}
        primaries={(data?.users ?? []).filter((u) => u.role === 'contractor_monitor' && u.monitorKind === 'primary' && u.isActive)}
        onClose={() => setEditing(null)}
        onSaved={(created) => {
          setEditing(null);
          reload();
          if (created) setSecret({ title: 'تم إنشاء الحساب', ...created });
          else toast.show('تم حفظ التعديلات', 'success');
        }}
      />
      {data && (
        <LinkDialog
          user={linking}
          data={data}
          onClose={() => setLinking(null)}
          onSaved={() => {
            setLinking(null);
            reload();
            toast.show('تم حفظ الإسناد', 'success');
          }}
        />
      )}
      <SetPasswordDialog
        user={passwordFor}
        onClose={() => setPasswordFor(null)}
        onDone={(res) => {
          setPasswordFor(null);
          setSecret({ title: 'تم تغيير كلمة المرور', ...res });
        }}
      />
      <PasswordDialog value={secret} onClose={() => setSecret(null)} />
    </>
  );
}

function UserDialog({
  target,
  primaries,
  onClose,
  onSaved,
}: {
  target: UserView | 'new' | null;
  primaries: UserView[];
  onClose: () => void;
  onSaved: (created: { username: string; password: string } | null) => void;
}) {
  const isNew = target === 'new';
  const [username, setUsername] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<Role>('contractor_monitor');
  const [kind, setKind] = useState<MonitorKind>('primary');
  const [substituteFor, setSubstituteFor] = useState('');
  const [adminScope, setAdminScope] = useState<AdminScope>('full');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  // تهيئة الحقول عند فتح النافذة
  const [openedFor, setOpenedFor] = useState<UserView | 'new' | null>(null);
  if (target && target !== openedFor) {
    setOpenedFor(target);
    setErrors({});
    if (target === 'new') {
      setUsername('');
      setFullName('');
      setRole('contractor_monitor');
      setKind('primary');
      setSubstituteFor('');
      setAdminScope('full');
    } else {
      setUsername(target.username);
      setFullName(target.fullName);
      setRole(target.role);
      setKind(target.monitorKind ?? 'primary');
      setSubstituteFor(target.substituteForId ?? '');
      setAdminScope(target.adminScope ?? 'full');
    }
  } else if (!target && openedFor) {
    setOpenedFor(null);
  }

  const isMonitor = role === 'contractor_monitor';
  const editingUser = target && target !== 'new' ? target : null;

  async function submit() {
    const payload = {
      ...(isNew || username !== editingUser?.username ? { username } : {}),
      fullName,
      role,
      monitorKind: isMonitor ? kind : null,
      substituteForId: isMonitor && kind === 'substitute' ? substituteFor || null : null,
      ...(role === 'admin' ? { adminScope } : {}),
    };
    const parsed = (isNew ? userCreateSchema : userUpdateSchema).safeParse(payload);
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const i of parsed.error.issues) errs[String(i.path[0] ?? '_')] ??= i.message;
      setErrors(errs);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      if (isNew) {
        const res = await api<{ username: string; password: string }>('/api/admin/users', { method: 'POST', body: payload });
        onSaved(res);
      } else {
        await api(`/api/admin/users/${editingUser!.id}`, { method: 'PATCH', body: payload });
        onSaved(null);
      }
    } catch (e) {
      if (e instanceof ApiClientError) setErrors({ ...(e.fields ?? {}), _: e.message });
      else setErrors({ _: 'تعذّر الحفظ. حاول مرة أخرى.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={Boolean(target)} onClose={onClose} title={isNew ? 'إضافة مستخدم' : 'تعديل مستخدم'} width={480}>
      <div className="flex flex-col gap-3.5" data-testid="user-dialog">
        <Field label="اسم المستخدم (للدخول)" error={errors.username} hint="حروف إنجليزية صغيرة وأرقام و . _ - (مثل ahmed.k)">
          <input dir="ltr" value={username} onChange={(e) => setUsername(e.target.value.toLowerCase())} maxLength={32} className={`${INPUT} text-left`} data-testid="user-username" />
        </Field>
        <Field label="الاسم الكامل" error={errors.fullName}>
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} maxLength={120} className={INPUT} data-testid="user-fullname" />
        </Field>
        <Field label="الدور" error={errors.role}>
          <select value={role} onChange={(e) => setRole(e.target.value as Role)} className={INPUT} data-testid="user-role">
            {(['admin', 'supervisor', 'contractor_monitor', 'contractor'] as Role[]).map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </Field>
        {role === 'admin' && (
          <Field label="صلاحيات الأدمن" error={errors.adminScope} hint="المحدود يرى كل صفحات الأدمن ويستخدمها عدا المستخدمين والصلاحيات والمباني ودورات المياه والإعدادات والأوزان.">
            <select value={adminScope} onChange={(e) => setAdminScope(e.target.value as AdminScope)} className={INPUT} data-testid="user-admin-scope">
              {(['full', 'limited'] as AdminScope[]).map((s) => (
                <option key={s} value={s}>
                  {ADMIN_SCOPE_LABEL[s]}
                </option>
              ))}
            </select>
          </Field>
        )}
        {role === 'contractor' && (
          <div className="rounded-[10px] bg-[#F6F9F7] px-3 py-2 text-[12.5px] text-muted">المقاول يرى دورات المياه المسندة إليه للعرض فقط؛ تُسند من زر «دورات المياه».</div>
        )}
        {isMonitor && (
          <Field label="نوع المراقب" error={errors.monitorKind} hint={kind === 'primary' ? 'المراقب الأساسي تُسند له دورات المياه من زر «دورات المياه».' : 'النائب يعمل على دورات مياه المراقب الأساسي الذي ينوب عنه.'}>
            <select value={kind} onChange={(e) => setKind(e.target.value as MonitorKind)} className={INPUT} data-testid="user-kind">
              <option value="primary">مراقب أساسي</option>
              <option value="substitute">نائب</option>
            </select>
          </Field>
        )}
        {isMonitor && kind === 'substitute' && (
          <Field label="ينوب عن" error={errors.substituteForId}>
            <select value={substituteFor} onChange={(e) => setSubstituteFor(e.target.value)} className={INPUT} data-testid="user-substitute-for">
              <option value="">— اختر المراقب الأساسي —</option>
              {primaries
                .filter((p) => p.id !== editingUser?.id)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.fullName} ({p.username})
                  </option>
                ))}
            </select>
          </Field>
        )}
        {isNew && <div className="rounded-[10px] bg-[#F6F9F7] px-3 py-2 text-[12.5px] text-muted">تُنشأ كلمة مرور عشوائية قوية وتظهر لك مرة واحدة بعد الحفظ.</div>}
        {errors._ && <div className="rounded-[10px] bg-[#FCEDE7] px-3 py-2 text-[13px] text-err-ink">{errors._}</div>}
        <DialogActions busy={busy} submitLabel={isNew ? 'إنشاء الحساب' : 'حفظ'} onSubmit={submit} onClose={onClose} testId="user-save" />
      </div>
    </Modal>
  );
}

function LinkDialog({ user, data, onClose, onSaved }: { user: UserView | null; data: UsersData; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [openedFor, setOpenedFor] = useState<UserView | null>(null);
  if (user && user !== openedFor) {
    setOpenedFor(user);
    setSelected(new Set(user.restroomIds));
  } else if (!user && openedFor) {
    setOpenedFor(null);
  }

  const isMonitor = user?.role === 'contractor_monitor';
  const nameOf = new Map(data.users.map((u) => [u.id, u.fullName]));
  const rooms: PickRoom[] = data.restrooms.map((r) => ({
    ...r,
    note: isMonitor && r.monitorId && r.monitorId !== user?.id ? `حاليًا: ${nameOf.get(r.monitorId) ?? '—'}` : isMonitor && !r.monitorId ? 'بلا مراقب' : null,
  }));
  const moving = isMonitor ? data.restrooms.filter((r) => selected.has(r.id) && r.monitorId && r.monitorId !== user?.id).length : 0;

  async function save() {
    if (!user) return;
    setBusy(true);
    try {
      await api(`/api/admin/users/${user.id}/restrooms`, { method: 'PUT', body: { restroomIds: [...selected] } });
      onSaved();
    } catch (e) {
      toast.show(e instanceof ApiClientError ? e.message : 'تعذّر الحفظ.', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={Boolean(user)}
      onClose={onClose}
      title={
        isMonitor
          ? `دورات المياه المسؤول عنها: ${user?.fullName ?? ''}`
          : user?.role === 'contractor'
            ? `دورات المياه المسندة للمقاول: ${user?.fullName ?? ''}`
            : `المواقع التي يقيّمها: ${user?.fullName ?? ''}`
      }
      subtitle={
        isMonitor
          ? 'لكل دورة مياه مراقب أساسي واحد؛ اختيار دورة مسندة لغيره ينقلها إليه.'
          : user?.role === 'contractor'
            ? 'يراها المقاول في صفحته للعرض فقط.'
            : 'يمكن أن يقيّم أكثر من مشرف نفس الموقع.'
      }
      width={620}
    >
      <div className="flex flex-col gap-3" data-testid="link-dialog">
        <RestroomChecklist rooms={rooms} buildings={data.buildings} selected={selected} onChange={setSelected} />
        {moving > 0 && (
          <div className="rounded-[10px] bg-[#FBF4E1] px-3 py-2 text-[12.5px] text-[#7A5B14]">
            سيتم نقل <b className="tabular">{moving}</b> دورة مياه من مراقبين آخرين إلى هذا المراقب.
          </div>
        )}
        <DialogActions busy={busy} submitLabel="حفظ الإسناد" onSubmit={save} onClose={onClose} testId="link-save" />
      </div>
    </Modal>
  );
}

/** تغيير كلمة المرور: يكتبها الأدمن أو تُنشأ عشوائيًا */
function SetPasswordDialog({ user, onClose, onDone }: { user: UserView | null; onClose: () => void; onDone: (res: { username: string; password: string }) => void }) {
  const [mode, setMode] = useState<'random' | 'manual'>('random');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [openedFor, setOpenedFor] = useState<UserView | null>(null);
  if (user && user !== openedFor) {
    setOpenedFor(user);
    setMode('random');
    setPassword('');
    setError('');
  } else if (!user && openedFor) {
    setOpenedFor(null);
  }

  async function submit() {
    if (!user) return;
    if (mode === 'manual' && (password.length < 8 || /\s/.test(password))) {
      setError('كلمة المرور 8 أحرف على الأقل وبلا مسافات.');
      return;
    }
    setBusy(true);
    try {
      const res = await api<{ username: string; password: string }>(`/api/admin/users/${user.id}/password`, {
        method: 'POST',
        body: mode === 'manual' ? { password } : {},
      });
      onDone(res);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'تعذّر تغيير كلمة المرور.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={Boolean(user)} onClose={onClose} title={`كلمة المرور: ${user?.fullName ?? ''}`} subtitle="تتوقف كلمة المرور الحالية فور الحفظ، ويُفك أي قفل دخول." width={440}>
      <div className="flex flex-col gap-3" data-testid="set-password-dialog">
        <label className="flex items-center gap-2 text-[14px]">
          <input type="radio" name="pw-mode" checked={mode === 'random'} onChange={() => setMode('random')} className="h-4 w-4 accent-[#55957A]" />
          كلمة مرور عشوائية قوية (موصى به)
        </label>
        <label className="flex items-center gap-2 text-[14px]">
          <input type="radio" name="pw-mode" checked={mode === 'manual'} onChange={() => setMode('manual')} className="h-4 w-4 accent-[#55957A]" data-testid="pw-manual" />
          أكتب كلمة المرور بنفسي
        </label>
        {mode === 'manual' && (
          <Field label="كلمة المرور الجديدة" error={error} hint="8 أحرف على الأقل، والحروف الكبيرة والصغيرة تفرق.">
            <input dir="ltr" value={password} onChange={(e) => setPassword(e.target.value)} maxLength={72} autoComplete="new-password" className={`${INPUT} text-left`} data-testid="pw-input" />
          </Field>
        )}
        {mode === 'random' && error && <div className="text-[12.5px] text-err-ink">{error}</div>}
        <DialogActions busy={busy} submitLabel="حفظ كلمة المرور" onSubmit={submit} onClose={onClose} testId="pw-save" />
      </div>
    </Modal>
  );
}
