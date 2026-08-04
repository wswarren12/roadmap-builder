import { randomBytes } from 'crypto';
import { NextResponse } from 'next/server';
import { authorizeRoadmap, jsonError, readJson } from '@/lib/api-helpers';
import { getStore } from '@/lib/store';
import type { ShareRole } from '@/lib/types';

export const dynamic = 'force-dynamic';

interface Params {
  params: { id: string };
}

/** Invite-link management (owner only). One active token per roadmap per
 *  role: the viewer link grants read-only access, the editor link grants
 *  edit access. The two links are created/rotated/disabled independently. */

/** The role a POST/DELETE body targets; absent role means the viewer link
 *  (backwards compatible with pre-editor clients). Invalid role → null. */
function roleFromBody(body: Record<string, unknown> | null): ShareRole | null {
  if (body === null || body.role === undefined) return 'viewer';
  return body.role === 'editor' || body.role === 'viewer' ? body.role : null;
}

export async function GET(req: Request, { params }: Params) {
  const auth = await authorizeRoadmap(req, params.id, 'owner');
  if (auth instanceof NextResponse) return auth;

  const tokens = await getStore().getInviteTokens(auth.roadmap.id);
  return NextResponse.json({ tokens });
}

/** Generate (or rotate — the old link stops working) one role's token. */
export async function POST(req: Request, { params }: Params) {
  const auth = await authorizeRoadmap(req, params.id, 'owner');
  if (auth instanceof NextResponse) return auth;

  const role = roleFromBody(await readJson(req));
  if (!role) return jsonError(400, 'Role must be "editor" or "viewer"', 'role');

  const token = randomBytes(18).toString('base64url');
  await getStore().setInviteToken(auth.roadmap.id, role, token);
  return NextResponse.json({ token, role }, { status: 201 });
}

/** Disable one role's link. Already-claimed members keep their access. */
export async function DELETE(req: Request, { params }: Params) {
  const auth = await authorizeRoadmap(req, params.id, 'owner');
  if (auth instanceof NextResponse) return auth;

  const role = roleFromBody(await readJson(req));
  if (!role) return jsonError(400, 'Role must be "editor" or "viewer"', 'role');

  await getStore().setInviteToken(auth.roadmap.id, role, null);
  return NextResponse.json({ ok: true });
}
