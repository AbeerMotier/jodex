'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card, MissingList } from '@/components/ui/card';
import { Chip, TONE_COLORS } from '@/components/ui/chip';
import { Avatar, GreenHero, InfoTile } from '@/components/ui/hero';
import { Lightbox, SuccessDialog } from '@/components/ui/overlay';
import { Skeleton, SkeletonCard } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/components/ui/toast';
import { api, ApiClientError, newIdempotencyKey } from '@/lib/client/api';
import { clearLocalDraft, readLocalDraft, writeLocalDraft } from '@/lib/client/drafts';
import { compressImage, isAcceptedImage } from '@/lib/client/image';
import { useServerClock } from '@/lib/client/server-clock';
import { useApi } from '@/lib/client/use-api';
import { ANSWER_LABEL, MAX_PHOTO_BYTES, WEEKDAY_LABEL, type PhotoSlot, type Tone } from '@/lib/domain/catalog';
import { dayLabel, timeHM } from '@/lib/domain/format';
import type { Answer } from '@/lib/domain/scoring';
import { shiftWindowState, type Shift } from '@/lib/domain/schedule';
import { riyadhMinuteOfDay } from '@/lib/domain/time';
import { roundSubmissionIssues } from '@/lib/domain/validation';
import { CameraCapture } from './camera-capture';

interface RoundView {
  id: string;
  shift: Shift;
  label: string;
  status: 'pending' | 'submitted' | 'missed';
  display: string;
  displayLabel: string;
  tone: Tone;
  bar: number;
  plan: { start: string; fullUntil: string; nonFrom: string; deadline: string; hasLateBand?: boolean };
  complianceLevel: string | null;
  submittedAt: string | null;
  executedBy: string | null;
  onBehalfOf: string | null;
  photos: { slot: PhotoSlot; url: string | null; size: number }[];
  draft: { answers: Record<string, Answer>; note: string; updatedAt: string } | null;
}

interface RoomSummary {
  id: string;
  code: string;
  name: string;
  floor: string;
  building: string;
  badge: { state: string; label: string; tone: Tone };
  submitted: number;
  total: number;
}

interface TodayData {
  serverNow: string;
  today: string;
  minute: number;
  user: { id: string; name: string; isSubstitute: boolean };
  onBehalfOf: string | null;
  restroom: { id: string; name: string; code: string; floor: string; building: string };
  restrooms: RoomSummary[];
  notice?: string | null;
  badge: { state: string; label: string; tone: Tone };
  defaultShift: Shift;
  deep: { required: boolean; weekday: number };
  items: { contractor: { id: string; title: string; description: string | null }[]; deep: { id: string; title: string; description: string | null }[] };
  photoSlots: { slot: PhotoSlot; label: string; required: boolean; cameraOnly?: boolean }[];
  rounds: RoundView[];
}

interface FormState {
  answers: Record<string, Answer>;
  note: string;
  updatedAt: string;
}

type SaveState = 'idle' | 'saving' | 'saved' | 'offline' | 'error';
interface SlotState {
  status: 'idle' | 'uploading' | 'error' | 'deleting';
  preview?: string;
  message?: string;
  file?: File | Blob;
  source?: 'camera';
}

const BAR_COLOR: Record<string, string> = {
  full: '#55957A',
  behind: '#E3C068',
  late: '#E3C068',
  non: '#E37452',
  missed: '#E37452',
};

const OPTION_STYLE: Record<Answer, { bg: string; bd: string; c: string }> = {
  done: { bg: '#E6F2EA', bd: '#55957A', c: '#3F7A62' },
  partial: { bg: '#FBF4E1', bd: '#E3C068', c: '#94711C' },
  not_done: { bg: '#FCEDE7', bd: '#E37452', c: '#B5512F' },
};
const OPTIONS: Answer[] = ['done', 'partial', 'not_done'];

export function MonitorApp({ userId, initialRestroomId = null }: { userId: string; initialRestroomId?: string | null }) {
  const toast = useToast();
  // دورة المياه المختارة (المراقب قد يكون مسؤولًا عن مبنى كامل)
  const [roomId, setRoomId] = useState<string | null>(initialRestroomId);
  const { data, error, loading, reload } = useApi<TodayData>(
    roomId ? `/api/monitor/today?restroom=${encodeURIComponent(roomId)}` : '/api/monitor/today',
  );
  const now = useServerClock(data?.serverNow, 15_000);
  const [chosenShift, setShift] = useState<Shift | null>(null);
  const [forms, setForms] = useState<Record<string, FormState>>({});
  const [saveState, setSaveState] = useState<Record<string, SaveState>>({});
  const [slots, setSlots] = useState<Record<string, SlotState>>({});
  const [photoOverride, setPhotoOverride] = useState<Record<string, { url: string | null } | null>>({});
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<{ title: string; sub: string; meta: string } | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  /** خانة الصورة المفتوحة في نافذة الكاميرا (العمالة: التقاط مباشر فقط) */
  const [cameraSlot, setCameraSlot] = useState<{ slot: PhotoSlot; label: string } | null>(null);
  const idemKeys = useRef<Record<string, string>>({});
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // رمز QR ممسوح لدورة مياه خارج نطاق المراقب: تنبيه مرة واحدة
  const [noticeShown, setNoticeShown] = useState(false);
  if (data?.notice && !noticeShown) {
    setNoticeShown(true);
    toast.show(data.notice, 'error');
  }

  // الجولة المعروضة افتراضيًا: تُثبَّت عند أول تحميل لكل دورة مياه (ولا تقفز أثناء التعبئة عند التحديث الدوري)
  const [shiftRoom, setShiftRoom] = useState<string | null>(null);
  if (data && data.restroom.id !== shiftRoom) {
    setShiftRoom(data.restroom.id);
    setShift(data.defaultShift);
  }
  const shift = chosenShift ?? data?.defaultShift ?? null;

  // تهيئة النماذج من المسودة (الخادم أو النسخة المحلية الأحدث) عند وصول بيانات جديدة
  const [formsSyncedFrom, setFormsSyncedFrom] = useState<TodayData | null>(null);
  if (data && data !== formsSyncedFrom) {
    setFormsSyncedFrom(data);
    const valid = new Set([...data.items.contractor, ...data.items.deep].map((i) => i.id));
    setForms((cur) => {
      const next = { ...cur };
      for (const r of data.rounds) {
        if (r.status !== 'pending' || next[r.id]) continue;
        const local = readLocalDraft(userId, r.id);
        const server = r.draft;
        const pick = local && (!server || local.updatedAt > server.updatedAt) ? local : server;
        const answers = Object.fromEntries(Object.entries(pick?.answers ?? {}).filter(([id]) => valid.has(id))) as Record<string, Answer>;
        next[r.id] = { answers, note: pick?.note ?? '', updatedAt: pick?.updatedAt ?? '' };
      }
      return next;
    });
  }

  // المسودات المحلية للجولات المغلقة (مرسلة/فائتة) لم تعد لازمة
  useEffect(() => {
    if (!data) return;
    for (const r of data.rounds) if (r.status !== 'pending') clearLocalDraft(userId, r.id);
  }, [data, userId]);

  // تحديث دوري للحالات (الانتقال من «لم تكتمل» إلى «متأخرة»…)
  useEffect(() => {
    const t = setInterval(() => reload(), 60_000);
    const onOnline = () => reload();
    window.addEventListener('online', onOnline);
    return () => {
      clearInterval(t);
      window.removeEventListener('online', onOnline);
    };
  }, [reload]);

  const round = data?.rounds.find((r) => r.shift === shift) ?? null;
  const form = round ? forms[round.id] : undefined;

  const persistDraft = useCallback(
    (roundId: string, state: FormState) => {
      writeLocalDraft(userId, roundId, state);
      if (saveTimers.current[roundId]) clearTimeout(saveTimers.current[roundId]);
      saveTimers.current[roundId] = setTimeout(async () => {
        setSaveState((s) => ({ ...s, [roundId]: 'saving' }));
        try {
          await api(`/api/monitor/rounds/${roundId}/draft`, { method: 'PUT', body: { answers: state.answers, note: state.note } });
          setSaveState((s) => ({ ...s, [roundId]: 'saved' }));
        } catch (e) {
          const err = e as ApiClientError;
          setSaveState((s) => ({ ...s, [roundId]: err.isNetwork ? 'offline' : 'error' }));
          if (err.status === 409) reload();
        }
      }, 800);
    },
    [userId, reload],
  );

  function updateForm(patch: Partial<FormState>) {
    if (!round || !form) return;
    const next = { ...form, ...patch, updatedAt: new Date().toISOString() };
    setForms((f) => ({ ...f, [round.id]: next }));
    persistDraft(round.id, next);
  }

  const photosFor = useCallback(
    (r: RoundView) => {
      const map: Partial<Record<PhotoSlot, { url: string | null }>> = {};
      for (const p of r.photos) map[p.slot] = { url: p.url };
      for (const [k, v] of Object.entries(photoOverride)) {
        const [rid, slot] = k.split(':');
        if (rid !== r.id) continue;
        if (v === null) delete map[slot as PhotoSlot];
        else map[slot as PhotoSlot] = v;
      }
      return map;
    },
    [photoOverride],
  );

  const issues = useMemo(() => {
    if (!data || !round || !form) return null;
    const photos = photosFor(round);
    return roundSubmissionIssues({
      contractorItems: data.items.contractor,
      deepItems: data.items.deep,
      deepRequired: data.deep.required,
      answers: form.answers,
      photos: Object.keys(photos) as PhotoSlot[],
    });
  }, [data, round, form, photosFor]);

  async function uploadPhoto(slot: PhotoSlot, file: File | Blob, source?: 'camera') {
    if (!round) return;
    const key = `${round.id}:${slot}`;
    if (!source && (!(file instanceof File) || !isAcceptedImage(file))) {
      setSlots((s) => ({ ...s, [key]: { status: 'error', message: 'نوع الملف غير مسموح. الأنواع المسموحة: JPEG وPNG وWebP وHEIC.' } }));
      return;
    }
    const preview = URL.createObjectURL(file);
    setSlots((s) => ({ ...s, [key]: { status: 'uploading', preview, file, source } }));
    try {
      // الصورة الملتقطة من الكاميرا مضغوطة مسبقًا (JPEG من البث الحي)
      const blob = source === 'camera' || !(file instanceof File) ? file : await compressImage(file);
      if (blob.size > MAX_PHOTO_BYTES) throw new ApiClientError(413, 'too_large', 'حجم الصورة يتجاوز الحد المسموح (10 ميجابايت).');
      const fd = new FormData();
      fd.append('file', blob, file instanceof File && blob === file ? file.name : 'photo.jpg');
      if (source) fd.append('source', source);
      const res = await api<{ slot: PhotoSlot; url: string | null }>(`/api/monitor/rounds/${round.id}/photos/${slot}`, { form: fd });
      setPhotoOverride((o) => ({ ...o, [key]: { url: res.url ?? preview } }));
      setSlots((s) => ({ ...s, [key]: { status: 'idle' } }));
    } catch (e) {
      const err = e as ApiClientError;
      setSlots((s) => ({ ...s, [key]: { status: 'error', message: err.message, file, source } }));
      if (err.status === 409) reload();
    }
  }

  async function deletePhoto(slot: PhotoSlot) {
    if (!round) return;
    const key = `${round.id}:${slot}`;
    setSlots((s) => ({ ...s, [key]: { status: 'deleting' } }));
    try {
      await api(`/api/monitor/rounds/${round.id}/photos/${slot}`, { method: 'DELETE' });
      setPhotoOverride((o) => ({ ...o, [key]: null }));
      setSlots((s) => ({ ...s, [key]: { status: 'idle' } }));
    } catch (e) {
      const err = e as ApiClientError;
      setSlots((s) => ({ ...s, [key]: { status: 'idle' } }));
      toast.show(err.message, 'error');
    }
  }

  async function submit() {
    if (!round || !form || !issues || submitting) return;
    if (issues.total > 0) {
      toast.show('أكمل البنود والصور الإلزامية قبل الإرسال', 'error');
      return;
    }
    setSubmitting(true);
    const idempotencyKey = (idemKeys.current[round.id] ??= newIdempotencyKey());
    try {
      const res = await api<{
        label: string;
        complianceLabel: string;
        submittedAt: string;
        onBehalfOf: string | null;
      }>(`/api/monitor/rounds/${round.id}/submit`, { body: { answers: form.answers, note: form.note, idempotencyKey } });
      clearLocalDraft(userId, round.id);
      setSuccess({
        title: `تم إرسال ${res.label}`,
        sub: `حالة الالتزام بالخطة: «${res.complianceLabel}»${res.onBehalfOf ? ` وسُجّلت باسمك بالنيابة عن ${res.onBehalfOf}` : ''}.`,
        meta: `وقت الإرسال ${timeHM(res.submittedAt)}`,
      });
      window.scrollTo({ top: 0, behavior: 'smooth' });
      reload();
    } catch (e) {
      const err = e as ApiClientError;
      toast.show(err.message, 'error');
      if (err.status === 409) reload();
    } finally {
      setSubmitting(false);
    }
  }

  if (loading && !data) return <MonitorSkeleton />;
  if (error && !data) {
    return (
      <main className="mx-auto max-w-[800px] px-4 pt-6 pb-20">
        <Card className="p-6 text-center" role="alert">
          <div className="text-[16px] font-bold text-err-ink">{error.message}</div>
          <button type="button" onClick={reload} className="touch-target mt-4 rounded-[11px] bg-ink px-5 py-2.5 text-[14px] font-semibold text-white">
            إعادة المحاولة
          </button>
        </Card>
      </main>
    );
  }
  if (!data) return null;

  const deepDayName = WEEKDAY_LABEL[data.deep.weekday];
  // نافذة الجولة المعروضة الآن بتوقيت الرياض (الخادم يرفض أي عمل خارجها أيضًا)
  const windowState = round ? shiftWindowState(round.shift, riyadhMinuteOfDay(now)) : 'open';
  const photos = round ? photosFor(round) : {};
  const requiredSlots = data.photoSlots.filter((s) => s.required);
  const uploadedRequired = requiredSlots.filter((s) => photos[s.slot]).length;
  const answeredMain = form ? data.items.contractor.filter((i) => form.answers[i.id]).length : 0;
  const missingMessages = issues
    ? [
        issues.missingItems.length ? `${issues.missingItems.length} من بنود الجولة بدون إجابة` : '',
        issues.missingDeep.length ? `${issues.missingDeep.length} من بنود التنظيف العميق (إلزامي اليوم)` : '',
        issues.missingPhotos.length ? `${issues.missingPhotos.length} من الصور الإلزامية لم تُرفع` : '',
      ].filter(Boolean)
    : [];
  const save = round ? saveState[round.id] : undefined;

  return (
    <main className="mx-auto flex max-w-[800px] animate-fade-up flex-col gap-4 px-4 pt-6 pb-20">
      <GreenHero>
        <div className="flex flex-col gap-4 p-[22px]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Avatar name={data.user.name} className="border border-white/35 bg-white/[.16] text-white" />
              <div>
                <div className="text-[12.5px] font-semibold text-white">مراقب المقاول · جولة اليوم</div>
                <div className="text-[21px] font-bold" data-testid="monitor-name">
                  {data.user.name}
                </div>
              </div>
            </div>
            <Chip tone={data.badge.tone === 'neutral' ? 'neutral' : data.badge.tone} size="lg" dot data-testid="commit-badge">
              {data.badge.label}
            </Chip>
          </div>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(130px,1fr))] gap-2">
            <InfoTile label="المبنى" value={data.restroom.building} />
            <InfoTile label="الدور" value={data.restroom.floor} />
            <InfoTile label="دورة المياه" value={data.restroom.name} />
            <InfoTile label="الترميز" value={<span dir="ltr" className="tabular">{data.restroom.code}</span>} />
            <InfoTile label="التاريخ" value={dayLabel(data.today)} />
            <InfoTile label="الوقت" value={<span className="tabular">{timeHM(now)}</span>} />
          </div>
          {data.onBehalfOf && (
            <div className="rounded-[10px] border border-white/[.22] bg-white/[.14] px-3 py-2.5 text-[13.5px] leading-[1.6]" data-testid="behalf-banner">
              تنفّذ هذه الجولة بالنيابة عن الموظف الأساسي <b>{data.onBehalfOf}</b>، وسيُسجَّل اسمك منفّذًا فعليًا.
            </div>
          )}
        </div>
      </GreenHero>

      {data.restrooms.length > 1 && (
        <RoomPicker rooms={data.restrooms} selectedId={data.restroom.id} busy={loading} onSelect={setRoomId} />
      )}

      <div className="grid grid-cols-2 gap-3">
        {data.rounds.map((r) => {
          const on = r.shift === shift;
          return (
            <button
              key={r.id}
              type="button"
              onClick={() => setShift(r.shift)}
              aria-pressed={on}
              data-testid={`shift-${r.shift}`}
              className="flex cursor-pointer flex-col gap-2 rounded-[16px] border border-line bg-white px-4 py-3.5 text-right transition-shadow"
              style={{ boxShadow: on ? '0 0 0 2px #2F4F44' : 'none' }}
            >
              <span className="flex w-full items-center justify-between gap-2">
                <span className="flex flex-col">
                  <span className="text-[15px] font-semibold">{r.label}</span>
                  <span className="tabular text-[12px] text-muted" data-testid={`shift-window-${r.shift}`}>
                    {r.plan.start}–{r.plan.deadline}
                  </span>
                </span>
                <Chip tone={r.tone} data-testid={`shift-status-${r.shift}`}>
                  {r.displayLabel}
                </Chip>
              </span>
              <span className="block h-[5px] w-full overflow-hidden rounded-[3px] bg-divider">
                <span className="block h-full rounded-[3px] transition-[width] duration-500" style={{ width: `${Math.round(r.bar)}%`, background: BAR_COLOR[r.display] ?? '#8FB8A2' }} />
              </span>
            </button>
          );
        })}
      </div>

      {round && round.status !== 'pending' && (
        <Card className="animate-pop px-[22px] py-7 text-center" data-testid="round-closed">
          <div
            className="mx-auto mb-3 flex h-[52px] w-[52px] items-center justify-center rounded-full text-[24px]"
            style={{ background: round.status === 'submitted' ? '#E6F2EA' : '#FCEDE7', color: round.status === 'submitted' ? '#3F7A62' : '#B5512F' }}
          >
            {round.status === 'submitted' ? '✓' : '!'}
          </div>
          <div className="text-[18px] font-bold">{round.status === 'submitted' ? `تم إرسال ${round.label}` : `انتهى وقت ${round.label}`}</div>
          <div className="mt-1.5 text-[14px] leading-[1.7] text-muted">
            {round.status === 'submitted'
              ? `أُرسلت الساعة ${timeHM(round.submittedAt)} بواسطة ${round.executedBy ?? '—'}${round.onBehalfOf ? ` بالنيابة عن ${round.onBehalfOf}` : ''}. حالة الالتزام: ${round.displayLabel}.`
              : `آخر موعد لإنهاء ${round.label} هو ${round.plan.deadline}، ولم تُرسل فسُجّلت «فائتة».`}
          </div>
        </Card>
      )}

      {round && round.status === 'pending' && windowState !== 'open' && (
        <Card className="animate-pop px-[22px] py-7 text-center" data-testid="round-window-closed">
          <div className="mx-auto mb-3 flex h-[52px] w-[52px] items-center justify-center rounded-full text-[24px]" style={{ background: '#FBF4E1', color: '#94711C' }}>
            ⏱
          </div>
          <div className="text-[18px] font-bold">{windowState === 'before' ? `لم يبدأ وقت ${round.label} بعد` : `انتهى وقت ${round.label}`}</div>
          <div className="mt-1.5 text-[14px] leading-[1.7] text-muted">
            {round.label} متاحة من <b className="tabular">{round.plan.start}</b> حتى <b className="tabular">{round.plan.deadline}</b> بتوقيت الرياض، ولا يمكن بدؤها أو إرسالها خارج هذا الوقت.
          </div>
        </Card>
      )}

      {/* البنود والمرفقات ظاهرة دائمًا للاطلاع خارج وقت الجولة (بلا إجابة أو تصوير) */}
      {round && round.status !== 'submitted' && (round.status === 'missed' || windowState !== 'open') && (
        <RoundPreview items={data.items.contractor} slots={data.photoSlots} />
      )}

      {round && round.status === 'pending' && windowState === 'open' && form && (
        <>
          <Card className="px-[18px] pt-1.5 pb-1">
            <div className="flex items-center justify-between pt-3.5 pb-2.5">
              <h2 className="m-0 text-[17px] font-bold">بنود الجولة</h2>
              <span className="text-[13px] whitespace-nowrap text-muted" data-testid="items-progress">
                {answeredMain} من {data.items.contractor.length}
              </span>
            </div>
            {data.items.contractor.map((item) => (
              <AnswerRow key={item.id} title={item.title} description={item.description} value={form.answers[item.id]} onChange={(a) => updateForm({ answers: { ...form.answers, [item.id]: a } })} testId={`item-${item.id}`} />
            ))}
          </Card>

          {data.items.deep.length > 0 && (
            <Card className="px-[18px] pt-1.5 pb-1" data-testid="deep-section">
              <div className="flex flex-wrap items-center justify-between gap-2 pt-3.5 pb-1">
                <h2 className="m-0 text-[17px] font-bold">التنظيف العميق</h2>
                <Chip tone={data.deep.required ? 'error' : 'success'} data-testid="deep-tag">
                  {data.deep.required ? `إلزامي اليوم (${deepDayName})` : `اختياري · إلزامي يوم ${deepDayName}`}
                </Chip>
              </div>
              {data.items.deep.map((item) => (
                <AnswerRow key={item.id} title={item.title} description={item.description} value={form.answers[item.id]} onChange={(a) => updateForm({ answers: { ...form.answers, [item.id]: a } })} testId={`deep-${item.id}`} />
              ))}
            </Card>
          )}

          <Card className="p-[18px]">
            <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2.5">
              <h2 className="m-0 text-[17px] font-bold">مرفقات الجولة</h2>
              <span className="text-[13px] whitespace-nowrap text-muted" data-testid="photos-progress">
                {uploadedRequired} من {requiredSlots.length} صور إلزامية
              </span>
            </div>
            <div className="mb-3.5 text-[13px] text-muted">كل الصور إلزامية وتُلتقط مباشرة بالكاميرا الآن (لا يُقبل رفع صورة محفوظة)، ويمكنك معاينتها أو إعادة التقاطها أو حذفها قبل الإرسال.</div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
              {data.photoSlots.map((s) => {
                const key = `${round.id}:${s.slot}`;
                const st = slots[key] ?? { status: 'idle' };
                const photo = photos[s.slot];
                const url = st.status === 'uploading' ? st.preview : photo?.url ?? undefined;
                return (
                  <PhotoTile
                    key={s.slot}
                    slot={s.slot}
                    label={s.label}
                    required={s.required}
                    cameraOnly={Boolean(s.cameraOnly)}
                    url={url ?? null}
                    has={Boolean(photo) || st.status === 'uploading'}
                    state={st}
                    onFile={(f) => uploadPhoto(s.slot, f)}
                    onCamera={() => setCameraSlot({ slot: s.slot, label: s.label })}
                    onDelete={() => deletePhoto(s.slot)}
                    onRetry={() => st.file && uploadPhoto(s.slot, st.file, st.source)}
                    onView={() => url && setLightbox(url)}
                  />
                );
              })}
            </div>
          </Card>

          <Card className="p-[18px]">
            <label htmlFor="round-note" className="mb-2 block text-[17px] font-bold">
              ملاحظات <span className="text-[13px] font-normal text-muted">(اختياري)</span>
            </label>
            <textarea
              id="round-note"
              value={form.note}
              maxLength={2000}
              onChange={(e) => updateForm({ note: e.target.value })}
              rows={3}
              placeholder="أي ملاحظة عن الجولة"
              className="w-full resize-y rounded-[11px] border border-line px-3 py-2.5 text-[14px] outline-ink"
            />
            <SaveIndicator state={save} />
          </Card>

          <div className="flex flex-col gap-2.5">
            <MissingList items={missingMessages} />
            <button
              type="button"
              onClick={submit}
              disabled={submitting}
              data-testid="submit-round"
              aria-disabled={missingMessages.length > 0}
              className="flex items-center justify-center gap-2 rounded-[13px] p-[15px] text-[16px] font-semibold text-white transition-[transform,box-shadow,background-color] duration-200 hover:-translate-y-px hover:shadow-[0_6px_16px_rgba(47,79,68,.2)]"
              style={{ background: missingMessages.length > 0 ? '#A9BBB2' : '#55957A' }}
            >
              {submitting && <Spinner />}
              إرسال {round.label}
            </button>
          </div>
        </>
      )}

      <CameraCapture
        open={Boolean(cameraSlot)}
        title={`صورة ${cameraSlot?.label ?? ''}`}
        worker={cameraSlot?.slot === 'labor'}
        onClose={() => setCameraSlot(null)}
        onCapture={(blob) => {
          const slot = cameraSlot?.slot;
          setCameraSlot(null);
          if (slot) uploadPhoto(slot, blob, 'camera');
        }}
      />
      <SuccessDialog open={Boolean(success)} title={success?.title ?? ''} sub={success?.sub ?? ''} meta={success?.meta} onClose={() => setSuccess(null)} />
      <Lightbox src={lightbox} onClose={() => setLightbox(null)} alt="صورة الجولة" />
    </main>
  );
}

/** بنود الجولة ومرفقاتها للاطلاع فقط خارج وقت الجولة */
function RoundPreview({ items, slots }: { items: { id: string; title: string; description: string | null }[]; slots: { slot: PhotoSlot; label: string; required: boolean }[] }) {
  return (
    <Card className="flex flex-col gap-3 p-[18px] opacity-90" data-testid="round-preview">
      <div className="flex items-center justify-between">
        <h2 className="m-0 text-[17px] font-bold">بنود الجولة</h2>
        <Chip tone="neutral" size="sm">
          للاطلاع
        </Chip>
      </div>
      <ul className="m-0 flex list-none flex-col p-0">
        {items.map((i) => (
          <li key={i.id} className="border-t border-divider py-2.5 text-[14.5px] font-semibold" data-testid="preview-item">
            {i.title}
            {i.description && <div className="text-[12.5px] font-normal text-muted">{i.description}</div>}
          </li>
        ))}
      </ul>
      <h2 className="m-0 mt-1 text-[17px] font-bold">مرفقات الجولة</h2>
      <div className="flex flex-wrap gap-1.5">
        {slots.map((s) => (
          <Chip key={s.slot} tone="neutral" size="sm">
            📷 {s.label} · إلزامي
          </Chip>
        ))}
      </div>
    </Card>
  );
}

function AnswerRow({
  title,
  description,
  value,
  onChange,
  testId,
}: {
  title: string;
  description: string | null;
  value: Answer | undefined;
  onChange: (a: Answer) => void;
  testId: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5 border-t border-divider py-3.5" data-testid={testId}>
      <div className="flex-[1_1_220px]">
        <div className="text-[15px] font-semibold">{title}</div>
        {description && <div className="text-[13px] text-muted">{description}</div>}
      </div>
      <div className="flex gap-1.5" role="radiogroup" aria-label={title}>
        {OPTIONS.map((o) => {
          const on = value === o;
          const st = on ? OPTION_STYLE[o] : { bg: '#FFFFFF', bd: '#E3EAE6', c: '#687D74' };
          return (
            <button
              key={o}
              type="button"
              role="radio"
              aria-checked={on}
              data-answer={o}
              onClick={() => onChange(o)}
              className="min-h-11 min-w-[74px] rounded-[11px] border px-3 text-[14px] font-semibold transition-[background-color,border-color,transform] duration-150 hover:-translate-y-px"
              style={{ background: st.bg, borderColor: st.bd, color: st.c }}
            >
              {ANSWER_LABEL[o]}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PhotoTile({
  slot,
  label,
  required,
  cameraOnly,
  url,
  has,
  state,
  onFile,
  onCamera,
  onDelete,
  onRetry,
  onView,
}: {
  slot: PhotoSlot;
  label: string;
  required: boolean;
  /** التقاط مباشر من الكاميرا فقط (بلا اختيار ملف من الجهاز) */
  cameraOnly: boolean;
  url: string | null;
  has: boolean;
  state: SlotState;
  onFile: (f: File) => void;
  onCamera: () => void;
  onDelete: () => void;
  onRetry: () => void;
  onView: () => void;
}) {
  const border = state.status === 'error' ? '#E37452' : has ? '#55957A' : required ? '#8FB8A2' : '#C8D8CF';
  const input = (
    <input
      type="file"
      accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
      className="hidden"
      data-testid={`photo-input-${slot}`}
      onChange={(e) => {
        const f = e.target.files?.[0];
        e.target.value = '';
        if (f) onFile(f);
      }}
    />
  );
  return (
    <div className="flex flex-col overflow-hidden rounded-[12px] bg-[#F6F9F7] transition-colors" style={{ border: `1.5px dashed ${border}` }} data-testid={`photo-${slot}`}>
      {has && url ? (
        <>
          <button type="button" onClick={onView} className="relative aspect-[4/3] w-full cursor-zoom-in animate-[fadeIn_.25s_ease_both] bg-cover bg-center" style={{ backgroundImage: `url("${url}")` }} aria-label={`عرض صورة ${label}`}>
            {(state.status === 'uploading' || state.status === 'deleting') && (
              <span className="absolute inset-0 flex items-center justify-center gap-2 bg-white/70 text-[12.5px] font-semibold text-ink">
                <Spinner /> {state.status === 'uploading' ? 'جارٍ الرفع…' : 'جارٍ الحذف…'}
              </span>
            )}
          </button>
          <div className="grid grid-cols-2 border-t border-line bg-white">
            {cameraOnly ? (
              <button type="button" onClick={onCamera} disabled={state.status !== 'idle'} className="border-l border-line px-1 py-[9px] text-center text-[12.5px] font-semibold text-ink" data-testid={`photo-camera-${slot}`}>
                إعادة الالتقاط
              </button>
            ) : (
              <label className="cursor-pointer border-l border-line px-1 py-[9px] text-center text-[12.5px] font-semibold text-ink">
                استبدال
                {input}
              </label>
            )}
            <button type="button" onClick={onDelete} disabled={state.status !== 'idle'} className="px-1 py-[9px] text-[12.5px] font-semibold text-err-ink">
              حذف
            </button>
          </div>
        </>
      ) : cameraOnly ? (
        <button type="button" onClick={onCamera} className="flex aspect-[4/3] cursor-pointer flex-col items-center justify-center gap-1.5 bg-transparent p-2.5 text-center hover:bg-mint-5" data-testid={`photo-camera-${slot}`}>
          <span className="flex h-[38px] w-[38px] items-center justify-center rounded-full bg-mint-3 text-[18px] text-ink" aria-hidden>
            📷
          </span>
          <span className="text-[13px] font-semibold">التقاط بالكاميرا</span>
          <span className="text-[11.5px] text-muted">لا يُقبل رفع صورة محفوظة</span>
        </button>
      ) : (
        <label className="flex aspect-[4/3] cursor-pointer flex-col items-center justify-center gap-1.5 p-2.5 text-center hover:bg-mint-5">
          {input}
          <span className="flex h-[38px] w-[38px] items-center justify-center rounded-full bg-mint-3 text-[22px] text-ink" aria-hidden>
            +
          </span>
          <span className="text-[13px] font-semibold">التقاط أو رفع</span>
        </label>
      )}
      {state.status === 'error' && (
        <div className="flex flex-col gap-1.5 border-t border-line bg-err-bg px-2.5 py-2 text-[12px] text-err-ink" role="alert">
          <span>{state.message}</span>
          {state.file && (
            <button type="button" onClick={onRetry} className="self-start font-bold underline underline-offset-2">
              إعادة الرفع
            </button>
          )}
        </div>
      )}
      <div className="flex justify-between gap-1.5 border-t border-line bg-white px-2.5 py-2 text-[12.5px]">
        <span className="font-medium">{label}</span>
        <span className="whitespace-nowrap" style={{ color: required ? '#2F4F44' : '#687D74' }}>
          {required ? 'إلزامي' : 'اختياري'}
        </span>
      </div>
    </div>
  );
}

function SaveIndicator({ state }: { state: SaveState | undefined }) {
  if (!state || state === 'idle') return null;
  const map: Record<SaveState, { t: string; c: string }> = {
    idle: { t: '', c: '' },
    saving: { t: 'جارٍ حفظ المسودة…', c: TONE_COLORS.neutral.c },
    saved: { t: 'حُفظت المسودة تلقائيًا', c: TONE_COLORS.success.c },
    offline: { t: 'لا يوجد اتصال — المسودة محفوظة على جهازك وستُرسل عند عودة الاتصال', c: TONE_COLORS.warning.c },
    error: { t: 'تعذّر حفظ المسودة على الخادم — محفوظة على جهازك', c: TONE_COLORS.error.c },
  };
  return (
    <div className="mt-2 text-[12px]" style={{ color: map[state].c }} role="status" data-testid="save-indicator">
      {map[state].t}
    </div>
  );
}

function MonitorSkeleton() {
  return (
    <main className="mx-auto flex max-w-[800px] flex-col gap-4 px-4 pt-6 pb-20" aria-busy="true" aria-label="جارٍ التحميل">
      <Skeleton className="h-[290px] rounded-[24px]" />
      <div className="grid grid-cols-2 gap-3">
        <Skeleton className="h-[86px] rounded-[16px]" />
        <Skeleton className="h-[86px] rounded-[16px]" />
      </div>
      <SkeletonCard lines={5} />
      <SkeletonCard lines={3} />
    </main>
  );
}

/** قائمة دورات المياه المسندة للمراقب مع حالة جولات اليوم لكل منها */
function RoomPicker({
  rooms,
  selectedId,
  busy,
  onSelect,
}: {
  rooms: RoomSummary[];
  selectedId: string;
  busy: boolean;
  onSelect: (id: string) => void;
}) {
  const done = rooms.filter((r) => r.total > 0 && r.submitted === r.total).length;
  return (
    <Card className="flex flex-col gap-3 p-4" data-testid="room-picker">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[15px] font-bold text-ink">دورات المياه المسندة ({rooms.length})</h2>
        <span className="flex items-center gap-2 text-[12.5px] text-muted">
          {busy && <Spinner size={14} />}
          <span className="tabular">
            مكتملة اليوم: {done} / {rooms.length}
          </span>
        </span>
      </div>
      <div className="grid max-h-[320px] grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-2 overflow-y-auto">
        {rooms.map((r) => {
          const on = r.id === selectedId;
          return (
            <button
              key={r.id}
              type="button"
              onClick={() => onSelect(r.id)}
              aria-pressed={on}
              data-testid={`room-${r.code}`}
              className="flex cursor-pointer flex-col gap-1.5 rounded-[12px] border border-line bg-white px-3 py-2.5 text-right"
              style={{ boxShadow: on ? '0 0 0 2px #2F4F44' : 'none' }}
            >
              <span className="flex w-full items-center justify-between gap-2">
                <span className="text-[13.5px] font-semibold text-ink">{r.name}</span>
                <span className="tabular text-[12px] text-muted">
                  {r.submitted}/{r.total}
                </span>
              </span>
              <span className="text-[12px] text-muted">
                {r.floor} · {r.building}
              </span>
              <span className="flex items-center justify-between gap-2">
                <span dir="ltr" className="tabular text-[11px] text-muted">
                  {r.code}
                </span>
                <Chip tone={r.badge.tone === 'neutral' ? 'neutral' : r.badge.tone} size="xs" dot>
                  {r.badge.label}
                </Chip>
              </span>
            </button>
          );
        })}
      </div>
    </Card>
  );
}
