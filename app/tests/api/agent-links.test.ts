import { NextResponse } from 'next/server';
import { beforeEach, describe, expect, it } from 'vitest';
import { EDITOR, OWNER, VIEWER, freshStore, json, reqAs, seedRoadmap } from './harness';
import { authorizeAgent } from '@/lib/api-helpers';
import { AGENT_RATE_LIMIT, resetRateLimits } from '@/lib/agent-links/rate-limit';
import type { MemoryStore } from '@/lib/store';
import type { AgentRole } from '@/lib/types';

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
