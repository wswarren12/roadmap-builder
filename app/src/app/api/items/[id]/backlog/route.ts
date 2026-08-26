import { NextResponse } from 'next/server';
import { authorizeRoadmap, jsonError } from '@/lib/api-helpers';
import { getStore } from '@/lib/store';

export const dynamic = 'force-dynamic';
interface Params { params: { id: string } }

export async function POST(req: Request, { params }: Params) {
  const store = getStore();
  const source = await store.getItem(params.id);
  if (!source) return jsonError(404, 'Roadmap item not found');
  const auth = await authorizeRoadmap(req, source.roadmapId, 'owner');
  if (auth instanceof NextResponse) return auth;
  const item = await store.moveItemToBacklog(source.id, auth.identity.uid);
  return NextResponse.json({ item }, { status: 201 });
}
