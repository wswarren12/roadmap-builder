import { NextResponse } from 'next/server';
import { jsonError, readJson, requireIdentity } from '@/lib/api-helpers';
import { DEFAULT_PALETTE_ID, PALETTES } from '@/lib/colors';
import { getStore } from '@/lib/store';
import { requireNonEmpty, validateRoadmapRange } from '@/lib/validate';

export const dynamic = 'force-dynamic';

/** Create a roadmap (F-1). Creates one default initiative row. */
export async function POST(req: Request) {
  const identity = await requireIdentity(req);
  if (identity instanceof NextResponse) return identity;

  const body = await readJson(req);
  if (!body) return jsonError(400, 'Invalid JSON body');

  const titleErr = requireNonEmpty(body.title, 'title');
  if (titleErr) return jsonError(400, 'Title is required', 'title');

  const rangeErr = validateRoadmapRange(body.startMonth, body.endMonth);
  if (rangeErr) return jsonError(400, rangeErr.message, rangeErr.field);

  const palette = body.palette === undefined ? DEFAULT_PALETTE_ID : String(body.palette);
  if (!PALETTES.some((p) => p.id === palette)) {
    return jsonError(400, 'Unknown color palette', 'palette');
  }

  const store = getStore();
  const roadmap = await store.createRoadmap(identity, {
    title: String(body.title).trim(),
    description: typeof body.description === 'string' ? body.description : '',
    startMonth: body.startMonth as string,
    endMonth: body.endMonth as string,
    palette,
  });
  const initiative = await store.createInitiative(roadmap.id, 'Initiative 1');
  // The creator is always part of the team: puts them in the DRI drop-down
  // from the first item onward (they'd otherwise have to add themselves).
  await store.addTeamMember(roadmap.id, {
    name: identity.name,
    memberUid: identity.uid,
    image: identity.image ?? null,
  });
  await store.setLastRoadmap(identity.uid, roadmap.id);

  return NextResponse.json({ roadmap, initiatives: [initiative] }, { status: 201 });
}
