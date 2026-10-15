import type { Metadata } from 'next';
import { Suspense } from 'react';
import { FeedbackView } from '@/components/admin/feedback-view';

export const metadata: Metadata = { title: 'تقييمات المستفيدين' };

export default function FeedbackPage() {
  return (
    <Suspense>
      <FeedbackView />
    </Suspense>
  );
}
