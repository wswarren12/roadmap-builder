import { NextResponse } from 'next/server';
import { beforeEach, describe, expect, it } from 'vitest';
import { EDITOR, OWNER, VIEWER, freshStore, json, reqAs, seedRoadmap } from './harness';
import * as agentApi from '@/app/agent/[token]/api/[[...path]]/route';
import * as linkRoute from '@/app/api/agent-links/[id]/route';
import * as linksRoute from '@/app/api/roadmaps/[id]/agent-links/route';
import * as suggListRoute from '@/app/api/roadmaps/[id]/suggestions/route';
import * as resolveRoute from '@/app/api/suggestions/[id]/resolve/route';
import { authorizeAgent } from '@/lib/api-helpers';
import { AGENT_RATE_LIMIT, resetRateLimits } from '@/lib/agent-links/rate-limit';
import type { MemoryStore } from '@/lib/store';
import type { AgentRole } from '@/lib/types';

function agentReq(method: string, body?: unknown) {
  return new Request('http://test.local/agent/x/api', {
    method,
    headers: {
      accept: 'application/json',
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

type Handler = (req: Request, ctx: { params: { token: string; path?: string[] } }) => Promise<Response>;
const call = (fn: Handler, token: string, path: string[] | undefined, req: Request) =>
  fn(req, { params: { token, path } });

describe('agent-links store layer', () => {
  let store: MemoryStore;
  beforeEach(() => {
    store = freshStore();
  });

  it('creates, lists, revokes, and touches links', async () => {
    const { roadmap } = await seedRoadmap(store);
    const link = await store.createAgentLink(roadmap.id, 'Hermes PM bot', 'agent_suggester', 'tok-1');
    expect(link.role).toBe('agent_suggester');
    expect(link.revokedAt).toBeNull();
    expect(await store.findAgentLinkByToken('tok-1')).toMatchObject({ id: link.id });
    expect(await store.findAgentLinkByToken('nope')).toBeNull();

    await store.touchAgentLink(link.id);
    expect((await store.getAgentLink(link.id))!.lastUsedAt).not.toBeNull();

    await store.revokeAgentLink(link.id);
    const revoked = await store.findAgentLinkByToken('tok-1');
    expect(revoked!.revokedAt).not.toBeNull();
    expect(await store.listAgentLinks(roadmap.id)).toHaveLength(1);
  });

  it('creates, resolves, and counts suggestions', async () => {
    const { roadmap, item } = await seedRoadmap(store);
    const link = await store.createAgentLink(roadmap.id, 'Bot', 'agent_suggester', 'tok-2');
    const s = await store.createSuggestion({
      roadmapId: roadmap.id,
      agentLinkId: link.id,
      kind: 'update_item',
      targetId: item.id,
      payload: { endDate: '2026-10-01' },
      rationale: 'stretch',
    });
    expect(s.status).toBe('pending');
    expect(await store.countPendingSuggestions(link.id)).toBe(1);
    const resolved = await store.resolveSuggestion(s.id, 'accepted', 'u-owner');
    expect(resolved.status).toBe('accepted');
    expect(resolved.resolvedBy).toBe('u-owner');
    expect(resolved.resolvedAt).not.toBeNull();
    expect(await store.countPendingSuggestions(link.id)).toBe(0);
    expect(await store.listSuggestionsByLink(link.id)).toHaveLength(1);
    expect(await store.listSuggestions(roadmap.id)).toHaveLength(1);
  });

  it('logs and lists activity newest-first', async () => {
    const { roadmap } = await seedRoadmap(store);
    const link = await store.createAgentLink(roadmap.id, 'Bot', 'agent_viewer', 'tok-3');
    await store.logAgentActivity({
      agentLinkId: link.id,
      roadmapId: roadmap.id,
      action: 'read',
      detail: { path: 'manifest' },
    });
    await store.logAgentActivity({
      agentLinkId: link.id,
      roadmapId: roadmap.id,
      action: 'read',
      detail: { path: 'roadmap' },
    });
    const acts = await store.listAgentActivity(link.id, 5);
    expect(acts).toHaveLength(2);
    expect(acts[0].detail).toEqual({ path: 'roadmap' });
  });
});

describe('authorizeAgent', () => {
  let store: MemoryStore;
  beforeEach(() => {
    store = freshStore();
    resetRateLimits();
  });

  async function seededLink(role: AgentRole) {
    const { roadmap } = await seedRoadmap(store);
    const link = await store.createAgentLink(roadmap.id, 'Bot', role, `tok-${role}`);
    return { roadmap, link };
  }

  it('unknown token → 404', async () => {
    const r = await authorizeAgent('nope', 'read');
    expect(r).toBeInstanceOf(NextResponse);
    expect((r as NextResponse).status).toBe(404);
  });

  it('revoked token → 404, not 403', async () => {
    const { link } = await seededLink('agent_editor');
    await store.revokeAgentLink(link.id);
    const r = await authorizeAgent(link.token, 'read');
    expect((r as NextResponse).status).toBe(404);
  });

  it('tier ladder: viewer reads only; suggester suggests; editor writes', async () => {
    const v = await seededLink('agent_viewer');
    expect(await authorizeAgent(v.link.token, 'read')).toHaveProperty('link');
    expect(((await authorizeAgent(v.link.token, 'suggest')) as NextResponse).status).toBe(403);
    const s = await seededLink('agent_suggester');
    expect(await authorizeAgent(s.link.token, 'suggest')).toHaveProperty('link');
    expect(((await authorizeAgent(s.link.token, 'write')) as NextResponse).status).toBe(403);
    const e = await seededLink('agent_editor');
    expect(await authorizeAgent(e.link.token, 'write')).toHaveProperty('link');
  });

  it('bumps last_used_at and rate-limits with retry_after', async () => {
    const { link } = await seededLink('agent_viewer');
    await authorizeAgent(link.token, 'read');
    expect((await store.getAgentLink(link.id))!.lastUsedAt).not.toBeNull();
    for (let i = 1; i < AGENT_RATE_LIMIT; i++) await authorizeAgent(link.token, 'read');
    const r = await authorizeAgent(link.token, 'read');
    expect((r as NextResponse).status).toBe(429);
    expect(await (r as NextResponse).clone().json()).toHaveProperty('retry_after');
  });
});

describe('agent API', () => {
  let store: MemoryStore;
  beforeEach(() => {
    store = freshStore();
    resetRateLimits();
  });

  it('manifest is role-filtered', async () => {
    const { roadmap } = await seedRoadmap(store);
    await store.createAgentLink(roadmap.id, 'V', 'agent_viewer', 'tv');
    await store.createAgentLink(roadmap.id, 'S', 'agent_suggester', 'ts');
    await store.createAgentLink(roadmap.id, 'E', 'agent_editor', 'te');

    const vm = await json(await call(agentApi.GET, 'tv', undefined, agentReq('GET')));
    expect(vm.agent).toEqual({ name: 'V', role: 'agent_viewer' });
    expect(vm.capabilities.read_roadmap).toBeDefined();
    expect(vm.capabilities.create_suggestion).toBeUndefined();

    const sm = await json(await call(agentApi.GET, 'ts', undefined, agentReq('GET')));
    expect(sm.capabilities.create_suggestion).toBeDefined();
    expect(sm.capabilities.update_item).toBeUndefined();

    const em = await json(await call(agentApi.GET, 'te', undefined, agentReq('GET')));
    expect(em.capabilities.update_item).toBeDefined();
    expect(em.instructions).toContain('roadmap');
  });

  it('unknown/revoked token → 404; unknown path → 404', async () => {
    const { roadmap } = await seedRoadmap(store);
    const link = await store.createAgentLink(roadmap.id, 'V', 'agent_viewer', 'tok');
    expect((await call(agentApi.GET, 'nope', undefined, agentReq('GET'))).status).toBe(404);
    expect((await call(agentApi.GET, 'tok', ['bogus'], agentReq('GET'))).status).toBe(404);
    await store.revokeAgentLink(link.id);
    expect((await call(agentApi.GET, 'tok', undefined, agentReq('GET'))).status).toBe(404);
  });

  it('GET roadmap returns full payload and logs activity', async () => {
    const { roadmap, item } = await seedRoadmap(store);
    const link = await store.createAgentLink(roadmap.id, 'V', 'agent_viewer', 'tok');
    const body = await json(await call(agentApi.GET, 'tok', ['roadmap'], agentReq('GET')));
    expect(body.roadmap.title).toBe(roadmap.title);
    expect(body.items[0].id).toBe(item.id);
    expect(body.items[0].sprints).toHaveLength(1);
    const acts = await store.listAgentActivity(link.id, 10);
    expect(acts[0].action).toBe('read');
    expect(JSON.stringify(acts)).not.toContain('tok');
  });

  it('files a valid suggestion; rejects malformed at filing; enforces pending cap', async () => {
    const { roadmap, item } = await seedRoadmap(store);
    const link = await store.createAgentLink(roadmap.id, 'S', 'agent_suggester', 'ts');

    const ok = await call(
      agentApi.POST,
      'ts',
      ['suggestions'],
      agentReq('POST', {
        kind: 'update_item',
        target_id: item.id,
        payload: { endDate: '2026-10-01' },
        rationale: 'push out',
      }),
    );
    expect(ok.status).toBe(201);
    expect((await store.getItem(item.id))!.endDate).toBe('2026-09-15'); // unchanged until accepted

    const bad = await call(
      agentApi.POST,
      'ts',
      ['suggestions'],
      agentReq('POST', {
        kind: 'update_item',
        target_id: item.id,
        payload: { endDate: '2027-06-01' },
        rationale: 'x',
      }),
    );
    expect(bad.status).toBe(400);
    const noRationale = await call(
      agentApi.POST,
      'ts',
      ['suggestions'],
      agentReq('POST', { kind: 'comment', payload: {} }),
    );
    expect(noRationale.status).toBe(400);

    for (let i = 0; i < 19; i++) {
      await store.createSuggestion({
        roadmapId: roadmap.id,
        agentLinkId: link.id,
        kind: 'comment',
        targetId: null,
        payload: {},
        rationale: 'r',
      });
    }
    const capped = await call(
      agentApi.POST,
      'ts',
      ['suggestions'],
      agentReq('POST', { kind: 'comment', payload: {}, rationale: 'r' }),
    );
    expect(capped.status).toBe(429);
  });

  it('suggester cannot use editor write routes; viewer cannot suggest', async () => {
    const { roadmap, item } = await seedRoadmap(store);
    await store.createAgentLink(roadmap.id, 'S', 'agent_suggester', 'ts');
    await store.createAgentLink(roadmap.id, 'V', 'agent_viewer', 'tv');
    expect(
      (await call(agentApi.PATCH, 'ts', ['items', item.id], agentReq('PATCH', { endDate: '2026-10-01' }))).status,
    ).toBe(403);
    expect((await call(agentApi.GET, 'tv', ['suggestions'], agentReq('GET'))).status).toBe(403);
  });

  it('editor direct writes have human-route parity (validation + effect)', async () => {
    const { roadmap, initiative, item, sprint } = await seedRoadmap(store);
    const link = await store.createAgentLink(roadmap.id, 'E', 'agent_editor', 'te');

    const upd = await call(
      agentApi.PATCH,
      'te',
      ['items', item.id],
      agentReq('PATCH', { endDate: '2026-10-01' }),
    );
    expect(upd.status).toBe(200);
    expect((await store.getItem(item.id))!.endDate).toBe('2026-10-01');

    const invalid = await call(
      agentApi.PATCH,
      'te',
      ['items', item.id],
      agentReq('PATCH', { endDate: '2027-06-01' }),
    );
    expect(invalid.status).toBe(400);

    const created = await call(
      agentApi.POST,
      'te',
      ['items'],
      agentReq('POST', {
        initiativeId: initiative.id,
        title: 'Agent item',
        startDate: '2026-11-01',
        endDate: '2026-11-20',
      }),
    );
    expect(created.status).toBe(201);

    const ini = await call(agentApi.POST, 'te', ['initiatives'], agentReq('POST', { name: 'Ops' }));
    expect(ini.status).toBe(201);

    const sprintCreated = await call(
      agentApi.POST,
      'te',
      ['items', item.id, 'sprints'],
      agentReq('POST', { name: 'S2', startDate: '2026-08-17', endDate: '2026-08-28' }),
    );
    expect(sprintCreated.status).toBe(201);

    const sprintUpd = await call(
      agentApi.PATCH,
      'te',
      ['sprints', sprint.id],
      agentReq('PATCH', { name: 'Renamed' }),
    );
    expect(sprintUpd.status).toBe(200);

    const del = await call(agentApi.DELETE, 'te', ['sprints', sprint.id], agentReq('DELETE'));
    expect(del.status).toBe(200);
    expect(await store.getSprint(sprint.id)).toBeNull();

    const delItem = await call(agentApi.DELETE, 'te', ['items', item.id], agentReq('DELETE'));
    expect(delItem.status).toBe(200);
    expect(await store.getItem(item.id)).toBeNull();

    const acts = await store.listAgentActivity(link.id, 20);
    expect(acts.some((a) => a.action === 'edit')).toBe(true);
  });
});

describe('agent-link management + suggestion review', () => {
  let store: MemoryStore;
  beforeEach(() => {
    store = freshStore();
    resetRateLimits();
  });

  it('owner creates (suggester default), lists, revokes; editor allowed; viewer 403', async () => {
    const { roadmap } = await seedRoadmap(store);
    const created = await linksRoute.POST(reqAs(OWNER, 'POST', { name: 'Hermes PM bot' }), {
      params: { id: roadmap.id },
    });
    expect(created.status).toBe(201);
    const { link } = await json(created);
    expect(link.role).toBe('agent_suggester');
    expect(link.token).toBeTruthy();

    expect(
      (await linksRoute.POST(reqAs(EDITOR, 'POST', { name: 'Editor bot' }), { params: { id: roadmap.id } })).status,
    ).toBe(201);
    expect(
      (await linksRoute.POST(reqAs(VIEWER, 'POST', { name: 'X' }), { params: { id: roadmap.id } })).status,
    ).toBe(403);
    expect(
      (await linksRoute.POST(reqAs(OWNER, 'POST', { name: '' }), { params: { id: roadmap.id } })).status,
    ).toBe(400);
    expect(
      (await linksRoute.POST(reqAs(OWNER, 'POST', { name: 'X', role: 'agent_god' }), { params: { id: roadmap.id } })).status,
    ).toBe(400);

    const listed = await json(await linksRoute.GET(reqAs(OWNER), { params: { id: roadmap.id } }));
    expect(listed.links).toHaveLength(2); // owner's + editor's
    expect(listed.links[0].activity).toEqual([]);

    expect((await linkRoute.DELETE(reqAs(VIEWER, 'DELETE'), { params: { id: link.id } })).status).toBe(403);
    expect((await linkRoute.DELETE(reqAs(OWNER, 'DELETE'), { params: { id: link.id } })).status).toBe(200);
    expect((await store.getAgentLink(link.id))!.revokedAt).not.toBeNull();
  });

  it('suggest → accept mutates; reject leaves untouched; write tier enforced', async () => {
    const { roadmap, item } = await seedRoadmap(store);
    const link = await store.createAgentLink(roadmap.id, 'Bot', 'agent_suggester', 'tk');
    const s1 = await store.createSuggestion({
      roadmapId: roadmap.id,
      agentLinkId: link.id,
      kind: 'update_item',
      targetId: item.id,
      payload: { endDate: '2026-10-01' },
      rationale: 'r',
    });
    const s2 = await store.createSuggestion({
      roadmapId: roadmap.id,
      agentLinkId: link.id,
      kind: 'delete_item',
      targetId: item.id,
      payload: {},
      rationale: 'r',
    });

    const list = await json(await suggListRoute.GET(reqAs(EDITOR), { params: { id: roadmap.id } }));
    expect(list.suggestions).toHaveLength(2);
    expect(list.suggestions.map((s: { agentName: string }) => s.agentName)).toEqual(['Bot', 'Bot']);
    expect(list.suggestions[0].summary).toBeTruthy();
    expect((await suggListRoute.GET(reqAs(VIEWER), { params: { id: roadmap.id } })).status).toBe(403);

    const acc = await json(
      await resolveRoute.POST(reqAs(OWNER, 'POST', { action: 'accept' }), { params: { id: s1.id } }),
    );
    expect(acc.applied).toBe(true);
    expect((await store.getItem(item.id))!.endDate).toBe('2026-10-01');

    const rej = await json(
      await resolveRoute.POST(reqAs(OWNER, 'POST', { action: 'reject' }), { params: { id: s2.id } }),
    );
    expect(rej.suggestion.status).toBe('rejected');
    expect(await store.getItem(item.id)).not.toBeNull();

    expect(
      (await resolveRoute.POST(reqAs(OWNER, 'POST', { action: 'accept' }), { params: { id: s1.id } })).status,
    ).toBe(409);
    expect(
      (await resolveRoute.POST(reqAs(VIEWER, 'POST', { action: 'accept' }), { params: { id: s2.id } })).status,
    ).toBe(403);
  });

  it('accept after target deleted → rejected by system, applied false', async () => {
    const { roadmap, item } = await seedRoadmap(store);
    const link = await store.createAgentLink(roadmap.id, 'Bot', 'agent_suggester', 'tk2');
    const s = await store.createSuggestion({
      roadmapId: roadmap.id,
      agentLinkId: link.id,
      kind: 'update_item',
      targetId: item.id,
      payload: { endDate: '2026-10-01' },
      rationale: 'r',
    });
    await store.deleteItem(item.id);
    const res = await json(
      await resolveRoute.POST(reqAs(OWNER, 'POST', { action: 'accept' }), { params: { id: s.id } }),
    );
    expect(res.applied).toBe(false);
    expect(res.suggestion.status).toBe('rejected');
    expect(res.suggestion.resolvedBy).toBe('system');
  });
});
