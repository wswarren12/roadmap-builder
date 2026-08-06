import { NextResponse } from 'next/server';
import { authorizeRoadmap, jsonError } from '@/lib/api-helpers';
import { getStore } from '@/lib/store';

export const dynamic = 'force-dynamic';

interface Params {
  params: { id: string };
}

/** Remove a person from the team roster (F-13). DRI text on items/sprints
 *  is left as-is — their avatar simply falls back to initials. */
export async function DELETE(req: Request, { params }: Params) {
  const store = getStore();
  const member = await store.getTeamMember(params.id);
  if (!member) return jsonError(404, 'Team member not found');

  const auth = await authorizeRoadmap(req, member.roadmapId, 'write');
  if (auth instanceof NextResponse) return auth;

  await store.removeTeamMember(member.id);
  return NextResponse.json({ ok: true });
}
