import { NextResponse } from 'next/server';
import { jsonError, requireIdentity, roleForRoadmap } from '@/lib/api-helpers';
import { getStore } from '@/lib/store';

export const dynamic = 'force-dynamic';

/** Identity + last-visited roadmap (F-5). Falls back to null when the last
 *  roadmap was deleted or access was revoked (never a dead end). */
export async function GET(req: Request) {
  const identity = await requireIdentity(req);
  if (identity instanceof NextResponse) return identity;

  const store = getStore();
  const state = await store.getUserState(identity.uid);
  let lastRoadmapId: string | null = null;
  let lastRoadmapGone = false;

  if (state?.lastRoadmapId) {
    const roadmap = await store.getRoadmap(state.lastRoadmapId);
    if (roadmap && (await roleForRoadmap(identity, roadmap)) !== 'none') {
      lastRoadmapId = roadmap.id;
    } else {
      lastRoadmapGone = true;
    }
  }

  return NextResponse.json({
    user: { uid: identity.uid, name: identity.name, email: identity.email },
    lastRoadmapId,
    lastRoadmapGone,
    devMode: process.env.DEV_AUTH === '1',
  });
}
