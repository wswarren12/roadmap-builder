import { NextResponse } from 'next/server';
import { authorizeRoadmap, jsonError, readJson } from '@/lib/api-helpers';
import { getStore } from '@/lib/store';
import { MAX_INITIATIVES, requireNonEmpty } from '@/lib/validate';

export const dynamic = 'force-dynamic';

/** Add an initiative row — server enforces the ≤5 constraint (AC-1.2). */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await authorizeRoadmap(req, params.id, 'write');
  if (auth instanceof NextResponse) return auth;

  const body = await readJson(req);
  if (!body) return jsonError(400, 'Invalid JSON body');
  if (requireNonEmpty(body.name, 'name')) {
    return jsonError(400, 'Initiative name is required', 'name');
  }

  const store = getStore();
  const existing = await store.listInitiatives(auth.roadmap.id);
  if (existing.length >= MAX_INITIATIVES) {
    return jsonError(400, `Max ${MAX_INITIATIVES} initiatives per roadmap`, 'name');
  }

  const initiative = await store.createInitiative(auth.roadmap.id, String(body.name).trim());
  return NextResponse.json({ initiative }, { status: 201 });
}
