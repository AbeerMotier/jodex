import type { Metadata } from 'next';
import { Suspense } from 'react';
import { QrView } from '@/components/admin/qr-view';

export const metadata: Metadata = { title: 'رموز QR' };

export default function QrPage() {
  return (
    <Suspense>
      <QrView />
    </Suspense>
  );
}
