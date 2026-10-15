'use client';
import { useEffect, useState } from 'react';

/**
 * ساعة العرض مبنية على وقت الخادم (فرق ثابت عن ساعة الجهاز)،
 * فلا يؤثر وقت جهاز المستخدم على ما يُعرض. القواعد نفسها تُحسب على الخادم.
 */
export function useServerClock(serverNowIso: string | null | undefined, tickMs = 15_000) {
  const [state, setState] = useState<{ iso: string | null | undefined; now: Date | null }>({ iso: undefined, now: null });

  useEffect(() => {
    const offset = serverNowIso ? new Date(serverNowIso).getTime() - Date.now() : 0;
    const update = () => setState({ iso: serverNowIso, now: new Date(Date.now() + offset) });
    const first = setTimeout(update, 0);
    const timer = setInterval(update, tickMs);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [serverNowIso, tickMs]);

  // قبل أول تحديث (أو عند وصول وقت خادم جديد) نعرض وقت الخادم كما ورد
  if (state.now && state.iso === serverNowIso) return state.now;
  return serverNowIso ? new Date(serverNowIso) : (state.now ?? new Date(0));
}
