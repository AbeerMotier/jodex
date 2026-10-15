import 'server-only';
import { FEEDBACK_REASON_LABEL, FEEDBACK_VALUE_RATING, FEEDBACK_RATING_VALUE, type FeedbackRating, type FeedbackReasonKey } from '@/lib/domain/catalog';
import { createUserClient } from '../supabase';
import { loadRestroomRefs, restroomScope, type CommonQuery } from './common';
import { roomView } from './presenters';

export const FEEDBACK_PAGE_SIZE = 25;

export interface FeedbackQuery extends CommonQuery {
  rating?: FeedbackRating;
  offset: number;
  limit: number;
}

export async function listFeedback(q: FeedbackQuery) {
  const client = await createUserClient();
  const rooms = await loadRestroomRefs(client, { includeInactive: true });
  const scope = restroomScope(rooms, q);
  if (scope && scope.size === 0) return { rows: [], total: 0, offset: q.offset, limit: q.limit };
  let query = client
    .from('beneficiary_feedback')
    .select('id, restroom_id, submitted_at, rating, other_text', { count: 'exact' })
    .gte('submitted_at', q.range.fromInstant.toISOString())
    .lt('submitted_at', q.range.toInstantExclusive.toISOString());
  if (scope) query = query.in('restroom_id', [...scope]);
  if (q.rating) query = query.eq('rating', FEEDBACK_RATING_VALUE[q.rating]);
  const { data, count, error } = await query
    .order('submitted_at', { ascending: false })
    .order('id', { ascending: false })
    .range(q.offset, q.offset + q.limit - 1);
  if (error) throw new Error(error.message);
  const ids = (data ?? []).map((f) => f.id);
  const [{ data: links }, { data: reasons }] = await Promise.all([
    ids.length ? client.from('beneficiary_feedback_reasons').select('feedback_id, reason_id').in('feedback_id', ids) : Promise.resolve({ data: [] as { feedback_id: string; reason_id: number }[] }),
    client.from('feedback_reasons').select('id, key').order('sort_order'),
  ]);
  const reasonKey = new Map((reasons ?? []).map((r) => [r.id, r.key as FeedbackReasonKey]));
  const roomMap = new Map(rooms.map((r) => [r.id, r]));
  return {
    total: count ?? 0,
    offset: q.offset,
    limit: q.limit,
    rows: (data ?? []).map((f) => {
      const keys = (links ?? [])
        .filter((l) => l.feedback_id === f.id)
        .map((l) => reasonKey.get(l.reason_id))
        .filter((k): k is FeedbackReasonKey => Boolean(k))
        .sort((a, b) => (a === 'other' ? 1 : b === 'other' ? -1 : 0));
      const parts = keys.filter((k) => k !== 'other').map((k) => FEEDBACK_REASON_LABEL[k]);
      if (keys.includes('other')) parts.push(f.other_text ? `أخرى: ${f.other_text}` : 'أخرى');
      return {
        id: f.id,
        restroom: roomView(roomMap, f.restroom_id),
        submittedAt: f.submitted_at,
        rating: FEEDBACK_VALUE_RATING[f.rating] ?? 'good',
        reasons: parts,
      };
    }),
  };
}
