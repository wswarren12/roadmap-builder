import { randomBytes } from 'crypto';
import { NextResponse } from 'next/server';
import { authorizeRoadmap, jsonError, readJson } from '@/lib/api-helpers';
import { getStore } from '@/lib/store';
import type { AgentRole } from '@/lib/types';

export const dynamic = 'force-dynamic';

interface Params {
  params: { id: string };
}

const AGENT_ROLES: AgentRole[] = ['agent_viewer', 'agent_suggester', 'agent_editor'];

/** Agent-link management (owner only). Unlike invite links, each link is an
 *  independent named row — many can coexist and are revoked individually. */

/** Links + a peek of recent activity for the share dialog. The token is
 *  included: the owner needs the full /agent/<token> URL to hand out. */
export async function GET(req: Request, { params }: Params) {
  const auth = await authorizeRoadmap(req, params.id, 'owner');
  if (auth instanceof NextResponse) return auth;

  const store = getStore();
  const links = await store.listAgentLinks(auth.roadmap.id);
  const withActivity = await Promise.all(
    links.map(async (link) => ({
      ...link,
      activity: await store.listAgentActivity(link.id, 5),
    })),
  );
  return NextResponse.json({ links: withActivity });
}

/** Create a named link. Role defaults to suggester — the safest useful tier. */
export async function POST(req: Request, { params }: Params) {
  const auth = await authorizeRoadmap(req, params.id, 'owner');
  if (auth instanceof NextResponse) return auth;

  const body = await readJson(req);
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!name) return jsonError(400, 'Give the agent link a name (e.g. the agent it is for)', 'name');

  const role = (body?.role ?? 'agent_suggester') as AgentRole;
  if (!AGENT_ROLES.includes(role)) {
    return jsonError(400, `Role must be one of: ${AGENT_ROLES.join(', ')}`, 'role');
  }

  const token = randomBytes(18).toString('base64url');
  const link = await getStore().createAgentLink(auth.roadmap.id, name, role, token);
  return NextResponse.json({ link }, { status: 201 });
}
