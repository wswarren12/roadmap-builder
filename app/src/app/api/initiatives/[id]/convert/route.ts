import { NextResponse } from 'next/server';
import { authorizeRoadmap, jsonError, readJson } from '@/lib/api-helpers';
import { ITEM_PALETTE } from '@/lib/colors';
import { addDays, daysBetween, rangeEndDate } from '@/lib/dates';
import { getStore } from '@/lib/store';
import type { SprintInput } from '@/lib/types';

export const dynamic = 'force-dynamic';

interface Params {
  params: { id: string };
}

/**
 * Convert an initiative into a roadmap item of another initiative (F-10):
 * the initiative becomes an item titled after it, spanning the envelope of
 * its items' dates, and each of its items becomes a sprint item of the new
 * item. Sprints those items already had are flattened into the new item too,
 * so no data is lost. The source initiative is deleted afterwards.
 */
export async function POST(req: Request, { params }: Params) {
  const store = getStore();
  const source = await store.getInitiative(params.id);
  if (!source) return jsonError(404, 'Initiative not found');

  const auth = await authorizeRoadmap(req, source.roadmapId, 'write');
  if (auth instanceof NextResponse) return auth;
  const { roadmap } = auth;

  const body = await readJson(req);
  if (!body) return jsonError(400, 'Invalid JSON body');

  const target =
    typeof body.targetInitiativeId === 'string'
      ? await store.getInitiative(body.targetInitiativeId)
      : null;
  if (!target || target.roadmapId === undefined || target.roadmapId !== roadmap.id) {
    return jsonError(400, 'Target must be an initiative on this roadmap', 'targetInitiativeId');
  }
  if (target.id === source.id) {
    return jsonError(400, 'Pick a different initiative to move into', 'targetInitiativeId');
  }

  const children = (await store.listItems(roadmap.id)).filter(
    (i) => i.initiativeId === source.id,
  );

  // Envelope of the children's dates; an empty initiative gets the same
  // default two-week span the "+ Item" button uses.
  let startDate: string;
  let endDate: string;
  if (children.length) {
    startDate = children.map((i) => i.startDate).sort()[0];
    endDate = children.map((i) => i.endDate).sort().at(-1)!;
  } else {
    const spanEnd = rangeEndDate(roadmap.endMonth);
    startDate = roadmap.startMonth;
    endDate = daysBetween(startDate, spanEnd) >= 13 ? addDays(startDate, 13) : spanEnd;
  }

  const colorIndex = (await store.countItems(roadmap.id)) % ITEM_PALETTE.length;
  const item = await store.createItem(
    roadmap.id,
    {
      initiativeId: target.id,
      title: source.name,
      description: '',
      startDate,
      endDate,
      status: 'green',
    },
    colorIndex,
  );

  // Demote each child item to a sprint of the new item, carrying its former
  // sprints along as siblings (sprints cannot nest), then remove the child.
  let sprintCount = 0;
  for (const child of children) {
    const grandchildren = await store.listSprints(child.id);
    await store.createSprint(item.id, {
      name: child.title,
      description: child.description,
      startDate: child.startDate,
      endDate: child.endDate,
      milestoneText: child.milestoneText,
      milestoneDate: child.milestoneDate,
      kpi: child.kpi,
      dri: child.dris,
    });
    sprintCount++;
    for (const sprint of grandchildren) {
      const carried: SprintInput = {
        name: sprint.name,
        description: sprint.description,
        startDate: sprint.startDate,
        endDate: sprint.endDate,
        milestoneText: sprint.milestoneText,
        milestoneDate: sprint.milestoneDate,
        kpi: sprint.kpi,
        dri: sprint.dri,
      };
      await store.createSprint(item.id, carried);
      sprintCount++;
    }
    await store.deleteItem(child.id);
  }

  await store.deleteInitiative(source.id);
  return NextResponse.json({ item: { ...item, sprintCount } }, { status: 201 });
}
