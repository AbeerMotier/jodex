'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Decor } from '@/components/ui/decor';
import { ErrorBox } from '@/components/ui/card';
import { Face, FACE_STYLE, ThanksBadge } from '@/components/ui/face';
import { Spinner } from '@/components/ui/spinner';
import { api, ApiClientError } from '@/lib/client/api';
import { useServerClock } from '@/lib/client/server-clock';
import {
  FEEDBACK_RATING_LABEL,
  FEEDBACK_REASONS,
  FEEDBACK_SELECTION_MESSAGE,
  type FeedbackRating,
  type FeedbackReasonKey,
} from '@/lib/domain/catalog';
import { instantDayLabel, timeHM } from '@/lib/domain/format';

const ORDER: FeedbackRating[] = ['excellent', 'good', 'bad'];

export function RateExperience({
  token,
  restroom,
  serverNow,
}: {
  token: string;
  restroom: { name: string; floor: string; building: string };
  serverNow: string;
}) {
  const now = useServerClock(serverNow, 30_000);
  const [rating, setRating] = useState<FeedbackRating | null>(null);
  const [reasons, setReasons] = useState<FeedbackReasonKey[]>([]);
  const [otherText, setOtherText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState<FeedbackRating | null>(null);

  const isBad = rating === 'bad';
  const otherSelected = reasons.includes('other');
  const ready = rating !== null && (!isBad || (reasons.length > 0 && (!otherSelected || otherText.trim().length > 0)));

  function pick(r: FeedbackRating) {
    setRating(r);
    setError('');
    if (r !== 'bad') {
      setReasons([]);
      setOtherText('');
    }
  }

  function toggleReason(key: FeedbackReasonKey) {
    setError('');
    setReasons((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]));
  }

  async function submit() {
    if (!ready || !rating || sending) return;
    setSending(true);
    setError('');
    try {
      await api(`/api/public/r/${encodeURIComponent(token)}/feedback`, {
        body: { rating, reasons: isBad ? reasons : [], otherText: isBad && otherSelected ? otherText : '' },
        noAuthRedirect: true,
      });
      setSent(rating);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'تعذّر إرسال التقييم. حاول مرة أخرى.');
    } finally {
      setSending(false);
    }
  }

  return (
    <main className="mx-auto flex max-w-[600px] animate-fade-up flex-col gap-3.5 px-4 pt-6 pb-[72px]">
      <div className="relative isolate min-h-[200px] animate-pop overflow-hidden rounded-[24px] bg-brand shadow-[0_16px_36px_rgba(47,79,68,.18)]">
        <Decor variant="hero" />
        <div className="relative z-[1] flex min-h-[200px] flex-col gap-3.5 px-[22px] py-5 text-white">
          <span className="text-[12.5px] text-white" data-testid="rate-datetime">
            {instantDayLabel(now)} · {timeHM(now)}
          </span>
          <div>
            <h1 className="m-0 text-[24px] leading-[1.3] font-bold">{restroom.name}</h1>
            <div className="mt-1 text-[14px] text-white">
              {restroom.floor} · {restroom.building}
            </div>
          </div>
        </div>
      </div>

      {sent ? (
        <section
          data-testid="thanks"
          className="relative animate-[pop_.4s_cubic-bezier(.2,.8,.3,1)_both] overflow-hidden rounded-[28px] border border-[rgba(85,149,122,.22)] bg-[rgba(85,149,122,.12)] px-[22px] pt-14 pb-12 text-center text-ink"
        >
          <span
            aria-hidden
            className="pointer-events-none absolute -top-[30%] -bottom-[30%] left-[18%] w-[34%] rotate-[28deg]"
            style={{ background: 'linear-gradient(90deg,rgba(255,255,255,0),rgba(255,255,255,.45),rgba(255,255,255,0))' }}
          />
          <ThanksBadge rating={sent} />
          <div className="relative text-[30px] font-bold">{sent === 'bad' ? 'شكرًا لملاحظتك' : 'شكرًا لك!'}</div>
          <div className="relative mx-auto mt-2.5 max-w-[300px] text-[15.5px] leading-[1.8] text-ink-2">
            {sent === 'bad'
              ? 'تم إبلاغ المسؤول، وسيتم معالجة الملاحظة في أقرب وقت.'
              : 'تقييمك يساعدنا على الحفاظ على مستوى النظافة.'}
          </div>
        </section>
      ) : (
        <section className="rounded-[22px] border border-line bg-white px-4 pt-[26px] pb-[22px] shadow-[0_10px_30px_rgba(47,79,68,.05)]">
          <h2 className="m-0 mb-4 text-center text-[22px] font-bold">كيف تقيّم نظافة دورة المياه؟</h2>
          <div className="mx-auto grid max-w-[380px] grid-cols-3 gap-2" role="radiogroup" aria-label="تقييم النظافة">
            {ORDER.map((r, i) => {
              const on = rating === r;
              const style = FACE_STYLE[r];
              return (
                <button
                  key={r}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  aria-label={FEEDBACK_RATING_LABEL[r]}
                  data-testid={`face-${r}`}
                  onClick={() => pick(r)}
                  className="flex min-h-11 animate-[faceIn_.45s_cubic-bezier(.2,.8,.3,1)_both] cursor-pointer flex-col items-center gap-2 border-0 bg-transparent py-1 transition-opacity duration-200"
                  style={{ opacity: rating && !on ? 0.5 : 1, animationDelay: `${i * 60}ms` }}
                >
                  <span
                    className="block aspect-square w-full max-w-[76px] rounded-full transition-[transform,box-shadow] duration-300"
                    style={{
                      transform: `scale(${on ? 1.14 : 1})`,
                      boxShadow: on ? `0 0 0 3px #FFFFFF, 0 0 0 5px ${style.ring}, 0 8px 18px rgba(47,79,68,.16)` : 'none',
                    }}
                  >
                    <Face rating={r} size="100%" className="block h-full w-full" />
                  </span>
                  <span className="text-[12.5px] whitespace-nowrap text-ink" style={{ fontWeight: on ? 700 : 500 }}>
                    {FEEDBACK_RATING_LABEL[r]}
                  </span>
                </button>
              );
            })}
          </div>

          {rating && (
            <div
              className="mt-5 animate-fade-up rounded-[14px] px-3.5 py-3 text-center text-[15px] leading-[1.7] font-medium text-ink"
              style={{ background: FACE_STYLE[rating].msgBg }}
              data-testid="selection-message"
            >
              {FEEDBACK_SELECTION_MESSAGE[rating]}
            </div>
          )}

          {isBad && (
            <div className="mt-3.5 flex animate-fade-up flex-col gap-2" role="group" aria-label="سبب عدم الرضا">
              <div className="text-[14px] font-semibold">سبب عدم الرضا</div>
              {FEEDBACK_REASONS.map((r) => {
                const on = reasons.includes(r.key);
                return (
                  <button
                    key={r.key}
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    data-testid={`reason-${r.key}`}
                    onClick={() => toggleReason(r.key)}
                    className="flex min-h-12 w-full items-center gap-2.5 rounded-[12px] border px-3.5 py-2.5 text-right text-[14.5px] text-ink transition-colors"
                    style={{ borderColor: on ? '#2F4F44' : '#E3EAE6', background: on ? '#EAF3EC' : '#FFFFFF' }}
                  >
                    <span
                      className="inline-flex h-5 w-5 flex-none items-center justify-center rounded-[6px] text-[12px] text-white"
                      style={{ border: `1.5px solid ${on ? '#2F4F44' : '#C8D8CF'}`, background: on ? '#2F4F44' : '#FFFFFF' }}
                      aria-hidden
                    >
                      {on ? '✓' : ''}
                    </span>
                    {r.label}
                  </button>
                );
              })}
              {otherSelected && (
                <textarea
                  value={otherText}
                  onChange={(e) => setOtherText(e.target.value)}
                  rows={3}
                  maxLength={500}
                  aria-label="سبب آخر"
                  placeholder="اكتب ملاحظتك هنا"
                  data-testid="other-text"
                  className="w-full animate-fade-up resize-y rounded-[12px] border border-[#8FB8A2] p-3 text-[15px] outline-ink"
                />
              )}
            </div>
          )}

          {error && <ErrorBox className="mt-3.5 text-[14px]">{error}</ErrorBox>}

          {ready && (
            <button
              type="button"
              onClick={submit}
              disabled={sending}
              data-testid="submit-feedback"
              className="mt-[18px] flex w-full animate-fade-up items-center justify-center gap-2 rounded-[14px] bg-brand p-4 text-[16px] font-semibold text-white transition-[transform,box-shadow] duration-150 enabled:hover:-translate-y-px enabled:hover:shadow-[0_8px_20px_rgba(47,79,68,.22)] disabled:opacity-80"
            >
              {sending && <Spinner />}
              إرسال التقييم
            </button>
          )}
        </section>
      )}

      <div className="pt-2.5 text-center text-[13px] text-muted">
        هل لديك حساب؟{' '}
        <Link href="/login" className="text-ink underline underline-offset-[3px] hover:text-brand">
          تسجيل دخول الموظفين
        </Link>
      </div>
    </main>
  );
}
