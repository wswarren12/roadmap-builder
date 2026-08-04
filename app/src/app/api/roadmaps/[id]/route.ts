import { NextResponse } from 'next/server';
import { authorizeRoadmap, jsonError, readJson } from '@/lib/api-helpers';
import { getStore } from '@/lib/store';
import { toUTC } from '@/lib/dates';
import {
  requireNonEmpty,
  roadmapSpan,
  validateRoadmapRange,
} from '@/lib/validate';

export const dynamic = 'force-dynamic';

interface Params {
  params: { id: string };
}

/** Full roadmap payload: roadmap + initiatives + items (+ per-item sprint
 *  counts for cascade confirms) + caller role. Updates last-visited (F-5). */
export async function GET(req: Request, { params }: Params) {
  const auth = await authorizeRoadmap(req, params.id, 'read');
  if (auth instanceof NextResponse) return auth;
  const { identity, roadmap, role } = auth;

  const store = getStore();
  const [initiatives, items] = await Promise.all([
    store.listInitiatives(roadmap.id),
    store.listItems(roadmap.id),
  ]);
  const sprintCounts = await Promise.all(items.map((i) => store.countSprints(i.id)));

  await store.setLastRoadmap(identity.uid, roadmap.id);

  return NextResponse.json({
    roadmap,
    initiatives,
    items: items.map((item, idx) => ({ ...item, sprintCount: sprintCounts[idx] })),
    role,
  });
}

/** Update header fields (title / description / date range). */
export async function PATCH(req: Request, { params }: Params) {
  const auth = await authorizeRoadmap(req, params.id, 'write');
  if (auth instanceof NextResponse) return auth;
  const { roadmap } = auth;

  const body = await readJson(req);
  if (!body) return jsonError(400, 'Invalid JSON body');

  const patch: Record<string, string> = {};
  if (body.title !== undefined) {
    if (requireNonEmpty(body.title, 'title')) {
      return jsonError(400, 'Title is required', 'title');
    }
    patch.title = String(body.title).trim();
  }
  if (body.description !== undefined) {
    patch.description = typeof body.description === 'string' ? body.description : '';
  }

  const startMonth = (body.startMonth as string) ?? roadmap.startMonth;
  const endMonth = (body.endMonth as string) ?? roadmap.endMonth;
  if (body.startMonth !== undefined || body.endMonth !== undefined) {
    const rangeErr = validateRoadmapRange(startMonth, endMonth);
    if (rangeErr) return jsonError(400, rangeErr.message, rangeErr.field);

    // Shrinking the range must not strand existing bars outside it.
    const span = roadmapSpan({ startMonth, endMonth });
    const items = await getStore().listItems(roadmap.id);
    const stranded = items.find(
      (i) => toUTC(i.startDate) < toUTC(span.start) || toUTC(i.endDate) > toUTC(span.end),
    );
    if (stranded) {
      return jsonError(
        400,
        `"${stranded.title}" falls outside the new range — move or delete it first`,
        'endMonth',
      );
    }
    patch.startMonth = startMonth;
    patch.endMonth = endMonth;
  }

  const updated = await getStore().updateRoadmap(roadmap.id, patch);
  return NextResponse.json({ roadmap: updated });
}

/** Cascade delete (items, sprints, shares go with it). Owner only. */
export async function DELETE(req: Request, { params }: Params) {
  const auth = await authorizeRoadmap(req, params.id, 'owner');
  if (auth instanceof NextResponse) return auth;

  await getStore().deleteRoadmap(auth.roadmap.id);
  return NextResponse.json({ ok: true });
}
