import type { Metadata } from 'next';
import { PlacesView } from '@/components/admin/places-view';

export const metadata: Metadata = { title: 'المباني ودورات المياه' };

/** كل أدمن يرى الصفحة؛ المطّلع للعرض فقط (أزرار التعديل مخفية والخادم يرفض أي تعديل) */
export default function RestroomsPage() {
  return <PlacesView />;
}
