import { NextResponse } from 'next/server';
import { authorizeRoadmap, jsonError, readJson } from '@/lib/api-helpers';
import { applySuggestion } from '@/lib/agent-links/suggestions';
import { getStore } from '@/lib/store';

export const dynamic = 'force-dynamic';

interface Params {
  params: { id: string };
}

/**
 * Accept or reject a pending suggestion (write tier). Accept replays the
 * stored payload through the same store functions the human routes use; if
 * the roadmap changed underneath it (target deleted, dates now invalid) the
 * suggestion is marked rejected by 'system' and the response says why —
 * a 200 with applied:false, not a server error (spec: fail gracefully).
 */
export async function POST(req: Request, { params }: Params) {
  const store = getStore();
  const suggestion = await store.getSuggestion(params.id);
  if (!suggestion) return jsonError(404, 'This suggestion no longer exists');

  const auth = await authorizeRoadmap(req, suggestion.roadmapId, 'write');
  if (auth instanceof NextResponse) return auth;

  if (suggestion.status !== 'pending') {
    return jsonError(409, `This suggestion was already ${suggestion.status}`);
  }

  const body = await readJson(req);
  const action = body?.action;
  if (action !== 'accept' && action !== 'reject') {
    return jsonError(400, 'Action must be "accept" or "reject"', 'action');
  }

  if (action === 'reject') {
    const resolved = await store.resolveSuggestion(suggestion.id, 'rejected', auth.identity.uid);
    return NextResponse.json({ suggestion: resolved, applied: false });
  }

  const outcome = await applySuggestion(auth.roadmap, suggestion);
  if (!outcome.ok) {
    const resolved = await store.resolveSuggestion(suggestion.id, 'rejected', 'system');
    return NextResponse.json({ suggestion: resolved, applied: false, reason: outcome.reason });
  }
  const resolved = await store.resolveSuggestion(suggestion.id, 'accepted', auth.identity.uid);
  return NextResponse.json({ suggestion: resolved, applied: true });
}
