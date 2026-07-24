import { beforeEach, describe, expect, it } from 'vitest';
import { GET as getMe } from '@/app/api/me/route';
import { GET as getMyRoadmaps } from '@/app/api/me/roadmaps/route';
import { POST as postRoadmap } from '@/app/api/roadmaps/route';
import { GET as getRoadmap, PATCH as patchRoadmap, DELETE as deleteRoadmap } from '@/app/api/roadmaps/[id]/route';
import { POST as postInitiative } from '@/app/api/roadmaps/[id]/initiatives/route';
import { DELETE as deleteInitiative, PATCH as patchInitiative } from '@/app/api/initiatives/[id]/route';
import { POST as postItem } from '@/app/api/roadmaps/[id]/items/route';
import { GET as getItem, PATCH as patchItem, DELETE as deleteItem } from '@/app/api/items/[id]/route';
import { POST as postSprint } from '@/app/api/items/[id]/sprints/route';
import { PATCH as patchSprint } from '@/app/api/sprints/[id]/route';
import { ITEM_PALETTE } from '@/lib/colors';
import type { MemoryStore } from '@/lib/store';
import { OWNER, VIEWER, freshStore, reqAs, seedRoadmap } from './harness';

let store: MemoryStore;

beforeEach(() => {
  store = freshStore();
});

describe('roadmap lifecycle (F-1)', () => {
  it('creates a roadmap with a default initiative and 3–12 month validation (AC-1.1, AC-1.3)', async () => {
    const bad = await postRoadmap(
      reqAs(OWNER, 'POST', { title: 'Too short', startMonth: '2026-07-01', endMonth: '2026-08-01' }),
    );
    expect(bad.status).toBe(400);

    const bad13 = await postRoadmap(
      reqAs(OWNER, 'POST', { title: 'Too long', startMonth: '2026-07-01', endMonth: '2027-07-01' }),
    );
    expect(bad13.status).toBe(400);

    const res = await postRoadmap(
      reqAs(OWNER, 'POST', {
        title: 'H2 2026',
        description: 'desc',
        startMonth: '2026-07-01',
        endMonth: '2026-12-01',
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.roadmap.title).toBe('H2 2026');
    expect(body.initiatives).toHaveLength(1);

    // Creation sets last-visited (F-5).
    const me = await (await getMe(reqAs(OWNER))).json();
    expect(me.lastRoadmapId).toBe(body.roadmap.id);
  });

  it('enforces max 5 initiatives server-side (AC-1.2)', async () => {
    const { roadmap } = await seedRoadmap(store);
    for (let i = 2; i <= 5; i++) {
      const res = await postInitiative(
        reqAs(OWNER, 'POST', { name: `Row ${i}` }),
        { params: { id: roadmap.id } },
      );
      expect(res.status).toBe(201);
    }
    const sixth = await postInitiative(
      reqAs(OWNER, 'POST', { name: 'Row 6' }),
      { params: { id: roadmap.id } },
    );
    expect(sixth.status).toBe(400);
    expect((await sixth.json()).error).toMatch(/max 5/i);
  });

  it('renames initiatives (AC-1.4) and reorders positions', async () => {
    const { roadmap, initiative } = await seedRoadmap(store);
    const second = await (
      await postInitiative(reqAs(OWNER, 'POST', { name: 'Second' }), { params: { id: roadmap.id } })
    ).json();

    const renamed = await patchInitiative(
      reqAs(OWNER, 'PATCH', { name: 'Growth' }),
      { params: { id: initiative.id } },
    );
    expect((await renamed.json()).initiative.name).toBe('Growth');

    await patchInitiative(
      reqAs(OWNER, 'PATCH', { position: 1 }),
      { params: { id: second.initiative.id } },
    );
    const rows = await store.listInitiatives(roadmap.id);
    expect(rows.map((r) => r.name)).toEqual(['Second', 'Growth']);
    expect(rows.map((r) => r.position)).toEqual([1, 2]);
  });

  it('blocks deleting an initiative that still has items', async () => {
    const { initiative } = await seedRoadmap(store);
    const res = await deleteInitiative(reqAs(OWNER, 'DELETE'), { params: { id: initiative.id } });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/move or delete/i);
  });

  it('rejects shrinking the range past existing items', async () => {
    const { roadmap } = await seedRoadmap(store); // item Aug 1 – Sep 15
    const res = await patchRoadmap(
      reqAs(OWNER, 'PATCH', { startMonth: '2026-07-01', endMonth: '2026-09-01' }),
      { params: { id: roadmap.id } },
    );
    // Sep 15 is inside Jul–Sep, so this is fine; shrink to Jul–Aug must fail.
    expect(res.status).toBe(200);
    const tooSmall = await patchRoadmap(
      reqAs(OWNER, 'PATCH', { startMonth: '2026-07-01', endMonth: '2026-08-01' }),
      { params: { id: roadmap.id } },
    );
    expect(tooSmall.status).toBe(400);
  });

  it('cascade-deletes roadmap with items, sprints, shares (AC-7.2)', async () => {
    const { roadmap, item } = await seedRoadmap(store);
    const res = await deleteRoadmap(reqAs(OWNER, 'DELETE'), { params: { id: roadmap.id } });
    expect(res.status).toBe(200);
    expect(await store.getRoadmap(roadmap.id)).toBeNull();
    expect(await store.getItem(item.id)).toBeNull();
    expect(await store.listSprints(item.id)).toHaveLength(0);
    expect(await store.listShares(roadmap.id)).toHaveLength(0);
    // Viewer's profile no longer lists it.
    const lists = await (await getMyRoadmaps(reqAs(VIEWER))).json();
    expect(lists.shared).toHaveLength(0);
  });
});

describe('items (F-2)', () => {
  it('assigns deterministic cycling colors (AC-2.1)', async () => {
    const { roadmap, initiative } = await seedRoadmap(store); // 1 existing item, colorIndex 0
    for (let i = 1; i <= 10; i++) {
      const res = await postItem(
        reqAs(OWNER, 'POST', {
          initiativeId: initiative.id,
          title: `Item ${i}`,
          startDate: '2026-07-01',
          endDate: '2026-07-10',
        }),
        { params: { id: roadmap.id } },
      );
      const { item } = await res.json();
      expect(item.colorIndex).toBe(i % ITEM_PALETTE.length);
    }
  });

  it('rejects dates outside the roadmap range and inverted dates (AC-2.6)', async () => {
    const { roadmap, initiative } = await seedRoadmap(store);
    const outside = await postItem(
      reqAs(OWNER, 'POST', {
        initiativeId: initiative.id,
        title: 'Outside',
        startDate: '2026-06-01',
        endDate: '2026-07-10',
      }),
      { params: { id: roadmap.id } },
    );
    expect(outside.status).toBe(400);

    const inverted = await postItem(
      reqAs(OWNER, 'POST', {
        initiativeId: initiative.id,
        title: 'Inverted',
        startDate: '2026-09-01',
        endDate: '2026-08-01',
      }),
      { params: { id: roadmap.id } },
    );
    expect(inverted.status).toBe(400);
  });

  it('drag PATCH persists day-snapped dates (AC-2.3)', async () => {
    const { item } = await seedRoadmap(store);
    const res = await patchItem(
      reqAs(OWNER, 'PATCH', { endDate: '2026-10-15' }),
      { params: { id: item.id } },
    );
    expect(res.status).toBe(200);
    expect((await res.json()).item.endDate).toBe('2026-10-15');
  });

  it('rejects a drag PATCH that exits the range (AC-2.6)', async () => {
    const { item } = await seedRoadmap(store);
    const res = await patchItem(
      reqAs(OWNER, 'PATCH', { endDate: '2027-02-01' }),
      { params: { id: item.id } },
    );
    expect(res.status).toBe(400);
  });

  it('validates milestone date within span (AC-2.4)', async () => {
    const { item } = await seedRoadmap(store);
    const bad = await patchItem(
      reqAs(OWNER, 'PATCH', { milestoneDate: '2026-12-01' }),
      { params: { id: item.id } },
    );
    expect(bad.status).toBe(400);
    const good = await patchItem(
      reqAs(OWNER, 'PATCH', { milestoneDate: '2026-08-15', milestoneText: 'Beta' }),
      { params: { id: item.id } },
    );
    expect(good.status).toBe(200);
  });

  it('deleting an item cascades its sprints (AC-2.5)', async () => {
    const { item, sprint } = await seedRoadmap(store);
    await deleteItem(reqAs(OWNER, 'DELETE'), { params: { id: item.id } });
    expect(await store.getSprint(sprint.id)).toBeNull();
  });
});

describe('sprints (F-4)', () => {
  it('constrains sprint dates to the parent item span (AC-4.4)', async () => {
    const { item } = await seedRoadmap(store); // item Aug 1 – Sep 15
    const outside = await postSprint(
      reqAs(OWNER, 'POST', { name: 'Bad', startDate: '2026-07-20', endDate: '2026-08-05' }),
      { params: { id: item.id } },
    );
    expect(outside.status).toBe(400);
    expect((await outside.json()).error).toMatch(/parent item/i);

    const ok = await postSprint(
      reqAs(OWNER, 'POST', { name: 'Good', startDate: '2026-08-05', endDate: '2026-08-19' }),
      { params: { id: item.id } },
    );
    expect(ok.status).toBe(201);
  });

  it('drag PATCH cannot exit the parent span', async () => {
    const { sprint } = await seedRoadmap(store);
    const res = await patchSprint(
      reqAs(OWNER, 'PATCH', { endDate: '2026-09-20' }),
      { params: { id: sprint.id } },
    );
    expect(res.status).toBe(400);
  });

  it('GET item returns sprints for the subcalendar (F-3)', async () => {
    const { item } = await seedRoadmap(store);
    const res = await getItem(reqAs(VIEWER), { params: { id: item.id } });
    const body = await res.json();
    expect(body.sprints).toHaveLength(1);
    expect(body.role).toBe('viewer');
    expect(body.initiativeName).toBe('Onboarding');
  });
});

describe('me + last-visited (F-5)', () => {
  it('tracks last visited across roadmaps (AC-5.4)', async () => {
    const a = await seedRoadmap(store);
    const bRes = await postRoadmap(
      reqAs(OWNER, 'POST', { title: 'B', startMonth: '2026-07-01', endMonth: '2026-10-01' }),
    );
    const b = (await bRes.json()).roadmap;

    await getRoadmap(reqAs(OWNER), { params: { id: a.roadmap.id } });
    let me = await (await getMe(reqAs(OWNER))).json();
    expect(me.lastRoadmapId).toBe(a.roadmap.id);

    await getRoadmap(reqAs(OWNER), { params: { id: b.id } });
    me = await (await getMe(reqAs(OWNER))).json();
    expect(me.lastRoadmapId).toBe(b.id);
  });

  it('viewer visits update their last-visited too', async () => {
    const { roadmap } = await seedRoadmap(store);
    await getRoadmap(reqAs(VIEWER), { params: { id: roadmap.id } });
    const me = await (await getMe(reqAs(VIEWER))).json();
    expect(me.lastRoadmapId).toBe(roadmap.id);
  });

  it('falls back gracefully when the last roadmap is gone (AC-5 error state)', async () => {
    const { roadmap } = await seedRoadmap(store);
    await getRoadmap(reqAs(OWNER), { params: { id: roadmap.id } });
    await deleteRoadmap(reqAs(OWNER, 'DELETE'), { params: { id: roadmap.id } });
    const me = await (await getMe(reqAs(OWNER))).json();
    expect(me.lastRoadmapId).toBeNull();
  });

  it('revoked viewer falls back to profile (AC-5 error state)', async () => {
    const { roadmap } = await seedRoadmap(store);
    await getRoadmap(reqAs(VIEWER), { params: { id: roadmap.id } });
    const shares = await store.listShares(roadmap.id);
    await store.removeShare(shares[0].id);
    const me = await (await getMe(reqAs(VIEWER))).json();
    expect(me.lastRoadmapId).toBeNull();
    expect(me.lastRoadmapGone).toBe(true);
  });

  it('401 when anonymous (AC-5.2)', async () => {
    const res = await getMe(reqAs(null));
    expect(res.status).toBe(401);
  });
});

describe('profile lists (F-7, AC-7.1)', () => {
  it('returns owned and shared lists', async () => {
    await seedRoadmap(store);
    const owner = await (await getMyRoadmaps(reqAs(OWNER))).json();
    expect(owner.owned).toHaveLength(1);
    expect(owner.shared).toHaveLength(0);

    const viewer = await (await getMyRoadmaps(reqAs(VIEWER))).json();
    expect(viewer.owned).toHaveLength(0);
    expect(viewer.shared).toHaveLength(1);
  });
});
