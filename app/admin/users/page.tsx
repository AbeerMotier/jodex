import type { Metadata } from 'next';
import { UsersView } from '@/components/admin/users-view';

export const metadata: Metadata = { title: 'المستخدمون والصلاحيات' };

/** كل أدمن يرى الصفحة؛ المطّلع للعرض فقط (أزرار التعديل مخفية والخادم يرفض أي تعديل) */
export default function UsersPage() {
  return <UsersView />;
}
