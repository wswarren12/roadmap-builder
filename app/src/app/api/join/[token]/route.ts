import { NextResponse } from 'next/server';
import { jsonError, requireIdentity, roleForRoadmap } from '@/lib/api-helpers';
import { getStore } from '@/lib/store';

export const dynamic = 'force-dynamic';

/**
 * Claim an invite link (F-6, invite-link mechanism): binds the caller's
 * LabOS-verified uid with the role the link grants (editor or viewer).
 * Requires authentication — the link grants nothing to anonymous visitors.
 * Claims never downgrade: a viewer opening an editor link is upgraded in
 * place; an owner/editor opening a viewer link keeps their stronger role.
 */
export async function POST(req: Request, { params }: { params: { token: string } }) {
  const identity = await requireIdentity(req);
  if (identity instanceof NextResponse) return identity;

  const store = getStore();
  const found = await store.findRoadmapByInviteToken(params.token);
  if (!found) {
    return jsonError(404, 'This invite link is no longer valid — ask the owner for a new one');
  }
  const { roadmap, role: linkRole } = found;

  const current = await roleForRoadmap(identity, roadmap);
  let effective = current;
  if (current === 'none') {
    await store.addUidShare(roadmap.id, identity.uid, identity.name, linkRole);
    effective = linkRole;
  } else if (current === 'viewer' && linkRole === 'editor') {
    const shares = await store.listShares(roadmap.id);
    const mine = shares.find((s) => s.memberUid === identity.uid);
    if (mine) await store.setShareRole(mine.id, 'editor');
    else await store.addUidShare(roadmap.id, identity.uid, identity.name, 'editor');
    effective = 'editor';
  }
  await store.setLastRoadmap(identity.uid, roadmap.id);

  return NextResponse.json({
    roadmapId: roadmap.id,
    title: roadmap.title,
    role: effective,
  });
}
