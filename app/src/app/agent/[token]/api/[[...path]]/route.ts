import { NextResponse } from 'next/server';
import {
  authorizeAgent,
  jsonError,
  readJson,
  type AgentTier,
  type AuthedAgent,
} from '@/lib/api-helpers';
import {
  AGENT_RATE_LIMIT,
  MAX_PENDING_SUGGESTIONS,
} from '@/lib/agent-links/rate-limit';
import { SUGGESTION_KINDS, validateSuggestion } from '@/lib/agent-links/suggestions';
import { executeAgentTool } from '@/lib/agent/tools';
import { getStore } from '@/lib/store';
import type { SuggestionKind } from '@/lib/types';

export const dynamic = 'force-dynamic';

interface Params {
  params: { token: string; path?: string[] };
}

/**
 * The whole agent API lives in this contained catch-all (agent-links design):
 * every request under /agent/<token>/api/... passes through authorizeAgent
 * (revocation + tier + rate limit) and is logged to agent_activity. The
 * capability manifest at the root makes the surface self-documenting — an
 * LLM agent can operate from the URL alone.
 */

type RouteMatch =
  | { kind: 'manifest' }
  | { kind: 'roadmap' }
  | { kind: 'suggestions_list' }
  | { kind: 'suggestions_create' }
  | { kind: 'tool'; tool: string; extra: Record<string, unknown>; created: boolean }
  | { kind: 'delete_item'; id: string }
  | { kind: 'delete_sprint'; id: string };

function matchRoute(method: string, path: string[]): { match: RouteMatch; tier: AgentTier } | null {
  const [a, b, c] = path;
  if (method === 'GET' && path.length === 0) return { match: { kind: 'manifest' }, tier: 'read' };
  if (method === 'GET' && a === 'roadmap' && path.length === 1) {
    return { match: { kind: 'roadmap' }, tier: 'read' };
  }
  if (a === 'suggestions' && path.length === 1) {
    if (method === 'GET') return { match: { kind: 'suggestions_list' }, tier: 'suggest' };
    if (method === 'POST') return { match: { kind: 'suggestions_create' }, tier: 'suggest' };
  }
  if (method === 'POST' && a === 'initiatives' && path.length === 1) {
    return { match: { kind: 'tool', tool: 'create_initiative', extra: {}, created: true }, tier: 'write' };
  }
  if (method === 'POST' && a === 'items' && path.length === 1) {
    return { match: { kind: 'tool', tool: 'create_item', extra: {}, created: true }, tier: 'write' };
  }
  if (method === 'PATCH' && a === 'items' && b && path.length === 2) {
    return { match: { kind: 'tool', tool: 'update_item', extra: { itemId: b }, created: false }, tier: 'write' };
  }
  if (method === 'DELETE' && a === 'items' && b && path.length === 2) {
    return { match: { kind: 'delete_item', id: b }, tier: 'write' };
  }
  if (method === 'POST' && a === 'items' && b && c === 'sprints' && path.length === 3) {
    return { match: { kind: 'tool', tool: 'create_sprint', extra: { itemId: b }, created: true }, tier: 'write' };
  }
  if (method === 'PATCH' && a === 'sprints' && b && path.length === 2) {
    return { match: { kind: 'tool', tool: 'update_sprint', extra: { sprintId: b }, created: false }, tier: 'write' };
  }
  if (method === 'DELETE' && a === 'sprints' && b && path.length === 2) {
    return { match: { kind: 'delete_sprint', id: b }, tier: 'write' };
  }
  return null;
}

function manifest(origin: string, token: string, auth: AuthedAgent) {
  const base = `${origin}/agent/${token}/api`;
  const { link, roadmap } = auth;
  const capabilities: Record<string, unknown> = {
    read_roadmap: {
      method: 'GET',
      url: `${base}/roadmap`,
      description:
        'Full roadmap state: initiatives, items (dates, status, DRIs, sprints), and team roster in one payload.',
    },
  };
  if (link.role === 'agent_suggester' || link.role === 'agent_editor') {
    capabilities.create_suggestion = {
      method: 'POST',
      url: `${base}/suggestions`,
      description:
        'Propose a change for human review. Nothing changes until the owner accepts it in the app.',
      body_schema: {
        kind: SUGGESTION_KINDS,
        target_id: 'uuid of the item/sprint being modified; null for creates and comments',
        payload:
          'object — same field shapes as the corresponding human PATCH/POST bodies (dates are YYYY-MM-DD; create_sprint payloads include itemId)',
        rationale: 'string (required) — explain why, shown to the reviewer',
      },
    };
    capabilities.list_suggestions = {
      method: 'GET',
      url: `${base}/suggestions`,
      description: 'Your filed suggestions with their accept/reject outcomes.',
    };
  }
  if (link.role === 'agent_editor') {
    capabilities.create_initiative = { method: 'POST', url: `${base}/initiatives`, body_schema: { name: 'string' } };
    capabilities.create_item = {
      method: 'POST',
      url: `${base}/items`,
      body_schema: {
        initiativeId: 'uuid', title: 'string', startDate: 'YYYY-MM-DD', endDate: 'YYYY-MM-DD',
        description: 'string?', dris: 'string?', status: 'green|yellow|red?', okrs: 'string?',
        kpi: 'string?', milestoneText: 'string?', milestoneDate: 'YYYY-MM-DD?',
      },
    };
    capabilities.update_item = { method: 'PATCH', url: `${base}/items/<id>`, description: 'Pass only the fields you are changing.' };
    capabilities.delete_item = { method: 'DELETE', url: `${base}/items/<id>` };
    capabilities.create_sprint = {
      method: 'POST',
      url: `${base}/items/<id>/sprints`,
      body_schema: { name: 'string', startDate: 'YYYY-MM-DD', endDate: 'YYYY-MM-DD', dri: 'string?', kpi: 'string?' },
    };
    capabilities.update_sprint = { method: 'PATCH', url: `${base}/sprints/<id>` };
    capabilities.delete_sprint = { method: 'DELETE', url: `${base}/sprints/<id>` };
  }
  const roleVerb =
    link.role === 'agent_editor'
      ? 'You may edit it directly via the write endpoints; changes apply immediately with the same validation humans get.'
      : link.role === 'agent_suggester'
        ? 'File suggestions with a clear rationale; a human reviews and accepts or rejects each one.'
        : 'Your access is read-only.';
  return {
    app: 'Roadmapper',
    agent: { name: link.name, role: link.role },
    roadmap: {
      id: roadmap.id,
      title: roadmap.title,
      description: roadmap.description,
      startMonth: roadmap.startMonth,
      endMonth: roadmap.endMonth,
    },
    rate_limit: {
      requests_per_minute: AGENT_RATE_LIMIT,
      max_pending_suggestions: MAX_PENDING_SUGGESTIONS,
    },
    capabilities,
    instructions:
      `You are working with a product roadmap ("${roadmap.title}"). Fetch read_roadmap first to see ` +
      `initiatives, items, sprints, and the team. All dates are ISO YYYY-MM-DD and must stay inside ` +
      `the roadmap range. ${roleVerb} On 429 responses wait retry_after seconds before retrying.`,
  };
}

async function fullRoadmap(auth: AuthedAgent) {
  const store = getStore();
  const [initiatives, items, team] = await Promise.all([
    store.listInitiatives(auth.roadmap.id),
    store.listItems(auth.roadmap.id),
    store.listTeamMembers(auth.roadmap.id),
  ]);
  const withSprints = await Promise.all(
    items.map(async (i) => ({ ...i, sprints: await store.listSprints(i.id) })),
  );
  return {
    roadmap: auth.roadmap,
    initiatives,
    items: withSprints,
    team: team.map((m) => ({ name: m.name })),
  };
}

async function handle(req: Request, { params }: Params): Promise<Response> {
  const path = params.path ?? [];
  const route = matchRoute(req.method, path);
  // Unknown paths still authorize first so unknown tokens 404 identically
  // and the attempt is rate-limited.
  const auth = await authorizeAgent(params.token, route?.tier ?? 'read');
  if (auth instanceof NextResponse) return auth;
  if (!route) return jsonError(404, 'Unknown agent API path — GET the manifest at /api');

  const store = getStore();
  const log = (action: string, detail: Record<string, unknown>) =>
    store.logAgentActivity({
      agentLinkId: auth.link.id,
      roadmapId: auth.roadmap.id,
      action,
      detail,
    });

  const match = route.match;
  switch (match.kind) {
    case 'manifest': {
      await log('read', { path: 'manifest' });
      return NextResponse.json(manifest(new URL(req.url).origin, params.token, auth));
    }
    case 'roadmap': {
      await log('read', { path: 'roadmap' });
      return NextResponse.json(await fullRoadmap(auth));
    }
    case 'suggestions_list': {
      await log('read', { path: 'suggestions' });
      return NextResponse.json({
        suggestions: await store.listSuggestionsByLink(auth.link.id),
      });
    }
    case 'suggestions_create': {
      const body = await readJson(req);
      if (!body) return jsonError(400, 'Invalid JSON body');
      const kind = body.kind as SuggestionKind;
      if (!SUGGESTION_KINDS.includes(kind)) {
        return jsonError(400, `kind must be one of: ${SUGGESTION_KINDS.join(', ')}`, 'kind');
      }
      const rationale = typeof body.rationale === 'string' ? body.rationale.trim() : '';
      if (!rationale) {
        return jsonError(400, 'rationale is required — explain why', 'rationale');
      }
      const targetId = typeof body.target_id === 'string' ? body.target_id : null;
      const payload =
        body.payload && typeof body.payload === 'object'
          ? (body.payload as Record<string, unknown>)
          : {};
      if ((await store.countPendingSuggestions(auth.link.id)) >= MAX_PENDING_SUGGESTIONS) {
        return jsonError(429, 'Too many pending suggestions — wait for the owner to review');
      }
      const invalid = await validateSuggestion(auth.roadmap, kind, targetId, payload);
      if (invalid) return jsonError(400, invalid);
      const suggestion = await store.createSuggestion({
        roadmapId: auth.roadmap.id,
        agentLinkId: auth.link.id,
        kind,
        targetId,
        payload,
        rationale,
      });
      await log('suggest', { suggestionId: suggestion.id, kind });
      return NextResponse.json({ suggestion }, { status: 201 });
    }
    case 'tool': {
      const body = (await readJson(req)) ?? {};
      const out = await executeAgentTool(auth.roadmap, match.tool, { ...body, ...match.extra });
      if (out.isError) return jsonError(400, out.result.replace(/^Error: /, ''));
      await log('edit', { tool: match.tool, summary: out.action?.summary ?? '' });
      return NextResponse.json(
        { ok: true, result: JSON.parse(out.result) },
        { status: match.created ? 201 : 200 },
      );
    }
    case 'delete_item': {
      const item = await store.getItem(match.id);
      if (!item || item.roadmapId !== auth.roadmap.id) {
        return jsonError(404, 'This item no longer exists');
      }
      await store.deleteItem(item.id);
      await log('edit', { tool: 'delete_item', summary: `Deleted item "${item.title}"` });
      return NextResponse.json({ ok: true });
    }
    case 'delete_sprint': {
      const sprint = await store.getSprint(match.id);
      const parent = sprint ? await store.getItem(sprint.roadmapItemId) : null;
      if (!sprint || !parent || parent.roadmapId !== auth.roadmap.id) {
        return jsonError(404, 'This sprint item no longer exists');
      }
      await store.deleteSprint(sprint.id);
      await log('edit', { tool: 'delete_sprint', summary: `Deleted sprint "${sprint.name}"` });
      return NextResponse.json({ ok: true });
    }
  }
}

export { handle as GET, handle as POST, handle as PATCH, handle as DELETE };
