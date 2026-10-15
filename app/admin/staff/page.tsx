import type { Metadata } from 'next';
import { Suspense } from 'react';
import { StaffView } from '@/components/admin/staff-view';

export const metadata: Metadata = { title: 'أداء الموظفين المتميزين' };

export default function StaffPage() {
  return (
    <Suspense>
      <StaffView />
    </Suspense>
  );
}
