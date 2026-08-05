import { beforeEach, describe, expect, it } from 'vitest';
import { POST as convertInitiative } from '@/app/api/initiatives/[id]/convert/route';
import { POST as convertItem } from '@/app/api/items/[id]/convert/route';
import { POST as postInitiative } from '@/app/api/roadmaps/[id]/initiatives/route';
import { POST as postItem } from '@/app/api/roadmaps/[id]/items/route';
import { PATCH as patchItem } from '@/app/api/items/[id]/route';
import { POST as postRoadmap } from '@/app/api/roadmaps/route';
import type { MemoryStore } from '@/lib/store';
import { EDITOR, OWNER, VIEWER, freshStore, reqAs, seedRoadmap } from './harness';

/**
 * BDD scenarios — drag features (F-2 extension + F-10).
 *
 * Move item across initiatives (AC-2.8):
 * - Given an item in initiative A, When PATCHed with initiativeId B (same
 *   roadmap), Then the item belongs to B.
 * - Given an initiativeId from another roadmap, Then 400 and no change.
 *
 * Convert item into a sprint of another item (F-11):
 * - Given items X and Y, When X is converted into Y, Then X is deleted, Y
 *   gains a sprint named like X (dris→dri), X's existing sprints flatten
 *   into Y, and Y's dates expand to cover X's span if needed (AC-11.1).
 * - Given target == source or a target on another roadmap, Then 400
 *   (AC-11.2).
 * - Given a viewer, Then 403; editors may convert (AC-11.3).
 *
 * Convert initiative into an item (F-10):
 * - Given initiative A with items, When converted into B, Then A is deleted,
 *   B gains an item titled like A spanning the envelope of A's items, and
 *   A's items become the new item's sprint items — including flattening any
 *   sprints those items already had (AC-10.1).
 * - Given A is empty, Then the new item defaults to a two-week span at the
 *   roadmap start with no sprints (AC-10.2).
 * - Given target == source or target on another roadmap, Then 400 (AC-10.3).
 * - Given a viewer, Then 403; editors may convert (AC-10.4).
 */

let store: MemoryStore;

beforeEach(() => {
  store = freshStore();
});

describe('move item across initiatives (AC-2.8)', () => {
  it('PATCH initiativeId moves the item to another initiative of the same roadmap', async () => {
    const { roadmap, item } = await seedRoadmap(store);
    const other = await (
      await postInitiative(reqAs(OWNER, 'POST', { name: 'Infra' }), {
        params: { id: roadmap.id },
      })
    ).json();

    const res = await patchItem(
      reqAs(OWNER, 'PATCH', { initiativeId: other.initiative.id }),
      { params: { id: item.id } },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.item.initiativeId).toBe(other.initiative.id);
    // dates untouched by a pure lane move
    expect(body.item.startDate).toBe(item.startDate);
    expect(body.item.endDate).toBe(item.endDate);
  });

  it('rejects an initiative belonging to another roadmap', async () => {
    const { item } = await seedRoadmap(store);
    const foreign = await (
      await postRoadmap(
        reqAs(OWNER, 'POST', {
          title: 'Other',
          startMonth: '2026-07-01',
          endMonth: '2026-12-01',
        }),
      )
    ).json();

    const res = await patchItem(
      reqAs(OWNER, 'PATCH', { initiativeId: foreign.initiatives[0].id }),
      { params: { id: item.id } },
    );
    expect(res.status).toBe(400);
    expect((await store.getItem(item.id))!.initiativeId).toBe(item.initiativeId);
  });
});

describe('convert item into a sprint of another item (F-11)', () => {
  it('moves the item under the target as a sprint, flattens its sprints, expands target dates (AC-11.1)', async () => {
    const { roadmap, initiative, item } = await seedRoadmap(store);
    // seeded: item "Signup revamp" (08-01..09-15) with sprint "Sprint 1".
    const target = (
      await (
        await postItem(
          reqAs(OWNER, 'POST', {
            initiativeId: initiative.id,
            title: 'Payments v2',
            startDate: '2026-08-20',
            endDate: '2026-09-01',
          }),
          { params: { id: roadmap.id } },
        )
      ).json()
    ).item;

    const res = await convertItem(
      reqAs(OWNER, 'POST', { targetItemId: target.id }),
      { params: { id: item.id } },
    );
    expect(res.status).toBe(201);
    const { item: updated } = await res.json();

    expect(updated.id).toBe(target.id);
    // target grew to cover the source's span
    expect(updated.startDate).toBe('2026-08-01');
    expect(updated.endDate).toBe('2026-09-15');
    expect(updated.sprintCount).toBe(2); // source item + its flattened sprint

    const sprints = await store.listSprints(target.id);
    const names = sprints.map((s) => s.name).sort();
    expect(names).toEqual(['Signup revamp', 'Sprint 1']);
    const revamp = sprints.find((s) => s.name === 'Signup revamp')!;
    expect(revamp.startDate).toBe('2026-08-01');
    expect(revamp.endDate).toBe('2026-09-15');

    expect(await store.getItem(item.id)).toBeNull();
  });

  it('rejects converting an item into itself and cross-roadmap targets (AC-11.2)', async () => {
    const { item } = await seedRoadmap(store);
    const self = await convertItem(reqAs(OWNER, 'POST', { targetItemId: item.id }), {
      params: { id: item.id },
    });
    expect(self.status).toBe(400);

    const foreign = await (
      await postRoadmap(
        reqAs(OWNER, 'POST', {
          title: 'Other',
          startMonth: '2026-07-01',
          endMonth: '2026-12-01',
        }),
      )
    ).json();
    const foreignItem = (
      await (
        await postItem(
          reqAs(OWNER, 'POST', {
            initiativeId: foreign.initiatives[0].id,
            title: 'Elsewhere',
            startDate: '2026-08-01',
            endDate: '2026-08-10',
          }),
          { params: { id: foreign.roadmap.id } },
        )
      ).json()
    ).item;

    const cross = await convertItem(
      reqAs(OWNER, 'POST', { targetItemId: foreignItem.id }),
      { params: { id: item.id } },
    );
    expect(cross.status).toBe(400);
    expect(await store.getItem(item.id)).not.toBeNull();

    const missing = await convertItem(reqAs(OWNER, 'POST', {}), {
      params: { id: item.id },
    });
    expect(missing.status).toBe(400);
  });

  it('viewers cannot convert; editors can (AC-11.3)', async () => {
    const { roadmap, initiative, item } = await seedRoadmap(store);
    const target = (
      await (
        await postItem(
          reqAs(OWNER, 'POST', {
            initiativeId: initiative.id,
            title: 'Payments v2',
            startDate: '2026-08-20',
            endDate: '2026-09-01',
          }),
          { params: { id: roadmap.id } },
        )
      ).json()
    ).item;

    const denied = await convertItem(
      reqAs(VIEWER, 'POST', { targetItemId: target.id }),
      { params: { id: item.id } },
    );
    expect(denied.status).toBe(403);
    expect(await store.getItem(item.id)).not.toBeNull();

    const allowed = await convertItem(
      reqAs(EDITOR, 'POST', { targetItemId: target.id }),
      { params: { id: item.id } },
    );
    expect(allowed.status).toBe(201);
  });
});

describe('convert initiative into an item (F-10)', () => {
  it('turns the initiative into an item of the target; its items become sprints, existing sprints flatten (AC-10.1)', async () => {
    const { roadmap, initiative, item } = await seedRoadmap(store);
    // seeded: initiative "Onboarding" with item "Signup revamp" (08-01..09-15)
    // that already has sprint "Sprint 1" (08-03..08-14).
    await postItem(
      reqAs(OWNER, 'POST', {
        initiativeId: initiative.id,
        title: 'Legal review',
        startDate: '2026-07-15',
        endDate: '2026-08-10',
        dris: 'Ada',
      }),
      { params: { id: roadmap.id } },
    );
    const target = (
      await (
        await postInitiative(reqAs(OWNER, 'POST', { name: 'Infra' }), {
          params: { id: roadmap.id },
        })
      ).json()
    ).initiative;

    const res = await convertInitiative(
      reqAs(OWNER, 'POST', { targetInitiativeId: target.id }),
      { params: { id: initiative.id } },
    );
    expect(res.status).toBe(201);
    const { item: converted } = await res.json();

    expect(converted.title).toBe('Onboarding');
    expect(converted.initiativeId).toBe(target.id);
    expect(converted.startDate).toBe('2026-07-15'); // envelope min
    expect(converted.endDate).toBe('2026-09-15'); // envelope max
    expect(converted.sprintCount).toBe(3); // 2 items + 1 flattened sprint

    const sprints = await store.listSprints(converted.id);
    const names = sprints.map((s) => s.name).sort();
    expect(names).toEqual(['Legal review', 'Signup revamp', 'Sprint 1'].sort());
    const legal = sprints.find((s) => s.name === 'Legal review')!;
    expect(legal.startDate).toBe('2026-07-15');
    expect(legal.endDate).toBe('2026-08-10');
    expect(legal.dri).toBe('Ada'); // item dris carries over to sprint dri

    // source initiative and its items are gone
    expect(await store.getInitiative(initiative.id)).toBeNull();
    expect(await store.getItem(item.id)).toBeNull();
    expect(await store.countItemsInInitiative(initiative.id)).toBe(0);
  });

  it('converts an empty initiative to a default two-week item with no sprints (AC-10.2)', async () => {
    const { roadmap } = await seedRoadmap(store);
    const empty = (
      await (
        await postInitiative(reqAs(OWNER, 'POST', { name: 'Placeholder' }), {
          params: { id: roadmap.id },
        })
      ).json()
    ).initiative;
    const target = (
      await (
        await postInitiative(reqAs(OWNER, 'POST', { name: 'Infra' }), {
          params: { id: roadmap.id },
        })
      ).json()
    ).initiative;

    const res = await convertInitiative(
      reqAs(OWNER, 'POST', { targetInitiativeId: target.id }),
      { params: { id: empty.id } },
    );
    expect(res.status).toBe(201);
    const { item: converted } = await res.json();
    expect(converted.startDate).toBe('2026-07-01');
    expect(converted.endDate).toBe('2026-07-14');
    expect(converted.sprintCount).toBe(0);
  });

  it('rejects converting an initiative into itself (AC-10.3)', async () => {
    const { initiative } = await seedRoadmap(store);
    const res = await convertInitiative(
      reqAs(OWNER, 'POST', { targetInitiativeId: initiative.id }),
      { params: { id: initiative.id } },
    );
    expect(res.status).toBe(400);
    expect(await store.getInitiative(initiative.id)).not.toBeNull();
  });

  it('rejects a target initiative on another roadmap (AC-10.3)', async () => {
    const { initiative } = await seedRoadmap(store);
    const foreign = await (
      await postRoadmap(
        reqAs(OWNER, 'POST', {
          title: 'Other',
          startMonth: '2026-07-01',
          endMonth: '2026-12-01',
        }),
      )
    ).json();

    const res = await convertInitiative(
      reqAs(OWNER, 'POST', { targetInitiativeId: foreign.initiatives[0].id }),
      { params: { id: initiative.id } },
    );
    expect(res.status).toBe(400);
    expect(await store.getInitiative(initiative.id)).not.toBeNull();
  });

  it('404s on an unknown source and 400s on a missing target id', async () => {
    const { initiative } = await seedRoadmap(store);
    const missing = await convertInitiative(
      reqAs(OWNER, 'POST', { targetInitiativeId: initiative.id }),
      { params: { id: 'nope' } },
    );
    expect(missing.status).toBe(404);

    const noTarget = await convertInitiative(reqAs(OWNER, 'POST', {}), {
      params: { id: initiative.id },
    });
    expect(noTarget.status).toBe(400);
  });

  it('viewers cannot convert; editors can (AC-10.4)', async () => {
    const { roadmap, initiative } = await seedRoadmap(store);
    const target = (
      await (
        await postInitiative(reqAs(OWNER, 'POST', { name: 'Infra' }), {
          params: { id: roadmap.id },
        })
      ).json()
    ).initiative;

    const denied = await convertInitiative(
      reqAs(VIEWER, 'POST', { targetInitiativeId: target.id }),
      { params: { id: initiative.id } },
    );
    expect(denied.status).toBe(403);
    expect(await store.getInitiative(initiative.id)).not.toBeNull();

    const allowed = await convertInitiative(
      reqAs(EDITOR, 'POST', { targetInitiativeId: target.id }),
      { params: { id: initiative.id } },
    );
    expect(allowed.status).toBe(201);
  });
});
