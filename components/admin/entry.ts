import type { Role, Tone } from '@/lib/domain/catalog';

export interface EntryView {
  kind: 'round' | 'supervisor';
  id: string;
  date: string;
  time: string | null;
  typeLabel: string;
  employee: { name: string; role: Role };
  onBehalfOf: string | null;
  restroom: { id: string; name: string; floor: string; building: string };
  evalType: string;
  result: number | null;
  status: { label: string; tone: Tone };
  urgent: boolean;
}
