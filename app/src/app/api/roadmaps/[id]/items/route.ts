import { NextResponse } from 'next/server';
import { authorizeRoadmap, jsonError, readJson } from '@/lib/api-helpers';
import { backlogToRoadmapInputs } from '@/lib/backlog';
import { ITEM_PALETTE } from '@/lib/colors';
import { getStore } from '@/lib/store';
import { resolveAssignment } from '@/lib/assignment';
import { isItemStatus, type ItemInput, type ItemStatus } from '@/lib/types';
import {
  requireNonEmpty,
  roadmapSpan,
  validateCompletedDate,
  validateDatesWithin,
  validateMilestoneDate,
} from '@/lib/validate';

export const dynamic = 'force-dynamic';

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

  const status: ItemStatus = isItemStatus(body.status) ? body.status : 'green';

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

  // Scheduling a backlog entry of THIS roadmap: the entry must exist here
  // (a foreign id is not found), its sprints are rebuilt at their relative
  // positions inside the new dates, and the entry is consumed last.
  const entry =
    typeof body.fromBacklogId === 'string'
      ? roadmap.backlog.find((b) => b.id === body.fromBacklogId)
      : undefined;
  if (typeof body.fromBacklogId === 'string' && !entry) {
    return jsonError(404, 'Backlog item not found on this roadmap');
  }

  // DRI / responsible team resolve to LabOS identities (F-13b).
  const assigned = await resolveAssignment(store, roadmap.id, body);
  if ('error' in assigned) return jsonError(400, assigned.error.message, assigned.error.field);
  Object.assign(input, assigned.patch);

  const item = await store.createItem(roadmap.id, input, colorIndex);
  if (!entry) return NextResponse.json({ item: { ...item, sprintCount: 0 } }, { status: 201 });

  const { sprints } = backlogToRoadmapInputs(
    { ...entry, ownerUid: '', updatedAt: entry.createdAt },
    { roadmapId: roadmap.id, initiativeId: initiative.id, startDate: input.startDate, endDate: input.endDate, colorIndex },
  );
  for (const sprint of sprints) await store.createSprint(item.id, sprint);
  // ponytail: item first, entry removal last — a failure leaves a visible
  // duplicate to delete, never lost work.
  await store.updateRoadmap(roadmap.id, { backlog: roadmap.backlog.filter((b) => b.id !== entry.id) });
  return NextResponse.json({ item: { ...item, sprintCount: sprints.length } }, { status: 201 });
}
