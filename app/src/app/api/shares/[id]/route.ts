import { NextResponse } from 'next/server';
import { authorizeRoadmap, jsonError } from '@/lib/api-helpers';
import { getStore } from '@/lib/store';

export const dynamic = 'force-dynamic';

/** Remove a share — revokes that person's access (owner or editor). */
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const store = getStore();
  const share = await store.getShare(params.id);
  if (!share) return jsonError(404, 'Share not found');

  const auth = await authorizeRoadmap(req, share.roadmapId, 'write');
  if (auth instanceof NextResponse) return auth;

  await store.removeShare(share.id);
  return NextResponse.json({ ok: true });
}
