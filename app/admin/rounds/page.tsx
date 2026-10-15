import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LogView } from '@/components/admin/log-view';

export const metadata: Metadata = { title: 'سجل الجولات' };

export default function RoundsLogPage() {
  return (
    <Suspense>
      <LogView />
    </Suspense>
  );
}
