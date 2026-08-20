import { NextResponse } from 'next/server';
import { authorizeRoadmap, jsonError, readJson } from '@/lib/api-helpers';
import { ITEM_PALETTE } from '@/lib/colors';
import { getStore } from '@/lib/store';
import type { ItemInput, ItemStatus } from '@/lib/types';
import {
  requireNonEmpty,
  roadmapSpan,
  validateCompletedDate,
  validateDatesWithin,
  validateMilestoneDate,
} from '@/lib/validate';

export const dynamic = 'force-dynamic';

const STATUSES: ItemStatus[] = ['green', 'yellow', 'red'];

/** Create a roadmap item (F-2). Color index is assigned deterministically:
 *  count of existing items % palette length (PRD §9). */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await authorizeRoadmap(req, params.id, 'write');
  if (auth instanceof NextResponse) return auth;
  const { roadmap } = auth;

  const body = await readJson(req);
  if (!body) return jsonError(400, 'Invalid JSON body');
  if (requireNonEmpty(body.title, 'title')) {
    return jsonError(400, 'Title is required', 'title');
  }

  const store = getStore();
  const initiative =
    typeof body.initiativeId === 'string'
      ? await store.getInitiative(body.initiativeId)
      : null;
  if (!initiative || initiative.roadmapId !== roadmap.id) {
    return jsonError(400, 'Item must belong to an initiative on this roadmap', 'initiativeId');
  }

  const span = roadmapSpan(roadmap);
  const dateErr = validateDatesWithin(
    body.startDate,
    body.endDate,
    span.start,
    span.end,
    'the roadmap date range',
  );
  if (dateErr) return jsonError(400, dateErr.message, dateErr.field);

  const msErr = validateMilestoneDate(
    body.milestoneDate ?? null,
    body.startDate as string,
    body.endDate as string,
  );
  if (msErr) return jsonError(400, msErr.message, msErr.field);

  const status = STATUSES.includes(body.status as ItemStatus)
    ? (body.status as ItemStatus)
    : 'green';

  const doneErr = validateCompletedDate(body.completedAt ?? null);
  if (doneErr) return jsonError(400, doneErr.message, doneErr.field);

  // Chosen palette hue, else deterministic cycling assignment.
  const chosenIdx = body.colorIndex === undefined ? undefined : Number(body.colorIndex);
  if (
    chosenIdx !== undefined &&
    (!Number.isInteger(chosenIdx) || chosenIdx < 0 || chosenIdx >= ITEM_PALETTE.length)
  ) {
    return jsonError(400, 'Invalid bar color', 'colorIndex');
  }
  const colorIndex =
    chosenIdx !== undefined ? chosenIdx : (await store.countItems(roadmap.id)) % ITEM_PALETTE.length;
  const input: ItemInput = {
    initiativeId: initiative.id,
    title: String(body.title).trim(),
    description: typeof body.description === 'string' ? body.description : '',
    startDate: body.startDate as string,
    endDate: body.endDate as string,
    milestoneText: typeof body.milestoneText === 'string' ? body.milestoneText : '',
    milestoneDate: (body.milestoneDate as string) || null,
    okrs: typeof body.okrs === 'string' ? body.okrs : '',
    dris: typeof body.dris === 'string' ? body.dris : '',
    responsibleTeam: typeof body.responsibleTeam === 'string' ? body.responsibleTeam : '',
    status,
    kpi: typeof body.kpi === 'string' ? body.kpi : '',
    completedAt: (body.completedAt as string) || null,
  };

  const item = await store.createItem(roadmap.id, input, colorIndex);
  return NextResponse.json({ item: { ...item, sprintCount: 0 } }, { status: 201 });
}
