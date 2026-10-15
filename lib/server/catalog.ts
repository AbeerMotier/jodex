import 'server-only';
import type { ItemGroup } from '@/lib/domain/catalog';
import { createServiceClient } from './supabase';

export interface ChecklistItem {
  id: string;
  key: string;
  group: ItemGroup;
  title: string;
  description: string | null;
  weight: number | null;
  default_weight: number | null;
  is_default: boolean;
  sort_order: number;
  is_active: boolean;
}

export interface AppSettings {
  partial_credit_pct: number;
  deep_clean_weekday: number;
  updated_at: string | null;
}

const ITEM_COLUMNS = 'id, key, group, title, description, weight, default_weight, is_default, sort_order, is_active';

function normalizeItem(row: Record<string, unknown>): ChecklistItem {
  return {
    id: String(row.id),
    key: String(row.key),
    group: row.group as ItemGroup,
    title: String(row.title),
    description: (row.description as string | null) ?? null,
    weight: row.weight === null || row.weight === undefined ? null : Number(row.weight),
    default_weight: row.default_weight === null || row.default_weight === undefined ? null : Number(row.default_weight),
    is_default: Boolean(row.is_default),
    sort_order: Number(row.sort_order ?? 0),
    is_active: Boolean(row.is_active),
  };
}

export async function loadItems(options: { activeOnly?: boolean } = {}): Promise<ChecklistItem[]> {
  let query = createServiceClient().from('checklist_items').select(ITEM_COLUMNS);
  if (options.activeOnly) query = query.eq('is_active', true);
  const { data, error } = await query.order('group').order('sort_order').order('created_at');
  if (error) throw new Error(`loadItems: ${error.message}`);
  return (data ?? []).map((r) => normalizeItem(r as Record<string, unknown>));
}

export async function loadActiveItemsByGroup(): Promise<Record<ItemGroup, ChecklistItem[]>> {
  const items = await loadItems({ activeOnly: true });
  return {
    contractor: items.filter((i) => i.group === 'contractor'),
    deep: items.filter((i) => i.group === 'deep'),
    supervisor: items.filter((i) => i.group === 'supervisor'),
  };
}

export async function loadSettings(): Promise<AppSettings> {
  const { data, error } = await createServiceClient()
    .from('settings')
    .select('partial_credit_pct, deep_clean_weekday, updated_at')
    .eq('id', true)
    .maybeSingle();
  if (error) throw new Error(`loadSettings: ${error.message}`);
  return {
    partial_credit_pct: data ? Number(data.partial_credit_pct) : 50,
    deep_clean_weekday: data ? Number(data.deep_clean_weekday) : 1,
    updated_at: data?.updated_at ?? null,
  };
}
