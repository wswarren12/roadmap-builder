import { NextResponse } from 'next/server';
import { authorizeRoadmap, jsonError, readJson, requireIdentity } from '@/lib/api-helpers';
import { ITEM_PALETTE } from '@/lib/colors';
import { getStore } from '@/lib/store';
import { roadmapSpan, validateDatesWithin } from '@/lib/validate';

export const dynamic = 'force-dynamic';
interface Params { params: { id: string } }

export async function POST(req: Request, { params }: Params) {
  const identity = await requireIdentity(req);
  if (identity instanceof NextResponse) return identity;
  const store = getStore();
  if (!(await store.getBacklogItem(params.id, identity.uid))) {
    return jsonError(404, 'Backlog item not found');
  }
  const body = await readJson(req);
  if (!body) return jsonError(400, 'Invalid JSON body');
  const roadmapId = typeof body.roadmapId === 'string' ? body.roadmapId : '';
  const initiativeId = typeof body.initiativeId === 'string' ? body.initiativeId : '';
  if (!roadmapId) return jsonError(400, 'Pick a roadmap first', 'roadmapId');

  const auth = await authorizeRoadmap(req, roadmapId, 'write');
  if (auth instanceof NextResponse) return auth;
  const initiative = await store.getInitiative(initiativeId);
  if (!initiative || initiative.roadmapId !== roadmapId) {
    return jsonError(400, 'Pick an initiative on this roadmap first', 'initiativeId');
  }
  const span = roadmapSpan(auth.roadmap);
  const dateError = validateDatesWithin(body.startDate, body.endDate, span.start, span.end, 'the roadmap date range');
  if (dateError) return jsonError(400, dateError.message, dateError.field);

  const colorIndex = (await store.countItems(roadmapId)) % ITEM_PALETTE.length;
  try {
    const result = await store.importBacklogItem(params.id, identity.uid, {
      roadmapId,
      initiativeId,
      startDate: body.startDate as string,
      endDate: body.endDate as string,
      colorIndex,
    });
    return NextResponse.json(
      { item: { ...result.item, sprintCount: result.sprints.length } },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof Error && error.message.includes('backlog item not found')) {
      return jsonError(404, 'Backlog item not found');
    }
    throw error;
  }
}
