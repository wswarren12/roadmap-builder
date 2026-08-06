import { NextResponse } from 'next/server';
import { authorizeRoadmap } from '@/lib/api-helpers';
import { getStore } from '@/lib/store';

export const dynamic = 'force-dynamic';

interface Params {
  params: { id: string };
}

/**
 * Import the roadmap's LabOS users into the team roster (F-13): the
 * requester plus everyone who joined via an invite link (uid shares).
 * There is no PLN API to enumerate an arbitrary LabOS team's members, so
 * "the team" is the set of members with access to this roadmap. Existing
 * entries are kept (deduped by member uid, then by name); the requester's
 * profile image is captured on the way through.
 */
export async function POST(req: Request, { params }: Params) {
  const auth = await authorizeRoadmap(req, params.id, 'write');
  if (auth instanceof NextResponse) return auth;

  const store = getStore();
  const shares = await store.listShares(params.id);
  const candidates: { uid: string; name: string; image: string | null }[] = [
    { uid: auth.identity.uid, name: auth.identity.name, image: auth.identity.image ?? null },
    ...shares
      .filter((s) => s.memberUid)
      .map((s) => ({ uid: s.memberUid!, name: s.memberName ?? s.memberUid!, image: null })),
  ];

  let added = 0;
  for (const candidate of candidates) {
    const existing = await store.listTeamMembers(params.id);
    const byUid = existing.find((m) => m.memberUid === candidate.uid);
    if (byUid) {
      if (candidate.image && byUid.image !== candidate.image) {
        await store.updateTeamMember(byUid.id, { image: candidate.image });
      }
      continue;
    }
    if (existing.some((m) => m.name.toLowerCase() === candidate.name.toLowerCase())) {
      continue;
    }
    await store.addTeamMember(params.id, {
      name: candidate.name,
      memberUid: candidate.uid,
      image: candidate.image,
    });
    added++;
  }

  const members = await store.listTeamMembers(params.id);
  return NextResponse.json({ members, added });
}
