'use client';
import { useState, type FormEvent } from 'react';
import { Decor } from '@/components/ui/decor';
import { Logo } from '@/components/ui/logo';
import { ErrorBox } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { WELCOME_KEY } from '@/components/ui/toast';
import { api, ApiClientError } from '@/lib/client/api';
import { LOGIN_EMPTY_MESSAGE } from '@/lib/domain/validation';

interface Props {
  next?: string;
  expired?: boolean;
  demoAccounts: { username: string; label: string }[];
}

export function LoginForm({ next, expired, demoAccounts }: Props) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(expired ? 'انتهت الجلسة. سجّل الدخول مجددًا — مسودتك محفوظة.' : '');
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError(LOGIN_EMPTY_MESSAGE);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await api<{ redirectTo: string; welcome: string }>('/api/auth/login', {
        body: { username, password, next },
        noAuthRedirect: true,
      });
      try {
        sessionStorage.setItem(WELCOME_KEY, res.welcome);
      } catch {
        /* تجاهل */
      }
      window.location.assign(res.redirectTo);
    } catch (err) {
      setLoading(false);
      setError(err instanceof ApiClientError ? err.message : 'حدث خطأ غير متوقع. حاول مرة أخرى.');
    }
  }

  const inputClass =
    'h-11 w-full rounded-none border-0 border-b border-line bg-transparent px-0.5 text-right text-[15px] text-ink outline-none transition-colors placeholder:text-[#9AABA3] focus:border-b-brand';

  return (
    <main
      className="flex min-h-dvh animate-[fadeIn_.35s_ease_both] items-center justify-center bg-alt"
      style={{ padding: 'clamp(0px,3vw,32px)' }}
    >
      <div
        className="relative flex w-full max-w-[400px] flex-col overflow-hidden bg-login-card shadow-[0_30px_60px_-30px_rgba(47,79,68,.4)]"
        style={{
          minHeight: 'calc(100dvh - 2 * clamp(0px,3vw,32px))',
          borderRadius: 'clamp(0px, calc((100vw - 440px) * 100), 34px)',
        }}
      >
        <div className="absolute inset-x-0 top-0 isolate h-[290px] overflow-hidden rounded-b-[34px] bg-brand">
          <Decor variant="hero" />
          <div className="absolute inset-x-0 top-[26px] flex animate-fade-up justify-center">
            <Logo size="lg" />
          </div>
        </div>
        <div className="relative flex flex-1 flex-col gap-5 px-4 pt-[150px] pb-7">
          <div className="flex animate-[fadeUp_.5s_cubic-bezier(.2,.8,.3,1)_.05s_both] flex-col gap-[22px] rounded-[26px] bg-white px-[22px] pt-[30px] pb-[26px] shadow-[0_20px_40px_-24px_rgba(47,79,68,.4)]">
            <h1 className="m-0 text-center text-[28px] font-bold text-ink">تسجيل الدخول</h1>
            <form onSubmit={onSubmit} className="flex flex-col gap-[18px]" noValidate>
              <input
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value);
                  setError('');
                }}
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                aria-label="اسم المستخدم"
                placeholder="اسم المستخدم"
                name="username"
                className={inputClass}
              />
              <input
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setError('');
                }}
                autoComplete="current-password"
                aria-label="كلمة المرور"
                placeholder="كلمة المرور"
                name="password"
                className={inputClass}
              />
              {error && <ErrorBox>{error}</ErrorBox>}
              <button
                type="submit"
                disabled={loading}
                className="mt-2.5 flex h-[50px] items-center justify-center gap-2 rounded-full bg-brand text-[16px] font-bold text-white shadow-[0_12px_24px_-12px_rgba(85,149,122,.8)] transition-[transform,background-color] duration-150 enabled:hover:-translate-y-px enabled:hover:bg-ink-2 disabled:opacity-80"
              >
                {loading && <Spinner />}
                دخول
              </button>
            </form>
          </div>
          {demoAccounts.length > 0 && (
            <div className="flex animate-[fadeUp_.5s_ease_.15s_both] flex-col gap-2.5" data-testid="demo-accounts">
              <div className="grid grid-cols-2 gap-2">
                {demoAccounts.map((a) => (
                  <button
                    key={a.username}
                    type="button"
                    onClick={() => {
                      setUsername(a.username);
                      setError('');
                    }}
                    className="flex h-[46px] min-w-0 items-center justify-center gap-1.5 rounded-full bg-white px-3 shadow-[0_6px_16px_-10px_rgba(47,79,68,.35)] transition-transform hover:-translate-y-px"
                  >
                    <span className="font-mono text-[12.5px] font-bold text-ink" dir="ltr">
                      {a.username}
                    </span>
                    <span className="truncate text-[11px] text-muted">{a.label}</span>
                  </button>
                ))}
              </div>
              <p className="m-0 mt-1 text-center text-[13px] text-muted">
                حسابات الديمو (DEMO_MODE) · كلمات المرور تُطبع مرة واحدة عند تشغيل <b className="font-mono text-brand">npm run db:seed</b>
              </p>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
