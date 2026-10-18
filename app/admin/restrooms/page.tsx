import type { Metadata } from 'next';
import { PlacesView } from '@/components/admin/places-view';

export const metadata: Metadata = { title: 'المباني ودورات المياه' };

export default function RestroomsPage() {
  return <PlacesView />;
}
