/** التحقق من أوزان البنود: مجموع أوزان البنود الفعالة في كل مجموعة محتسبة = 100 */
import type { ItemGroup } from './catalog';

export const SCORED_GROUPS = ['contractor', 'supervisor'] as const;
export type ScoredGroup = (typeof SCORED_GROUPS)[number];

export interface WeightItemInput {
  group: ItemGroup;
  weight?: number | null;
  isActive: boolean;
  delete?: boolean;
}

export interface GroupWeightSummary {
  sum: number;
  remaining: number;
  activeCount: number;
  valid: boolean;
}

const EPSILON = 0.001;
const round2 = (n: number) => Math.round(n * 100) / 100;

export function summarizeWeights(items: WeightItemInput[]): Record<ScoredGroup, GroupWeightSummary> {
  const result = {} as Record<ScoredGroup, GroupWeightSummary>;
  for (const group of SCORED_GROUPS) {
    const active = items.filter((i) => i.group === group && i.isActive && !i.delete);
    const sum = round2(active.reduce((s, i) => s + (Number.isFinite(i.weight) ? Number(i.weight) : 0), 0));
    result[group] = {
      sum,
      remaining: round2(100 - sum),
      activeCount: active.length,
      valid: active.length > 0 && Math.abs(sum - 100) < EPSILON,
    };
  }
  return result;
}

export function weightsAreValid(items: WeightItemInput[]): boolean {
  const s = summarizeWeights(items);
  return SCORED_GROUPS.every((g) => s[g].valid);
}
