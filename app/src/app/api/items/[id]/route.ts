import { NextResponse } from 'next/server';
import { authorizeRoadmap, jsonError, readJson } from '@/lib/api-helpers';
import { ITEM_PALETTE } from '@/lib/colors';
import { getStore } from '@/lib/store';
import { updateItemSynced } from '@/lib/sync';
import type { ItemInput, ItemStatus } from '@/lib/types';
import {
  requireNonEmpty,
  roadmapSpan,
  validateCompletedDate,
  validateDatesWithin,
  validateMilestoneDate,
} from '@/lib/validate';

export const dynamic = 'force-dynamic';

interface Params {
  params: { id: string };
}

const STATUSES: ItemStatus[] = ['green', 'yellow', 'red'];

/** Item + its sprint items — the drill-down payload (F-3). */
export async function GET(req: Request, { params }: Params) {
  const store = getStore();
  const item = await store.getItem(params.id);
  if (!item) return jsonError(404, 'This item no longer exists');

  const auth = await authorizeRoadmap(req, item.roadmapId, 'read');
  if (auth instanceof NextResponse) return auth;

  const [sprints, initiative, initiatives] = await Promise.all([
    store.listSprints(item.id),
    store.getInitiative(item.initiativeId),
    store.listInitiatives(item.roadmapId),
  ]);

  return NextResponse.json({
    item,
    sprints,
    roadmap: auth.roadmap,
    initiativeName: initiative?.name ?? '',
    // Full list so the edit modal can move the item between initiatives (F-15a).
    initiatives,
    role: auth.role,
  });
}

/** Edit / drag-move / drag-resize (F-2). Validates the merged result so a
 *  partial PATCH can't slip dates outside the roadmap span (AC-2.6). */
export async function PATCH(req: Request, { params }: Params) {
  const store = getStore();
  const item = await store.getItem(params.id);
  if (!item) return jsonError(404, 'This item no longer exists');

  const auth = await authorizeRoadmap(req, item.roadmapId, 'write');
  if (auth instanceof NextResponse) return auth;

  const body = await readJson(req);
  if (!body) return jsonError(400, 'Invalid JSON body');

  if (body.title !== undefined && requireNonEmpty(body.title, 'title')) {
    return jsonError(400, 'Title is required', 'title');
  }

  const patch: Partial<ItemInput> = {};
  if (body.title !== undefined) patch.title = String(body.title).trim();
  if (body.description !== undefined) patch.description = String(body.description ?? '');
  if (body.okrs !== undefined) patch.okrs = String(body.okrs ?? '');
  if (body.dris !== undefined) patch.dris = String(body.dris ?? '');
  if (body.responsibleTeam !== undefined) patch.responsibleTeam = String(body.responsibleTeam ?? '');
  if (body.kpi !== undefined) patch.kpi = String(body.kpi ?? '');
  if (body.milestoneText !== undefined) patch.milestoneText = String(body.milestoneText ?? '');
  if (body.status !== undefined) {
    if (!STATUSES.includes(body.status as ItemStatus)) {
      return jsonError(400, 'Status must be green, yellow, or red', 'status');
    }
    patch.status = body.status as ItemStatus;
  }
  if (body.completedAt !== undefined) {
    const doneErr = validateCompletedDate(body.completedAt);
    if (doneErr) return jsonError(400, doneErr.message, doneErr.field);
    patch.completedAt = (body.completedAt as string) || null;
  }
  if (body.colorIndex !== undefined) {
    const idx = Number(body.colorIndex);
    if (!Number.isInteger(idx) || idx < 0 || idx >= ITEM_PALETTE.length) {
      return jsonError(400, 'Invalid bar color', 'colorIndex');
    }
    patch.colorIndex = idx;
  }
  if (body.initiativeId !== undefined) {
    const initiative = await store.getInitiative(String(body.initiativeId));
    if (!initiative || initiative.roadmapId !== item.roadmapId) {
      return jsonError(400, 'Initiative must belong to this roadmap', 'initiativeId');
    }
    patch.initiativeId = initiative.id;
  }

  const startDate = (body.startDate as string) ?? item.startDate;
  const endDate = (body.endDate as string) ?? item.endDate;
  const span = roadmapSpan(auth.roadmap);
  const dateErr = validateDatesWithin(
    startDate,
    endDate,
    span.start,
    span.end,
    'the roadmap date range',
  );
  if (dateErr) return jsonError(400, dateErr.message, dateErr.field);
  if (body.startDate !== undefined) patch.startDate = startDate;
  if (body.endDate !== undefined) patch.endDate = endDate;

  const milestoneDate =
    body.milestoneDate === undefined ? item.milestoneDate : (body.milestoneDate as string | null);
  const msErr = validateMilestoneDate(milestoneDate, startDate, endDate);
  if (msErr) return jsonError(400, msErr.message, msErr.field);
  if (body.milestoneDate !== undefined) patch.milestoneDate = milestoneDate || null;

  const updated = await updateItemSynced(item.id, patch);
  const sprintCount = await store.countSprints(item.id);
  return NextResponse.json({ item: { ...updated, sprintCount } });
}

/** Delete item — sprint items cascade (AC-2.5). */
export async function DELETE(req: Request, { params }: Params) {
  const store = getStore();
  const item = await store.getItem(params.id);
  if (!item) return jsonError(404, 'This item no longer exists');

  const auth = await authorizeRoadmap(req, item.roadmapId, 'write');
  if (auth instanceof NextResponse) return auth;

  await store.deleteItem(item.id);
  return NextResponse.json({ ok: true });
}
