import { NextResponse } from 'next/server';
import { checkRateLimit } from './agent-links/rate-limit';
import { resolveIdentity } from './auth';
import { getStore } from './store';
import type { AgentLink, AgentRole, Identity, Roadmap, Role } from './types';

export function jsonError(status: number, error: string, field?: string) {
  return NextResponse.json(field ? { error, field } : { error }, { status });
}

export const ERR_UNAUTHENTICATED = 'Not signed in — open this app from the LabOS AI Apps dashboard';
export const ERR_FORBIDDEN = "You don't have access — ask the owner to share this roadmap";

/**
 * Authorization core (PRD §9): one resolver computes the caller's role for a
 * roadmap; every route declares the tier it requires. `read` = any granted
 * role; `write` = owner or editor (content changes); `owner` = owner only
 * (sharing, invites, deletion). Enforced server-side on every route — hidden
 * buttons are not authorization.
 */
export async function roleForRoadmap(
  identity: Identity,
  roadmap: Roadmap,
): Promise<Role> {
  if (roadmap.ownerUid === identity.uid) return 'owner';
  const shares = await getStore().listShares(roadmap.id);
  // Primary: uid claimed via invite link. Fallback: email whitelist (dormant
  // in production until LabOS exposes member email). The strongest matching
  // grant wins, so a stale viewer row never masks an editor grant.
  const mine = shares.filter(
    (s) =>
      s.memberUid === identity.uid ||
      (identity.email !== null && s.email === identity.email),
  );
  if (mine.some((s) => s.role === 'editor')) return 'editor';
  if (mine.length > 0) return 'viewer';
  return 'none';
}

export interface AuthedRoadmap {
  identity: Identity;
  roadmap: Roadmap;
  role: Role;
}

/**
 * Resolve identity + roadmap + role, returning an error response when the
 * caller doesn't meet `required`. Usage:
 *   const r = await authorizeRoadmap(req, roadmapId, 'write');
 *   if (r instanceof NextResponse) return r;
 */
export async function authorizeRoadmap(
  req: Request,
  roadmapId: string,
  required: 'read' | 'write' | 'owner',
): Promise<AuthedRoadmap | NextResponse> {
  const identity = await resolveIdentity(req);
  if (!identity) return jsonError(401, ERR_UNAUTHENTICATED);

  const roadmap = await getStore().getRoadmap(roadmapId);
  if (!roadmap) return jsonError(404, 'Roadmap not found');

  const role = await roleForRoadmap(identity, roadmap);
  if (role === 'none') return jsonError(403, ERR_FORBIDDEN);
  if (required === 'write' && role !== 'owner' && role !== 'editor') {
    return jsonError(403, 'Read-only access — ask the owner for an editor invite to make changes');
  }
  if (required === 'owner' && role !== 'owner') {
    return jsonError(403, 'Only the owner can do this');
  }
  return { identity, roadmap, role };
}

export type AgentTier = 'read' | 'suggest' | 'write';

export interface AuthedAgent {
  link: AgentLink;
  roadmap: Roadmap;
}

const AGENT_TIER: Record<AgentTier, AgentRole[]> = {
  read: ['agent_viewer', 'agent_suggester', 'agent_editor'],
  suggest: ['agent_suggester', 'agent_editor'],
  write: ['agent_editor'],
};

/**
 * Agent-link counterpart to authorizeRoadmap (agent-links design): the URL
 * token is the whole credential. Unknown and revoked tokens both 404 so a
 * revoked link can't be used to confirm the roadmap exists. Every authorized
 * call bumps last_used_at and counts against the per-token rate limit.
 */
export async function authorizeAgent(
  token: string,
  required: AgentTier,
): Promise<AuthedAgent | NextResponse> {
  const retryAfter = checkRateLimit(token);
  if (retryAfter !== null) {
    return NextResponse.json(
      { error: 'Rate limit exceeded', retry_after: retryAfter },
      { status: 429, headers: { 'retry-after': String(retryAfter) } },
    );
  }
  const link = await getStore().findAgentLinkByToken(token);
  if (!link || link.revokedAt) return jsonError(404, 'Not found');
  if (!AGENT_TIER[required].includes(link.role)) {
    return jsonError(403, `This agent link has ${link.role.replace('agent_', '')} access only`);
  }
  const roadmap = await getStore().getRoadmap(link.roadmapId);
  if (!roadmap) return jsonError(404, 'Not found');
  await getStore().touchAgentLink(link.id);
  return { link, roadmap };
}

export async function requireIdentity(req: Request): Promise<Identity | NextResponse> {
  const identity = await resolveIdentity(req);
  if (!identity) return jsonError(401, ERR_UNAUTHENTICATED);
  return identity;
}

export async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json();
    return body && typeof body === 'object' ? body : null;
  } catch {
    return null;
  }
}
