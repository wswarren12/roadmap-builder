import { beforeEach, describe, expect, it } from 'vitest';
import { OWNER, freshStore, json, reqAs, seedRoadmap } from './harness';
import * as initiativeRoute from '@/app/api/initiatives/[id]/route';
import * as itemRoute from '@/app/api/items/[id]/route';
import * as itemsRoute from '@/app/api/roadmaps/[id]/items/route';
import type { MemoryStore } from '@/lib/store';

describe('cleanup batch: initiative description + item responsibleTeam (007)', () => {
  let store: MemoryStore;
  beforeEach(() => {
    store = freshStore();
  });

  it('PATCH initiative persists description and GET roadmap returns it', async () => {
    const { roadmap, initiative } = await seedRoadmap(store);
    const res = await initiativeRoute.PATCH(
      reqAs(OWNER, 'PATCH', { description: 'Everything onboarding-related' }),
      { params: { id: initiative.id } },
    );
    expect(res.status).toBe(200);
    expect((await json(res)).initiative.description).toBe('Everything onboarding-related');
    expect((await store.getInitiative(initiative.id))!.description).toBe(
      'Everything onboarding-related',
    );
    expect((await store.listInitiatives(roadmap.id))[0].description).toBe(
      'Everything onboarding-related',
    );
  });

  it('item create + patch round-trip responsibleTeam', async () => {
    const { roadmap, initiative, item } = await seedRoadmap(store);
    const created = await itemsRoute.POST(
      reqAs(OWNER, 'POST', {
        initiativeId: initiative.id,
        title: 'Team-owned item',
        startDate: '2026-10-01',
        endDate: '2026-10-20',
        responsibleTeam: 'Platform',
      }),
      { params: { id: roadmap.id } },
    );
    expect(created.status).toBe(201);
    expect((await json(created)).item.responsibleTeam).toBe('Platform');

    const patched = await itemRoute.PATCH(reqAs(OWNER, 'PATCH', { responsibleTeam: 'Growth' }), {
      params: { id: item.id },
    });
    expect(patched.status).toBe(200);
    expect((await json(patched)).item.responsibleTeam).toBe('Growth');
    expect((await store.getItem(item.id))!.responsibleTeam).toBe('Growth');
  });
});
