import { NextResponse } from 'next/server';
import { authorizeRoadmap, jsonError, readJson } from '@/lib/api-helpers';
import { getStore } from '@/lib/store';
import { createSprintSynced } from '@/lib/sync';
import type { SprintInput } from '@/lib/types';
import {
  requireNonEmpty,
  validateDatesWithin,
  validateMilestoneDate,
} from '@/lib/validate';

export const dynamic = 'force-dynamic';

/** Create a sprint item (F-4) — dates constrained to the parent item's span (AC-4.4). */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const store = getStore();
  const item = await store.getItem(params.id);
  if (!item) return jsonError(404, 'This item no longer exists');

  const auth = await authorizeRoadmap(req, item.roadmapId, 'write');
  if (auth instanceof NextResponse) return auth;

  const body = await readJson(req);
  if (!body) return jsonError(400, 'Invalid JSON body');
  if (requireNonEmpty(body.name, 'name')) {
    return jsonError(400, 'Name is required', 'name');
  }

  const dateErr = validateDatesWithin(
    body.startDate,
    body.endDate,
    item.startDate,
    item.endDate,
    "the parent item's timeline",
  );
  if (dateErr) return jsonError(400, dateErr.message, dateErr.field);

  const msErr = validateMilestoneDate(
    body.milestoneDate ?? null,
    body.startDate as string,
    body.endDate as string,
  );
  if (msErr) return jsonError(400, msErr.message, msErr.field);

  const input: SprintInput = {
    name: String(body.name).trim(),
    description: typeof body.description === 'string' ? body.description : '',
    startDate: body.startDate as string,
    endDate: body.endDate as string,
    milestoneText: typeof body.milestoneText === 'string' ? body.milestoneText : '',
    milestoneDate: (body.milestoneDate as string) || null,
    kpi: typeof body.kpi === 'string' ? body.kpi : '',
    dri: typeof body.dri === 'string' ? body.dri : '',
  };

  const sprint = await createSprintSynced(item, input);
  return NextResponse.json({ sprint }, { status: 201 });
}
