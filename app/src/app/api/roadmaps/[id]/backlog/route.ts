import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { authorizeRoadmap, jsonError, readJson, roleForRoadmap } from '@/lib/api-helpers';
import { directBacklogPayload, itemToBacklogPayload } from '@/lib/backlog';
import { getStore } from '@/lib/store';
import { isItemStatus, type BacklogItemInput, type RoadmapBacklogItem } from '@/lib/types';
import { requireNonEmpty } from '@/lib/validate';

export const dynamic = 'force-dynamic';

interface Params {
  params: { id: string };
}

/**
 * Roadmap backlog: unscheduled items scoped to ONE roadmap (Backlog view and
 * the board's Backlog column). Stored as a JSONB array on the roadmap row;
 * every mutation is a server-side read-modify-write under the roadmap's write
 * tier, and ids are only ever looked up inside the open roadmap's own array,
 * so a cross-roadmap id is simply "not found".
 * ponytail: last-writer-wins between two editors mutating the same backlog
 * in the same instant; move to a table if that ever bites.
 */
const TEXT_KEYS = ['description', 'milestoneText', 'okrs', 'dris', 'responsibleTeam', 'kpi'] as const;

function inputFrom(body: Record<string, unknown>, current?: RoadmapBacklogItem): BacklogItemInput {
  const out: BacklogItemInput = {
    title: current?.title ?? '',
    description: current?.description ?? '',
    milestoneText: current?.milestoneText ?? '',
    okrs: current?.okrs ?? '',
    dris: current?.dris ?? '',
    responsibleTeam: current?.responsibleTeam ?? '',
    status: current?.status ?? 'green',
    kpi: current?.kpi ?? '',
    colorIndex: current?.colorIndex ?? 0,
  };
  if (typeof body.title === 'string') out.title = body.title.trim();
  for (const key of TEXT_KEYS) if (typeof body[key] === 'string') out[key] = (body[key] as string).trim();
  if (isItemStatus(body.status)) out.status = body.status;
  if (Number.isInteger(body.colorIndex)) out.colorIndex = Math.max(0, Number(body.colorIndex));
  return out;
}

export async function GET(req: Request, { params }: Params) {
  const auth = await authorizeRoadmap(req, params.id, 'read');
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json({ backlog: auth.roadmap.backlog, role: auth.role });
}

/**
 * Create an entry. Two shapes:
 *  - `{ title, ... }`   — a new unscheduled item (write tier)
 *  - `{ fromItemId }`   — move a scheduled item of THIS roadmap into the
 *                          backlog: full payload kept, dates scrubbed, the
 *                          item (and only this linked copy) removed. Owner
 *                          only, like the personal move it mirrors.
 */
export async function POST(req: Request, { params }: Params) {
  const auth = await authorizeRoadmap(req, params.id, 'write');
  if (auth instanceof NextResponse) return auth;
  const body = await readJson(req);
  if (!body) return jsonError(400, 'Invalid JSON body');
  const store = getStore();

  let entry: RoadmapBacklogItem;
  if (typeof body.fromItemId === 'string') {
    if ((await roleForRoadmap(auth.identity, auth.roadmap)) !== 'owner') {
      return jsonError(403, 'Only the owner can move items to the backlog');
    }
    const source = await store.getItem(body.fromItemId);
    if (!source || source.roadmapId !== auth.roadmap.id) {
      return jsonError(404, 'Roadmap item not found on this roadmap');
    }
    entry = {
      id: randomUUID(),
      ...itemToBacklogPayload(source, await store.listSprints(source.id)),
      createdAt: new Date().toISOString(),
    };
    // ponytail: append then delete — a failure between leaves the item in
    // both places (visible, fixable), never in neither.
    await store.updateRoadmap(auth.roadmap.id, { backlog: [...auth.roadmap.backlog, entry] });
    await store.deleteItem(source.id);
  } else {
    if (requireNonEmpty(body.title, 'title')) return jsonError(400, 'Title is required', 'title');
    entry = {
      id: randomUUID(),
      ...directBacklogPayload(inputFrom(body)),
      createdAt: new Date().toISOString(),
    };
    await store.updateRoadmap(auth.roadmap.id, { backlog: [...auth.roadmap.backlog, entry] });
  }
  const roadmap = await store.getRoadmap(auth.roadmap.id);
  return NextResponse.json({ item: entry, backlog: roadmap?.backlog ?? [] }, { status: 201 });
}

export async function PATCH(req: Request, { params }: Params) {
  const auth = await authorizeRoadmap(req, params.id, 'write');
  if (auth instanceof NextResponse) return auth;
  const body = await readJson(req);
  if (!body) return jsonError(400, 'Invalid JSON body');
  const current = auth.roadmap.backlog.find((b) => b.id === body.id);
  if (!current) return jsonError(404, 'Backlog item not found');
  if (body.title !== undefined && requireNonEmpty(body.title, 'title')) {
    return jsonError(400, 'Title is required', 'title');
  }

  const item: RoadmapBacklogItem = { ...current, ...inputFrom(body, current) };
  const roadmap = await getStore().updateRoadmap(auth.roadmap.id, {
    backlog: auth.roadmap.backlog.map((b) => (b.id === item.id ? item : b)),
  });
  return NextResponse.json({ item, backlog: roadmap.backlog });
}

/** Remove an entry — on delete, and after scheduling creates the real item. */
export async function DELETE(req: Request, { params }: Params) {
  const auth = await authorizeRoadmap(req, params.id, 'write');
  if (auth instanceof NextResponse) return auth;
  const id = new URL(req.url).searchParams.get('id');
  if (!id || !auth.roadmap.backlog.some((b) => b.id === id)) {
    return jsonError(404, 'Backlog item not found');
  }
  const roadmap = await getStore().updateRoadmap(auth.roadmap.id, {
    backlog: auth.roadmap.backlog.filter((b) => b.id !== id),
  });
  return NextResponse.json({ backlog: roadmap.backlog });
}
