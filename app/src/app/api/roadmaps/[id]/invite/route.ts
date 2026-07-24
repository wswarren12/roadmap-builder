import { randomBytes } from 'crypto';
import { NextResponse } from 'next/server';
import { authorizeRoadmap } from '@/lib/api-helpers';
import { getStore } from '@/lib/store';

export const dynamic = 'force-dynamic';

interface Params {
  params: { id: string };
}

/** Invite-link management (owner only). One active token per roadmap. */
export async function GET(req: Request, { params }: Params) {
  const auth = await authorizeRoadmap(req, params.id, 'write');
  if (auth instanceof NextResponse) return auth;

  const token = await getStore().getInviteToken(auth.roadmap.id);
  return NextResponse.json({ token });
}

/** Generate (or rotate — the old link stops working) the invite token. */
export async function POST(req: Request, { params }: Params) {
  const auth = await authorizeRoadmap(req, params.id, 'write');
  if (auth instanceof NextResponse) return auth;

  const token = randomBytes(18).toString('base64url');
  await getStore().setInviteToken(auth.roadmap.id, token);
  return NextResponse.json({ token }, { status: 201 });
}

/** Disable the invite link. Already-claimed viewers keep their access. */
export async function DELETE(req: Request, { params }: Params) {
  const auth = await authorizeRoadmap(req, params.id, 'write');
  if (auth instanceof NextResponse) return auth;

  await getStore().setInviteToken(auth.roadmap.id, null);
  return NextResponse.json({ ok: true });
}
