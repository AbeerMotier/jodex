import type { Metadata } from 'next';
import { SettingsView } from '@/components/admin/settings-view';

export const metadata: Metadata = { title: 'الإعدادات والأوزان' };

/** كل أدمن يرى الصفحة؛ المطّلع للعرض فقط (أزرار التعديل مخفية والخادم يرفض أي تعديل) */
export default function SettingsPage() {
  return <SettingsView />;
}
