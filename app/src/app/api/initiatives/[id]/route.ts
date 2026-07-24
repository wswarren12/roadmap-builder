import { NextResponse } from 'next/server';
import { authorizeRoadmap, jsonError, readJson } from '@/lib/api-helpers';
import { getStore } from '@/lib/store';
import { requireNonEmpty } from '@/lib/validate';

export const dynamic = 'force-dynamic';

interface Params {
  params: { id: string };
}

/** Rename / reorder an initiative row. */
export async function PATCH(req: Request, { params }: Params) {
  const store = getStore();
  const initiative = await store.getInitiative(params.id);
  if (!initiative) return jsonError(404, 'Initiative not found');

  const auth = await authorizeRoadmap(req, initiative.roadmapId, 'write');
  if (auth instanceof NextResponse) return auth;

  const body = await readJson(req);
  if (!body) return jsonError(400, 'Invalid JSON body');

  if (body.name !== undefined) {
    if (requireNonEmpty(body.name, 'name')) {
      return jsonError(400, 'Initiative name is required', 'name');
    }
    await store.updateInitiative(initiative.id, { name: String(body.name).trim() });
  }

  if (body.position !== undefined) {
    const target = Number(body.position);
    if (!Number.isInteger(target) || target < 1) {
      return jsonError(400, 'Invalid position', 'position');
    }
    // Reorder: remove, insert at target index, renumber sequentially. A temp
    // offset pass avoids UNIQUE(roadmap_id, position) collisions in Postgres.
    const rows = await store.listInitiatives(initiative.roadmapId);
    const rest = rows.filter((r) => r.id !== initiative.id);
    rest.splice(Math.min(target - 1, rest.length), 0, initiative);
    for (let i = 0; i < rest.length; i++) {
      await store.updateInitiative(rest[i].id, { position: 100 + i });
    }
    for (let i = 0; i < rest.length; i++) {
      await store.updateInitiative(rest[i].id, { position: i + 1 });
    }
  }

  const updated = await store.getInitiative(initiative.id);
  return NextResponse.json({ initiative: updated });
}

/** Delete a row — blocked while it still has items (F-1 error states). */
export async function DELETE(req: Request, { params }: Params) {
  const store = getStore();
  const initiative = await store.getInitiative(params.id);
  if (!initiative) return jsonError(404, 'Initiative not found');

  const auth = await authorizeRoadmap(req, initiative.roadmapId, 'write');
  if (auth instanceof NextResponse) return auth;

  const itemCount = await store.countItemsInInitiative(initiative.id);
  if (itemCount > 0) {
    return jsonError(409, "Move or delete this initiative's items first");
  }

  await store.deleteInitiative(initiative.id);
  return NextResponse.json({ ok: true });
}
