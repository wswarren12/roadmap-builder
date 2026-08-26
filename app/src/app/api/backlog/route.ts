import { NextResponse } from 'next/server';
import { jsonError, readJson, requireIdentity } from '@/lib/api-helpers';
import { getStore } from '@/lib/store';
import type { BacklogItemInput, ItemStatus } from '@/lib/types';
import { requireNonEmpty } from '@/lib/validate';

export const dynamic = 'force-dynamic';

function inputFrom(body: Record<string, unknown>): BacklogItemInput {
  const status: ItemStatus = body.status === 'yellow' || body.status === 'red' ? body.status : 'green';
  return {
    title: String(body.title).trim(),
    description: typeof body.description === 'string' ? body.description : '',
    milestoneText: typeof body.milestoneText === 'string' ? body.milestoneText : '',
    okrs: typeof body.okrs === 'string' ? body.okrs : '',
    dris: typeof body.dris === 'string' ? body.dris : '',
    responsibleTeam: typeof body.responsibleTeam === 'string' ? body.responsibleTeam : '',
    status,
    kpi: typeof body.kpi === 'string' ? body.kpi : '',
    colorIndex: Number.isInteger(body.colorIndex) ? Math.max(0, Number(body.colorIndex)) : 0,
  };
}

export async function GET(req: Request) {
  const identity = await requireIdentity(req);
  if (identity instanceof NextResponse) return identity;
  return NextResponse.json({ items: await getStore().listBacklogItems(identity.uid) });
}

export async function POST(req: Request) {
  const identity = await requireIdentity(req);
  if (identity instanceof NextResponse) return identity;
  const body = await readJson(req);
  if (!body) return jsonError(400, 'Invalid JSON body');
  if (requireNonEmpty(body.title, 'title')) return jsonError(400, 'Title is required', 'title');
  const item = await getStore().createBacklogItem(identity.uid, inputFrom(body));
  return NextResponse.json({ item }, { status: 201 });
}
