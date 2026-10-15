import type { Metadata } from 'next';
import { InvalidToken } from '@/components/public/invalid-token';
import { RateExperience } from '@/components/public/rate-experience';
import { serverNow } from '@/lib/server/clock';
import { resolveQrToken } from '@/lib/server/public';

export const metadata: Metadata = { title: 'تقييم نظافة دورة المياه' };
export const dynamic = 'force-dynamic';

export default async function RatePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const info = await resolveQrToken(token);
  if (!info) return <InvalidToken />;
  const now = await serverNow();
  return (
    <RateExperience
      token={token}
      restroom={{ name: info.name, floor: info.floor, building: info.building }}
      serverNow={now.toISOString()}
    />
  );
}
