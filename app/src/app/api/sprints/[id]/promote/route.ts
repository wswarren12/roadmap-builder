import { NextResponse } from 'next/server';
import { authorizeRoadmap, jsonError } from '@/lib/api-helpers';
import { ITEM_PALETTE } from '@/lib/colors';
import { getStore } from '@/lib/store';

export const dynamic = 'force-dynamic';

interface Params {
  params: { id: string };
}

/**
 * Promote a sprint item to a roadmap item (F-12): the sprint becomes a
 * full item in the same initiative as its former parent, with its fields
 * mapped across (name→title, dri→dris, dates/milestone/kpi carried, status
 * defaults to green). The sprint's dates sit inside the parent item, which
 * sits inside the roadmap span, so no revalidation is needed. The original
 * sprint is removed from the parent.
 */
export async function POST(req: Request, { params }: Params) {
  const store = getStore();
  const sprint = await store.getSprint(params.id);
  if (!sprint) return jsonError(404, 'This sprint item no longer exists');

  const parent = await store.getItem(sprint.roadmapItemId);
  if (!parent) return jsonError(404, 'This sprint item no longer exists');

  const auth = await authorizeRoadmap(req, parent.roadmapId, 'write');
  if (auth instanceof NextResponse) return auth;

  const colorIndex = (await store.countItems(parent.roadmapId)) % ITEM_PALETTE.length;
  const item = await store.createItem(
    parent.roadmapId,
    {
      initiativeId: parent.initiativeId,
      title: sprint.name,
      description: sprint.description,
      startDate: sprint.startDate,
      endDate: sprint.endDate,
      milestoneText: sprint.milestoneText,
      milestoneDate: sprint.milestoneDate,
      okrs: '',
      dris: sprint.dri,
      status: 'green',
      kpi: sprint.kpi,
      completedAt: sprint.completedAt,
    },
    colorIndex,
  );
  await store.deleteSprint(sprint.id);

  return NextResponse.json({ item: { ...item, sprintCount: 0 } }, { status: 201 });
}
