import { NextResponse } from 'next/server';
import { authorizeRoadmap, jsonError, readJson, roleForRoadmap } from '@/lib/api-helpers';
import { ITEM_PALETTE } from '@/lib/colors';
import { getStore } from '@/lib/store';
import { importItemLinked } from '@/lib/sync';
import { roadmapSpan, validateDatesWithin } from '@/lib/validate';

export const dynamic = 'force-dynamic';

interface Params {
  params: { id: string };
}

/**
 * Import an item (with its sprints) from another roadmap as a linked copy
 * (F-15b). The copies share a sync group from then on — see lib/sync.ts.
 *
 * Requires WRITE on both roadmaps: linking creates a permanent two-way edit
 * channel (edits to either copy propagate), so it is a write operation on
 * the source as much as the target. Read access is deliberately NOT enough —
 * otherwise a viewer could import an item into their own roadmap and edit
 * the original through the link. Invisible source roadmaps 404 (not 403),
 * so the endpoint doesn't confirm foreign roadmap ids.
 */
export async function POST(req: Request, { params }: Params) {
  const auth = await authorizeRoadmap(req, params.id, 'write');
  if (auth instanceof NextResponse) return auth;
  const { identity, roadmap } = auth;

  const body = await readJson(req);
  if (!body) return jsonError(400, 'Invalid JSON body');
  const sourceItemId = typeof body.sourceItemId === 'string' ? body.sourceItemId : '';
  const initiativeId = typeof body.initiativeId === 'string' ? body.initiativeId : '';

  const store = getStore();
  const source = await store.getItem(sourceItemId);
  if (!source) return jsonError(404, 'The item to import no longer exists');
  if (source.roadmapId === roadmap.id) {
    return jsonError(400, 'That item is already on this roadmap', 'sourceItemId');
  }

  const sourceRoadmap = await store.getRoadmap(source.roadmapId);
  if (!sourceRoadmap) return jsonError(404, 'The item to import no longer exists');
  const sourceRole = await roleForRoadmap(identity, sourceRoadmap);
  if (sourceRole === 'none') {
    return jsonError(404, 'The item to import no longer exists');
  }
  if (sourceRole !== 'owner' && sourceRole !== 'editor') {
    return jsonError(
      403,
      'You need edit access on the source roadmap to import its items — imported items stay linked for shared editing',
    );
  }

  const initiative = await store.getInitiative(initiativeId);
  if (!initiative || initiative.roadmapId !== roadmap.id) {
    return jsonError(400, 'Pick an initiative on this roadmap first', 'initiativeId');
  }

  const span = roadmapSpan(roadmap);
  const dateErr = validateDatesWithin(
    source.startDate,
    source.endDate,
    span.start,
    span.end,
    'the roadmap date range',
  );
  if (dateErr) {
    return jsonError(
      400,
      `"${source.title}" (${source.startDate} → ${source.endDate}) falls outside this roadmap's range — widen the range first`,
      'sourceItemId',
    );
  }

  const colorIndex = (await store.countItems(roadmap.id)) % ITEM_PALETTE.length;
  const item = await importItemLinked(source, roadmap.id, initiative.id, colorIndex);
  const sprintCount = await store.countSprints(item.id);
  return NextResponse.json({ item: { ...item, sprintCount } }, { status: 201 });
}
