import { NextResponse } from 'next/server';
import { jsonError, readJson, requireIdentity } from '@/lib/api-helpers';
import { getStore } from '@/lib/store';
import type { BacklogItemInput } from '@/lib/types';

export const dynamic = 'force-dynamic';
interface Params { params: { id: string } }

export async function GET(req: Request, { params }: Params) {
  const identity = await requireIdentity(req);
  if (identity instanceof NextResponse) return identity;
  const item = await getStore().getBacklogItem(params.id, identity.uid);
  return item ? NextResponse.json({ item }) : jsonError(404, 'Backlog item not found');
}

export async function PATCH(req: Request, { params }: Params) {
  const identity = await requireIdentity(req);
  if (identity instanceof NextResponse) return identity;
  const store = getStore();
  if (!(await store.getBacklogItem(params.id, identity.uid))) {
    return jsonError(404, 'Backlog item not found');
  }
  const body = await readJson(req);
  if (!body) return jsonError(400, 'Invalid JSON body');
  if (body.title !== undefined && (typeof body.title !== 'string' || !body.title.trim())) {
    return jsonError(400, 'Title is required', 'title');
  }
  const patch: Partial<BacklogItemInput> = {};
  for (const key of ['description', 'milestoneText', 'okrs', 'dris', 'responsibleTeam', 'kpi'] as const) {
    if (typeof body[key] === 'string') patch[key] = body[key] as never;
  }
  if (typeof body.title === 'string') patch.title = body.title.trim();
  if (body.status === 'green' || body.status === 'yellow' || body.status === 'red') patch.status = body.status;
  if (Number.isInteger(body.colorIndex)) patch.colorIndex = Math.max(0, Number(body.colorIndex));
  const item = await store.updateBacklogItem(params.id, identity.uid, patch);
  return NextResponse.json({ item });
}

export async function DELETE(req: Request, { params }: Params) {
  const identity = await requireIdentity(req);
  if (identity instanceof NextResponse) return identity;
  const deleted = await getStore().deleteBacklogItem(params.id, identity.uid);
  return deleted ? new NextResponse(null, { status: 204 }) : jsonError(404, 'Backlog item not found');
}
