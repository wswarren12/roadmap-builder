import { NextResponse } from 'next/server';
import { authorizeRoadmap, jsonError, readJson } from '@/lib/api-helpers';
import { getStore } from '@/lib/store';
import { deleteSprintSynced, updateSprintSynced } from '@/lib/sync';
import type { SprintInput } from '@/lib/types';
import {
  requireNonEmpty,
  validateDatesWithin,
  validateMilestoneDate,
} from '@/lib/validate';

export const dynamic = 'force-dynamic';

interface Params {
  params: { id: string };
}

/** Edit / drag a sprint item — merged dates must stay inside the parent item. */
export async function PATCH(req: Request, { params }: Params) {
  const store = getStore();
  const sprint = await store.getSprint(params.id);
  if (!sprint) return jsonError(404, 'This sprint item no longer exists');
  const item = await store.getItem(sprint.roadmapItemId);
  if (!item) return jsonError(404, 'This item no longer exists');

  const auth = await authorizeRoadmap(req, item.roadmapId, 'write');
  if (auth instanceof NextResponse) return auth;

  const body = await readJson(req);
  if (!body) return jsonError(400, 'Invalid JSON body');

  if (body.name !== undefined && requireNonEmpty(body.name, 'name')) {
    return jsonError(400, 'Name is required', 'name');
  }

  const patch: Partial<SprintInput> = {};
  if (body.name !== undefined) patch.name = String(body.name).trim();
  if (body.description !== undefined) patch.description = String(body.description ?? '');
  if (body.kpi !== undefined) patch.kpi = String(body.kpi ?? '');
  if (body.dri !== undefined) patch.dri = String(body.dri ?? '');
  if (body.milestoneText !== undefined) patch.milestoneText = String(body.milestoneText ?? '');

  const startDate = (body.startDate as string) ?? sprint.startDate;
  const endDate = (body.endDate as string) ?? sprint.endDate;
  const dateErr = validateDatesWithin(
    startDate,
    endDate,
    item.startDate,
    item.endDate,
    "the parent item's timeline",
  );
  if (dateErr) return jsonError(400, dateErr.message, dateErr.field);
  if (body.startDate !== undefined) patch.startDate = startDate;
  if (body.endDate !== undefined) patch.endDate = endDate;

  const milestoneDate =
    body.milestoneDate === undefined
      ? sprint.milestoneDate
      : (body.milestoneDate as string | null);
  const msErr = validateMilestoneDate(milestoneDate, startDate, endDate);
  if (msErr) return jsonError(400, msErr.message, msErr.field);
  if (body.milestoneDate !== undefined) patch.milestoneDate = milestoneDate || null;

  const updated = await updateSprintSynced(sprint.id, patch);
  return NextResponse.json({ sprint: updated });
}

export async function DELETE(req: Request, { params }: Params) {
  const store = getStore();
  const sprint = await store.getSprint(params.id);
  if (!sprint) return jsonError(404, 'This sprint item no longer exists');
  const item = await store.getItem(sprint.roadmapItemId);
  if (!item) return jsonError(404, 'This item no longer exists');

  const auth = await authorizeRoadmap(req, item.roadmapId, 'write');
  if (auth instanceof NextResponse) return auth;

  await deleteSprintSynced(sprint);
  return NextResponse.json({ ok: true });
}
