import type { Metadata } from 'next';
import { Suspense } from 'react';
import { DashboardView } from '@/components/admin/dashboard-view';

export const metadata: Metadata = { title: 'لوحة المؤشرات' };

export default function AdminDashboardPage() {
  return (
    <Suspense>
      <DashboardView />
    </Suspense>
  );
}
