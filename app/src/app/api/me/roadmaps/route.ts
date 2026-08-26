import { NextResponse } from 'next/server';
import { requireIdentity, roleForRoadmap } from '@/lib/api-helpers';
import { getStore } from '@/lib/store';

export const dynamic = 'force-dynamic';

/** Owned + shared-with-me lists for the Profile page (F-7). */
export async function GET(req: Request) {
  const identity = await requireIdentity(req);
  if (identity instanceof NextResponse) return identity;

  const store = getStore();
  const ownedRaw = await store.listRoadmapsOwned(identity.uid);
  const sharedByUid = await store.listRoadmapsSharedWithUid(identity.uid);
  const sharedByEmail = identity.email
    ? await store.listRoadmapsSharedWith(identity.email)
    : [];
  const seen = new Set(sharedByUid.map((r) => r.id));
  const sharedRaw = [...sharedByUid, ...sharedByEmail.filter((r) => !seen.has(r.id))];
  const shared = await Promise.all(
    sharedRaw.map(async (roadmap) => ({ ...roadmap, role: await roleForRoadmap(identity, roadmap) })),
  );

  // Cascade counts power the delete-confirm copy on Profile (AC-9.3).
  const owned = await Promise.all(
    ownedRaw.map(async (roadmap) => {
      const items = await store.listItems(roadmap.id);
      const sprintCounts = await Promise.all(items.map((i) => store.countSprints(i.id)));
      return {
        ...roadmap,
        role: 'owner' as const,
        itemCount: items.length,
        sprintCount: sprintCounts.reduce((a, b) => a + b, 0),
      };
    }),
  );

  return NextResponse.json({ owned, shared });
}
