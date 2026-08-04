import { NextResponse } from 'next/server';
import { authorizeRoadmap, jsonError, readJson } from '@/lib/api-helpers';
import { getStore } from '@/lib/store';
import { isValidEmail, normalizeEmail } from '@/lib/validate';

export const dynamic = 'force-dynamic';

interface Params {
  params: { id: string };
}

/** The share list is owner-only, both listing and mutating (PRD §9 table). */
export async function GET(req: Request, { params }: Params) {
  const auth = await authorizeRoadmap(req, params.id, 'owner');
  if (auth instanceof NextResponse) return auth;

  const shares = await getStore().listShares(auth.roadmap.id);
  return NextResponse.json({ shares });
}

export async function POST(req: Request, { params }: Params) {
  const auth = await authorizeRoadmap(req, params.id, 'owner');
  if (auth instanceof NextResponse) return auth;
  const { roadmap, identity } = auth;

  const body = await readJson(req);
  if (!body) return jsonError(400, 'Invalid JSON body');
  if (!isValidEmail(body.email)) {
    return jsonError(400, 'Enter a valid email address', 'email');
  }

  const email = normalizeEmail(body.email);

  // No-op hints (F-6 error states): own email and duplicates don't error.
  if (email === roadmap.ownerEmail || (identity.email && email === identity.email)) {
    return NextResponse.json({ noop: 'own-email', message: 'That is your own email — you already have full access' });
  }
  const store = getStore();
  const existing = await store.listShares(roadmap.id);
  if (existing.some((s) => s.email === email)) {
    return NextResponse.json({ noop: 'duplicate', message: 'That email is already on the list' });
  }

  const share = await store.addShare(roadmap.id, email);
  return NextResponse.json({ share }, { status: 201 });
}
