import { NextResponse } from 'next/server';
import { jsonError, requireIdentity, roleForRoadmap } from '@/lib/api-helpers';
import { getStore } from '@/lib/store';

export const dynamic = 'force-dynamic';

/**
 * Claim an invite link (F-6, invite-link mechanism): binds the caller's
 * LabOS-verified uid as a read-only viewer. Requires authentication — the
 * link grants nothing to anonymous visitors. Owner/existing-viewer claims
 * are no-ops that just resolve the roadmap id.
 */
export async function POST(req: Request, { params }: { params: { token: string } }) {
  const identity = await requireIdentity(req);
  if (identity instanceof NextResponse) return identity;

  const store = getStore();
  const roadmap = await store.findRoadmapByInviteToken(params.token);
  if (!roadmap) {
    return jsonError(404, 'This invite link is no longer valid — ask the owner for a new one');
  }

  const role = await roleForRoadmap(identity, roadmap);
  if (role === 'none') {
    await store.addUidShare(roadmap.id, identity.uid, identity.name);
  }
  await store.setLastRoadmap(identity.uid, roadmap.id);

  return NextResponse.json({
    roadmapId: roadmap.id,
    title: roadmap.title,
    role: role === 'none' ? 'viewer' : role,
  });
}
