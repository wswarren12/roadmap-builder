import { NextResponse } from 'next/server';
import { authorizeRoadmap } from '@/lib/api-helpers';
import { describeSuggestion } from '@/lib/agent-links/suggestions';
import { getStore } from '@/lib/store';

export const dynamic = 'force-dynamic';

interface Params {
  params: { id: string };
}

/** Suggestions for the review panel (write tier — reviewers accept/reject).
 *  Each row carries the filing agent's name and a human-readable summary. */
export async function GET(req: Request, { params }: Params) {
  const auth = await authorizeRoadmap(req, params.id, 'write');
  if (auth instanceof NextResponse) return auth;

  const store = getStore();
  const suggestions = await store.listSuggestions(auth.roadmap.id);
  const enriched = await Promise.all(
    suggestions.map(async (s) => {
      const link = await store.getAgentLink(s.agentLinkId);
      return {
        ...s,
        agentName: link?.name ?? 'Unknown agent',
        summary: await describeSuggestion(s),
      };
    }),
  );
  return NextResponse.json({ suggestions: enriched });
}
