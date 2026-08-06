import { NextResponse } from 'next/server';
import { authorizeRoadmap, jsonError, readJson } from '@/lib/api-helpers';
import { getStore } from '@/lib/store';
import { requireNonEmpty } from '@/lib/validate';

export const dynamic = 'force-dynamic';

interface Params {
  params: { id: string };
}

/**
 * Team roster (F-13). LabOS profile images are only visible to the member
 * themselves (the member-context API returns just the caller's profile), so
 * each member's image is captured opportunistically here: whenever someone
 * loads the roster, their own entry is refreshed from their identity.
 */
export async function GET(req: Request, { params }: Params) {
  const auth = await authorizeRoadmap(req, params.id, 'read');
  if (auth instanceof NextResponse) return auth;

  const store = getStore();
  let members = await store.listTeamMembers(params.id);

  const mine = members.find((m) => m.memberUid === auth.identity.uid);
  const image = auth.identity.image ?? null;
  if (mine && image && mine.image !== image) {
    await store.updateTeamMember(mine.id, { image });
    members = await store.listTeamMembers(params.id);
  }

  return NextResponse.json({ members, role: auth.role });
}

/** Manually add a person who isn't a LabOS member — initials avatar (F-13). */
export async function POST(req: Request, { params }: Params) {
  const auth = await authorizeRoadmap(req, params.id, 'write');
  if (auth instanceof NextResponse) return auth;

  const body = await readJson(req);
  if (!body) return jsonError(400, 'Invalid JSON body');
  if (requireNonEmpty(body.name, 'name')) {
    return jsonError(400, 'Name is required', 'name');
  }

  const store = getStore();
  const name = String(body.name).trim();
  const existing = await store.listTeamMembers(params.id);
  if (existing.some((m) => m.name.toLowerCase() === name.toLowerCase())) {
    return jsonError(409, `"${name}" is already on the team`, 'name');
  }

  const member = await store.addTeamMember(params.id, { name });
  return NextResponse.json({ member }, { status: 201 });
}
