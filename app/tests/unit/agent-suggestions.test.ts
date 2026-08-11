import { beforeEach, describe, expect, it } from 'vitest';
import {
  applySuggestion,
  describeSuggestion,
  validateSuggestion,
} from '@/lib/agent-links/suggestions';
import { freshStore, seedRoadmap } from '../api/harness';
import type { MemoryStore } from '@/lib/store';
import type { Suggestion } from '@/lib/types';

function asSuggestion(partial: Partial<Suggestion>): Suggestion {
  return {
    id: 's1',
    roadmapId: 'r',
    agentLinkId: 'l',
    kind: 'comment',
    targetId: null,
    payload: {},
    rationale: 'why',
    status: 'pending',
    resolvedBy: null,
    resolvedAt: null,
    createdAt: new Date().toISOString(),
    ...partial,
  };
}

describe('suggestion engine', () => {
  let store: MemoryStore;
  beforeEach(() => {
    store = freshStore();
  });

  it('validates update_item against the roadmap span', async () => {
    const { roadmap, item } = await seedRoadmap(store);
    expect(
      await validateSuggestion(roadmap, 'update_item', item.id, { endDate: '2026-10-01' }),
    ).toBeNull();
    expect(
      await validateSuggestion(roadmap, 'update_item', item.id, { endDate: '2027-06-01' }),
    ).toMatch(/range/i);
    expect(
      await validateSuggestion(roadmap, 'update_item', 'missing-id', { endDate: '2026-10-01' }),
    ).toMatch(/item/i);
  });

  it('validates create_item initiative ownership', async () => {
    const { roadmap } = await seedRoadmap(store);
    const err = await validateSuggestion(roadmap, 'create_item', null, {
      initiativeId: 'not-real',
      title: 'X',
      startDate: '2026-08-01',
      endDate: '2026-08-20',
    });
    expect(err).toMatch(/initiative/i);
  });

  it('validates create_sprint inside the parent item', async () => {
    const { roadmap, item } = await seedRoadmap(store);
    expect(
      await validateSuggestion(roadmap, 'create_sprint', null, {
        itemId: item.id,
        name: 'S2',
        startDate: '2026-08-17',
        endDate: '2026-08-28',
      }),
    ).toBeNull();
    expect(
      await validateSuggestion(roadmap, 'create_sprint', null, {
        itemId: item.id,
        name: 'S2',
        startDate: '2026-06-01',
        endDate: '2026-06-10',
      }),
    ).toMatch(/parent item/i);
  });

  it('comment needs no payload', async () => {
    const { roadmap } = await seedRoadmap(store);
    expect(await validateSuggestion(roadmap, 'comment', null, {})).toBeNull();
  });

  it('applies update_item and delete_item; missing target fails gracefully', async () => {
    const { roadmap, item } = await seedRoadmap(store);
    const upd = asSuggestion({
      roadmapId: roadmap.id,
      kind: 'update_item',
      targetId: item.id,
      payload: { endDate: '2026-10-01' },
    });
    expect(await applySuggestion(roadmap, upd)).toEqual({ ok: true });
    expect((await store.getItem(item.id))!.endDate).toBe('2026-10-01');

    const del = asSuggestion({ roadmapId: roadmap.id, kind: 'delete_item', targetId: item.id });
    expect(await applySuggestion(roadmap, del)).toEqual({ ok: true });
    expect(await store.getItem(item.id)).toBeNull();

    const gone = await applySuggestion(roadmap, upd);
    expect(gone.ok).toBe(false);
  });

  it('applies create_sprint and update_sprint', async () => {
    const { roadmap, item, sprint } = await seedRoadmap(store);
    const create = asSuggestion({
      roadmapId: roadmap.id,
      kind: 'create_sprint',
      payload: { itemId: item.id, name: 'S2', startDate: '2026-08-17', endDate: '2026-08-28' },
    });
    expect(await applySuggestion(roadmap, create)).toEqual({ ok: true });
    expect(await store.listSprints(item.id)).toHaveLength(2);

    const upd = asSuggestion({
      roadmapId: roadmap.id,
      kind: 'update_sprint',
      targetId: sprint.id,
      payload: { name: 'Renamed' },
    });
    expect(await applySuggestion(roadmap, upd)).toEqual({ ok: true });
    expect((await store.getSprint(sprint.id))!.name).toBe('Renamed');
  });

  it('describes an update with title and changed values', async () => {
    const { roadmap, item } = await seedRoadmap(store);
    const s = asSuggestion({
      roadmapId: roadmap.id,
      kind: 'update_item',
      targetId: item.id,
      payload: { endDate: '2026-10-01' },
    });
    const text = await describeSuggestion(s);
    expect(text).toContain('Signup revamp');
    expect(text).toContain('2026-10-01');
  });
});
