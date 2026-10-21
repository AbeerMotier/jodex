'use client';
import { useEffect, useMemo, useState } from 'react';
import { Card, MissingList } from '@/components/ui/card';
import { Avatar, GreenHero, InfoTile } from '@/components/ui/hero';
import { Lightbox, SuccessDialog } from '@/components/ui/overlay';
import { Skeleton, SkeletonCard } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/components/ui/toast';
import { api, ApiClientError, newIdempotencyKey } from '@/lib/client/api';
import { compressImage, isAcceptedImage } from '@/lib/client/image';
import { useServerClock } from '@/lib/client/server-clock';
import { useApi } from '@/lib/client/use-api';
import { MAX_PHOTO_BYTES, MAX_SUPERVISOR_PHOTOS, RATING_LABEL } from '@/lib/domain/catalog';
import { dayLabel, timeHM } from '@/lib/domain/format';
import type { Rating } from '@/lib/domain/scoring';
import { evaluationIssues } from '@/lib/domain/validation';
import { ContractorRoundsModal, type ContractorRoundsData } from './contractor-rounds-modal';

interface SitesData {
  serverNow: string;
  today: string;
  supervisor: { id: string; name: string };
  items: { id: string; title: string; description: string | null; category?: string | null }[];
  sites: { id: string; code: string; name: string; floor: string; building: string; lastSubmittedAt: string | null }[];
}

interface Evaluation {
  evaluationId: string;
  viewed: boolean;
  photos: { id: string; url: string | null }[];
}

interface EvalForm {
  ratings: Record<string, number>;
  matchesRound: 'yes' | 'no' | null;
  needsUrgent: 'yes' | 'no' | null;
  note: string;
}

const EMPTY_FORM: EvalForm = { ratings: {}, matchesRound: null, needsUrgent: null, note: '' };
const formKey = (userId: string, evalId: string) => `jodex:eval:${userId}:${evalId}`;

function loadForm(userId: string, evalId: string): EvalForm {
  try {
    const raw = localStorage.getItem(formKey(userId, evalId));
    return raw ? { ...EMPTY_FORM, ...(JSON.parse(raw) as EvalForm) } : EMPTY_FORM;
  } catch {
    return EMPTY_FORM;
  }
}

export function SupervisorApp({ userId, initialSiteId = null }: { userId: string; initialSiteId?: string | null }) {
  const toast = useToast();
  const { data, error, loading, reload } = useApi<SitesData>('/api/supervisor/sites');
  const now = useServerClock(data?.serverNow, 15_000);
  const [siteId, setSiteId] = useState<string | null>(null);
  /** رقم بدء التقييم: يزيد بعد كل إرسال لبدء تقييم جديد للموقع نفسه */
  const [evalNonce, setEvalNonce] = useState(0);
  const [evaluation, setEvaluation] = useState<(Evaluation & { siteId: string; nonce: number }) | null>(null);
  const [form, setForm] = useState<EvalForm>(EMPTY_FORM);
  const [roundsOpen, setRoundsOpen] = useState(false);
  const [roundsResult, setRounds] = useState<{ evaluationId: string; data: ContractorRoundsData } | null>(null);
  const [roundsLoading, setRoundsLoading] = useState(false);
  const [roundsError, setRoundsError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [idemKey, setIdemKey] = useState<string>(() => newIdempotencyKey());
  const [success, setSuccess] = useState<{ title: string; sub: string; meta: string } | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);

  // الموقع المراد تقييمه محدد ولا يُختار من القائمة: موقع رمز QR الممسوح، أو الموقع الوحيد المسند للمشرف
  // (يُعاد التحديد عند مسح رمز جديد في الصفحة نفسها)
  const [resolvedFor, setResolvedFor] = useState<string | null | undefined>(undefined);
  if (data && resolvedFor !== initialSiteId) {
    setResolvedFor(initialSiteId);
    const scanned = initialSiteId ? data.sites.find((s) => s.id === initialSiteId) : undefined;
    if (initialSiteId && !scanned) toast.show('دورة المياه التي مسحت رمزها ليست ضمن المواقع المسندة إليك.', 'error');
    const pick = scanned ?? (data.sites.length === 1 ? data.sites[0] : undefined);
    if (pick) setSiteId(pick.id);
  }

  // بدء (أو استئناف) تقييم الموقع المحدد على الخادم (يتحقق الخادم أنه مسند للمشرف)
  useEffect(() => {
    if (!siteId) return;
    let cancelled = false;
    api<Evaluation>('/api/supervisor/evaluations/start', { body: { restroomId: siteId } })
      .then((res) => {
        if (cancelled) return;
        setEvaluation({ ...res, siteId, nonce: evalNonce });
        setForm(loadForm(userId, res.evaluationId));
        setIdemKey(newIdempotencyKey());
      })
      .catch((e) => {
        if (!cancelled) toast.show((e as ApiClientError).message, 'error');
      });
    return () => {
      cancelled = true;
    };
  }, [siteId, evalNonce, toast, userId]);

  const evalLoading = siteId !== null && (evaluation?.siteId !== siteId || evaluation?.nonce !== evalNonce);
  const rounds = roundsResult && evaluation && roundsResult.evaluationId === evaluation.evaluationId ? roundsResult.data : null;

  function update(patch: Partial<EvalForm>) {
    setForm((f) => {
      const next = { ...f, ...patch };
      if (evaluation) {
        try {
          localStorage.setItem(formKey(userId, evaluation.evaluationId), JSON.stringify(next));
        } catch {
          /* تجاهل */
        }
      }
      return next;
    });
  }

  async function openRounds() {
    if (!siteId || !evaluation) return;
    setRoundsOpen(true);
    setRoundsLoading(true);
    setRoundsError(null);
    try {
      const res = await api<ContractorRoundsData & { viewedAt: string | null }>(
        `/api/supervisor/sites/${siteId}/contractor-rounds?evaluationId=${evaluation.evaluationId}`,
      );
      setRounds({ evaluationId: evaluation.evaluationId, data: res });
      setEvaluation((ev) => (ev ? { ...ev, viewed: true } : ev));
    } catch (e) {
      setRoundsError((e as ApiClientError).message);
    } finally {
      setRoundsLoading(false);
    }
  }

  async function addPhotos(files: FileList | null) {
    if (!files || !evaluation) return;
    const list = Array.from(files);
    const room = MAX_SUPERVISOR_PHOTOS - evaluation.photos.length;
    if (list.length > room) toast.show(`الحد الأقصى ${MAX_SUPERVISOR_PHOTOS} صور للتقييم الواحد.`, 'error');
    for (const file of list.slice(0, Math.max(0, room))) {
      if (!isAcceptedImage(file)) {
        toast.show('نوع الملف غير مسموح. الأنواع المسموحة: JPEG وPNG وWebP وHEIC.', 'error');
        continue;
      }
      setUploading((n) => n + 1);
      try {
        const blob = await compressImage(file);
        if (blob.size > MAX_PHOTO_BYTES) throw new ApiClientError(413, 'too_large', 'حجم الصورة يتجاوز الحد المسموح (10 ميجابايت).');
        const fd = new FormData();
        fd.append('file', blob, blob === file ? file.name : 'photo.jpg');
        const res = await api<{ id: string; url: string | null }>(`/api/supervisor/evaluations/${evaluation.evaluationId}/photos`, { form: fd });
        setEvaluation((ev) => (ev ? { ...ev, photos: [...ev.photos, res] } : ev));
      } catch (e) {
        toast.show(`${(e as ApiClientError).message} — أعد رفع الصورة.`, 'error');
      } finally {
        setUploading((n) => n - 1);
      }
    }
  }

  async function removePhoto(photoId: string) {
    if (!evaluation) return;
    try {
      await api(`/api/supervisor/evaluations/${evaluation.evaluationId}/photos/${photoId}`, { method: 'DELETE' });
      setEvaluation((ev) => (ev ? { ...ev, photos: ev.photos.filter((p) => p.id !== photoId) } : ev));
    } catch (e) {
      toast.show((e as ApiClientError).message, 'error');
    }
  }

  const items = useMemo(() => data?.items ?? [], [data]);
  const issues = useMemo(
    () =>
      evaluationIssues({
        items,
        ratings: form.ratings,
        viewed: Boolean(evaluation?.viewed),
        matchesRound: form.matchesRound,
        needsUrgent: form.needsUrgent,
        note: form.note,
      }),
    [items, form, evaluation],
  );
  const site = data?.sites.find((s) => s.id === siteId) ?? null;

  async function submit() {
    if (!evaluation || !site || submitting) return;
    if (issues.total > 0) {
      toast.show(
        issues.missingRatings.length
          ? 'قيّم جميع البنود قبل الإرسال'
          : issues.missingMatch || issues.missingUrgent
            ? 'أجب عن سؤالي التحقق قبل الإرسال'
            : 'اكتب ملاحظة توضيحية للتقييم المنخفض',
        'error',
      );
      return;
    }
    setSubmitting(true);
    try {
      const res = await api<{ submittedAt: string; restroom: { name: string; floor: string } }>('/api/supervisor/evaluations', {
        body: {
          evaluationId: evaluation.evaluationId,
          ratings: form.ratings,
          matchesRound: form.matchesRound,
          needsUrgent: form.needsUrgent,
          note: form.note,
          idempotencyKey: idemKey,
        },
      });
      try {
        localStorage.removeItem(formKey(userId, evaluation.evaluationId));
      } catch {
        /* تجاهل */
      }
      setSuccess({
        title: 'تم حفظ تقييم الموقع',
        sub: `حُفظ تقييمك لـ${res.restroom.name} (${res.restroom.floor}) بشكل مستقل عن جولة المقاول.`,
        meta: `وقت التقييم ${timeHM(res.submittedAt)}`,
      });
      setForm(EMPTY_FORM);
      reload();
      setEvalNonce((n) => n + 1);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      const err = e as ApiClientError;
      toast.show(err.message, 'error');
      if (err.code === 'contractor_rounds_not_viewed') setEvaluation((ev) => (ev ? { ...ev, viewed: false } : ev));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading && !data) {
    return (
      <main className="mx-auto flex max-w-[800px] flex-col gap-4 px-4 pt-6 pb-20" aria-busy="true">
        <Skeleton className="h-[270px] rounded-[24px]" />
        <SkeletonCard lines={6} />
      </main>
    );
  }
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

  if (data.sites.length === 0) {
    return (
      <main className="mx-auto max-w-[800px] px-4 pt-6 pb-20">
        <Card className="p-6 text-center text-[14px] text-muted">لا توجد مواقع مسندة إليك حاليًا. راجع الأدمن.</Card>
      </main>
    );
  }

  const viewed = Boolean(evaluation?.viewed);
  const lowItems = issues.lowItems;
  const rated = items.filter((i) => form.ratings[i.id]).length;
  const missing = [
    issues.missingRatings.length ? `${issues.missingRatings.length} من البنود بدون تقييم` : '',
    issues.missingMatch ? 'الإجابة عن مطابقة جولة المراقب' : '',
    issues.missingUrgent ? 'الإجابة عن الحاجة لمعالجة فورية' : '',
    issues.noteRequired ? 'ملاحظة توضيحية للتقييم المنخفض' : '',
  ].filter(Boolean);
  const yesNo = (value: 'yes' | 'no' | null, warnOn: 'yes' | 'no') =>
    (['yes', 'no'] as const).map((v) => {
      const on = value === v;
      const warn = on && v === warnOn;
      return { v, label: v === 'yes' ? 'نعم' : 'لا', bg: on ? (warn ? '#FCEDE7' : '#E6F2EA') : '#FFFFFF', c: on ? (warn ? '#B5512F' : '#3F7A62') : '#2F4F44', bd: on ? (warn ? '#E37452' : '#8EC3A6') : '#E3EAE6' };
    });

  return (
    <main className="mx-auto flex max-w-[800px] animate-[fadeIn_.35s_ease_both] flex-col gap-4 px-4 pt-6 pb-20">
      <GreenHero>
        <div className="flex flex-col gap-4 p-[22px]">
          <div className="flex items-center gap-3">
            <Avatar name={data.supervisor.name} className="border border-white/35 bg-white/[.16] text-white" />
            <div>
              <div className="text-[12.5px] font-semibold text-white">المشرف الميداني · تقييم الموقع</div>
              <div className="text-[21px] font-bold" data-testid="supervisor-name">
                {data.supervisor.name}
              </div>
            </div>
          </div>
          {site && (
            <div className="grid grid-cols-[repeat(auto-fit,minmax(130px,1fr))] gap-2">
              <InfoTile label="المبنى" value={site.building} />
              <InfoTile label="الدور" value={site.floor} />
              <InfoTile label="دورة المياه" value={site.name} />
              <InfoTile
                label="ترميز دورة المياه"
                value={
                  <span dir="ltr" className="tabular" data-testid="site-code">
                    {site.code}
                  </span>
                }
              />
              <InfoTile label="التاريخ" value={dayLabel(data.today)} />
              <InfoTile label="الوقت" value={<span className="tabular">{timeHM(now)}</span>} />
            </div>
          )}
        </div>
      </GreenHero>

      {/* الموقع يُحدد بمسح رمز دورة المياه بكاميرا الجوال (لا اختيار من قائمة)، وتفاصيله في الرأس أعلاه */}
      {!site && (
        <Card className="p-[18px] text-[14px] leading-[1.8] text-ink-2" data-testid="scan-prompt">
          امسح رمز QR الملصق على دورة المياه بكاميرا الجوال لفتح تقييمها.
        </Card>
      )}

      {!siteId ? null : evalLoading || !evaluation ? (
        <SkeletonCard lines={6} />
      ) : (
        <>
          <Card className="px-[18px] pt-1.5 pb-2">
            <div className="flex items-center justify-between pt-3.5 pb-2.5">
              <h2 className="m-0 text-[17px] font-bold">بنود التقييم</h2>
              <span className="text-[13px] whitespace-nowrap text-muted" data-testid="ratings-progress">
                {rated} من {items.length}
              </span>
            </div>
            {items.map((item, index) => (
              <div key={item.id}>
                {item.category && item.category !== items[index - 1]?.category && (
                  <div className="-mx-[18px] border-t border-divider bg-[#F6F9F7] px-[18px] py-2 text-[13.5px] font-bold text-ink-2" data-testid="rate-category">
                    {item.category}
                  </div>
                )}
                <div className="border-t border-divider py-3.5" data-testid={`rate-item-${item.id}`}>
                  <div className="mb-2.5 text-[15px] font-semibold">{item.title}</div>
                  <div className="grid grid-cols-5 gap-1.5" role="radiogroup" aria-label={item.title}>
                    {([1, 2, 3, 4, 5] as Rating[]).map((v) => {
                      const on = form.ratings[item.id] === v;
                      // ضعيف/غير مرضي أحمر، «جيد» أصفر فاتح، جيد جدًا/ممتاز أخضر
                      const tone = v <= 2 ? { bg: '#FCEDE7', c: '#B5512F', bd: '#E37452' } : v === 3 ? { bg: '#FDF6DC', c: '#94711C', bd: '#E9CF7A' } : { bg: '#E6F2EA', c: '#3F7A62', bd: '#8EC3A6' };
                      return (
                        <button
                          key={v}
                          type="button"
                          role="radio"
                          aria-checked={on}
                          data-rating={v}
                          onClick={() => update({ ratings: { ...form.ratings, [item.id]: v } })}
                          className="flex min-h-[52px] flex-col items-center justify-center gap-px rounded-[11px] border px-0.5 py-1 transition-[background-color,transform] duration-150 hover:-translate-y-px"
                          style={{
                            background: on ? tone.bg : '#FFFFFF',
                            color: on ? tone.c : '#2F4F44',
                            borderColor: on ? tone.bd : '#E3EAE6',
                          }}
                        >
                          <span className="text-[12.5px] font-semibold">{RATING_LABEL[v]}</span>
                          <span className="tabular text-[12px] opacity-80">{v}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            ))}
          </Card>

          {lowItems.length > 0 && (
            <div className="animate-fade-up rounded-[12px] bg-err-bg px-3.5 py-3 text-[13.5px] leading-[1.7] text-err-ink" role="alert" data-testid="low-warning">
              اخترت «ضعيف» أو «غير مرضي» في: {lowItems.map((i) => i.title).join('، ')}. يرجى كتابة ملاحظة توضيحية قبل الإرسال.
            </div>
          )}

          <Card className="px-[18px] pt-1.5 pb-2">
            <div className="flex flex-col gap-2.5 py-3.5">
              <div className="text-[15px] leading-[1.6] font-semibold">
                هل جولة المراقب المسجّلة مطابقة للواقع؟{' '}
                <button
                  type="button"
                  onClick={openRounds}
                  data-testid="open-verification"
                  className="border-0 bg-transparent p-0 text-[14px] font-bold text-ok-ink underline decoration-mint-1 underline-offset-4 hover:text-ink"
                >
                  (تحقق رقابي)
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {yesNo(form.matchesRound, 'no').map((o) => (
                  <button
                    key={o.v}
                    type="button"
                    aria-disabled={!viewed}
                    data-testid={`match-${o.v}`}
                    onClick={() => (viewed ? update({ matchesRound: o.v }) : toast.show('اضغط «تحقق رقابي» لمراجعة جولة المراقب أولًا', 'error'))}
                    className="min-h-12 rounded-[11px] border text-[15px] font-semibold transition-[background-color,opacity] duration-150"
                    style={
                      viewed
                        ? { background: o.bg, color: o.c, borderColor: o.bd, cursor: 'pointer' }
                        : { background: '#F6F9F7', color: '#A9BBB2', borderColor: '#E3EAE6', opacity: 0.7, cursor: 'not-allowed' }
                    }
                  >
                    {o.label}
                  </button>
                ))}
              </div>
              {!viewed && <div className="text-[12.5px] text-muted">اضغط «تحقق رقابي» لمراجعة جولة المراقب قبل الإجابة.</div>}
            </div>
            <div className="flex flex-col gap-2.5 border-t border-divider py-3.5">
              <div className="text-[15px] font-semibold">هل يحتاج الموقع معالجة فورية؟</div>
              <div className="grid grid-cols-2 gap-2">
                {yesNo(form.needsUrgent, 'yes').map((o) => (
                  <button
                    key={o.v}
                    type="button"
                    data-testid={`urgent-${o.v}`}
                    onClick={() => update({ needsUrgent: o.v })}
                    className="min-h-12 rounded-[11px] border text-[15px] font-semibold transition-[background-color,transform] duration-150 hover:-translate-y-px"
                    style={{ background: o.bg, color: o.c, borderColor: o.bd }}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          </Card>

          <Card className="flex flex-col gap-3 p-[18px]">
            <label htmlFor="sup-note" className="text-[17px] font-bold">
              ملاحظات المشرف الميداني{' '}
              <span className="text-[13px] font-normal text-muted">{lowItems.length ? '(مطلوبة لوجود تقييم منخفض)' : '(اختياري)'}</span>
            </label>
            <textarea
              id="sup-note"
              value={form.note}
              maxLength={2000}
              onChange={(e) => update({ note: e.target.value })}
              rows={3}
              placeholder="صف ما شاهدته في الموقع"
              aria-invalid={issues.noteRequired}
              className="w-full resize-y rounded-[11px] border px-3 py-2.5 text-[14px] outline-ink"
              style={{ borderColor: issues.noteRequired ? '#E37452' : '#E3EAE6' }}
            />
            <div className="flex flex-wrap items-center gap-2.5">
              {evaluation.photos.map((p) => (
                <div key={p.id} className="relative h-[72px] w-24 animate-pop overflow-hidden rounded-[10px] border border-line">
                  <button type="button" onClick={() => p.url && setLightbox(p.url)} className="h-full w-full cursor-zoom-in bg-cover bg-center" style={{ backgroundImage: p.url ? `url("${p.url}")` : undefined }} aria-label="عرض الصورة" />
                  <button
                    type="button"
                    onClick={() => removePhoto(p.id)}
                    aria-label="حذف الصورة"
                    className="absolute top-1 left-1 h-[22px] w-[22px] rounded-full bg-[rgba(47,79,68,.8)] p-0 text-[13px] leading-[22px] text-white"
                  >
                    ×
                  </button>
                </div>
              ))}
              {uploading > 0 && (
                <span className="flex h-[72px] w-24 items-center justify-center rounded-[10px] border border-line bg-[#F6F9F7]">
                  <Spinner />
                </span>
              )}
              {evaluation.photos.length < MAX_SUPERVISOR_PHOTOS && (
                <label className="touch-target inline-flex cursor-pointer items-center gap-2 rounded-[11px] border border-dashed border-[#8FB8A2] px-3.5 py-2.5 text-[13.5px] font-semibold text-ink hover:bg-mint-5">
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
                    multiple
                    className="hidden"
                    data-testid="sup-photo-input"
                    onChange={(e) => {
                      const files = e.target.files;
                      addPhotos(files);
                      e.target.value = '';
                    }}
                  />
                  + إرفاق صور عند الحاجة
                </label>
              )}
            </div>
          </Card>

          <div className="flex flex-col gap-2.5">
            <MissingList items={missing} />
            <button
              type="button"
              onClick={submit}
              disabled={submitting}
              aria-disabled={missing.length > 0}
              data-testid="submit-evaluation"
              className="flex items-center justify-center gap-2 rounded-[13px] p-[15px] text-[16px] font-semibold text-white transition-[transform,box-shadow,background-color] duration-200 hover:-translate-y-px hover:shadow-[0_6px_16px_rgba(47,79,68,.2)]"
              style={{ background: missing.length > 0 ? '#A9BBB2' : '#55957A' }}
            >
              {submitting && <Spinner />}
              إرسال تقييم الموقع
            </button>
            <div className="text-center text-[12.5px] text-muted" data-testid="last-evaluation">
              {site?.lastSubmittedAt ? `آخر تقييم أرسلته اليوم الساعة ${timeHM(site.lastSubmittedAt)}` : 'لم ترسل تقييمًا لهذا الموقع اليوم'}
            </div>
          </div>
        </>
      )}

      <ContractorRoundsModal open={roundsOpen} onClose={() => setRoundsOpen(false)} data={rounds} loading={roundsLoading} error={roundsError} />
      <SuccessDialog open={Boolean(success)} title={success?.title ?? ''} sub={success?.sub ?? ''} meta={success?.meta} onClose={() => setSuccess(null)} />
      <Lightbox src={lightbox} onClose={() => setLightbox(null)} alt="صورة المشرف" />
    </main>
  );
}

