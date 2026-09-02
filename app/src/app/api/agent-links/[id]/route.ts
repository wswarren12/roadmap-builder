import { NextResponse } from 'next/server';
import { authorizeRoadmap, jsonError } from '@/lib/api-helpers';
import { getStore } from '@/lib/store';

export const dynamic = 'force-dynamic';

interface Params {
  params: { id: string };
}

/** Soft-revoke an agent link (owner or editor). The row stays so the activity
 *  log and past suggestion attribution survive; the token stops working. */
export async function DELETE(req: Request, { params }: Params) {
  const store = getStore();
  const link = await store.getAgentLink(params.id);
  if (!link) return jsonError(404, 'This agent link no longer exists');

  const auth = await authorizeRoadmap(req, link.roadmapId, 'write');
  if (auth instanceof NextResponse) return auth;

  await store.revokeAgentLink(link.id);
  return NextResponse.json({ ok: true });
}
