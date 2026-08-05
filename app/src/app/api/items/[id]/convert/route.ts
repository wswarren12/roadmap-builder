import { NextResponse } from 'next/server';
import { authorizeRoadmap, jsonError, readJson } from '@/lib/api-helpers';
import { toUTC } from '@/lib/dates';
import { getStore } from '@/lib/store';

export const dynamic = 'force-dynamic';

interface Params {
  params: { id: string };
}

/**
 * Convert a roadmap item into a sprint item of another item (F-11): the
 * source becomes a sprint of the target (title→name, dris→dri), its own
 * sprints flatten into the target as siblings, and the target's dates
 * expand to cover the source's span so the sprints-within-item invariant
 * holds. The source item is deleted afterwards.
 */
export async function POST(req: Request, { params }: Params) {
  const store = getStore();
  const source = await store.getItem(params.id);
  if (!source) return jsonError(404, 'This item no longer exists');

  const auth = await authorizeRoadmap(req, source.roadmapId, 'write');
  if (auth instanceof NextResponse) return auth;

  const body = await readJson(req);
  if (!body) return jsonError(400, 'Invalid JSON body');

  const target =
    typeof body.targetItemId === 'string' ? await store.getItem(body.targetItemId) : null;
  if (!target || target.roadmapId !== source.roadmapId) {
    return jsonError(400, 'Target must be an item on this roadmap', 'targetItemId');
  }
  if (target.id === source.id) {
    return jsonError(400, 'Pick a different item to move into', 'targetItemId');
  }

  // Grow the target to envelope the source (both already sit inside the
  // roadmap span, so the expanded dates do too).
  const startDate =
    toUTC(source.startDate) < toUTC(target.startDate) ? source.startDate : target.startDate;
  const endDate =
    toUTC(source.endDate) > toUTC(target.endDate) ? source.endDate : target.endDate;
  let updated = target;
  if (startDate !== target.startDate || endDate !== target.endDate) {
    updated = await store.updateItem(target.id, { startDate, endDate });
  }

  const grandchildren = await store.listSprints(source.id);
  await store.createSprint(target.id, {
    name: source.title,
    description: source.description,
    startDate: source.startDate,
    endDate: source.endDate,
    milestoneText: source.milestoneText,
    milestoneDate: source.milestoneDate,
    kpi: source.kpi,
    dri: source.dris,
  });
  for (const sprint of grandchildren) {
    await store.createSprint(target.id, {
      name: sprint.name,
      description: sprint.description,
      startDate: sprint.startDate,
      endDate: sprint.endDate,
      milestoneText: sprint.milestoneText,
      milestoneDate: sprint.milestoneDate,
      kpi: sprint.kpi,
      dri: sprint.dri,
    });
  }
  await store.deleteItem(source.id);

  const sprintCount = await store.countSprints(target.id);
  return NextResponse.json({ item: { ...updated, sprintCount } }, { status: 201 });
}
