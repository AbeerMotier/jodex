import type { Metadata } from 'next';
import { Suspense } from 'react';
import { NotesView } from '@/components/admin/notes-view';

export const metadata: Metadata = { title: 'الملاحظات والإجراءات' };

export default function NotesPage() {
  return (
    <Suspense>
      <NotesView />
    </Suspense>
  );
}
