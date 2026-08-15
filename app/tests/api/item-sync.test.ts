import { beforeEach, describe, expect, it } from 'vitest';
import { OWNER, STRANGER, freshStore, json, reqAs, seedRoadmap } from './harness';
import * as importRoute from '@/app/api/roadmaps/[id]/items/import/route';
import * as itemRoute from '@/app/api/items/[id]/route';
import * as itemSprintsRoute from '@/app/api/items/[id]/sprints/route';
import * as sprintRoute from '@/app/api/sprints/[id]/route';
import type { MemoryStore } from '@/lib/store';
import type { Roadmap, RoadmapItem } from '@/lib/types';

describe('F-15 cross-roadmap synced items', () => {
  let store: MemoryStore;
  beforeEach(() => {
    store = freshStore();
  });

  /** Second roadmap owned by OWNER with one initiative, same date range. */
  async function seedTarget(): Promise<{ roadmap: Roadmap; initiativeId: string }> {
    const roadmap = await store.createRoadmap(
      { uid: OWNER.uid, email: OWNER.email },
      {
        title: 'Q3 Team Roadmap',
        startMonth: '2026-07-01',
        endMonth: '2026-12-01',
      },
    );
    const initiative = await store.createInitiative(roadmap.id, 'Delivery');
    return { roadmap, initiativeId: initiative.id };
  }

  async function importInto(
    target: { roadmap: Roadmap; initiativeId: string },
    sourceItemId: string,
  ): Promise<{ status: number; item?: RoadmapItem & { sprintCount: number } }> {
    const res = await importRoute.POST(
      reqAs(OWNER, 'POST', { sourceItemId, initiativeId: target.initiativeId }),
      { params: { id: target.roadmap.id } },
    );
    return { status: res.status, item: res.status === 201 ? (await json(res)).item : undefined };
  }

  it('imports an item with sprints as a linked copy', async () => {
    const { item, sprint } = await seedRoadmap(store);
    const target = await seedTarget();

    const { status, item: copy } = await importInto(target, item.id);
    expect(status).toBe(201);
    expect(copy!.title).toBe(item.title);
    expect(copy!.startDate).toBe(item.startDate);
    expect(copy!.roadmapId).toBe(target.roadmap.id);
    expect(copy!.initiativeId).toBe(target.initiativeId);
    expect(copy!.sprintCount).toBe(1);

    // both copies share a group; so do the sprint pairs
    const sourceAfter = await store.getItem(item.id);
    expect(sourceAfter!.syncGroupId).not.toBeNull();
    expect(copy!.syncGroupId).toBe(sourceAfter!.syncGroupId);
    const copySprints = await store.listSprints(copy!.id);
    const sourceSprint = await store.getSprint(sprint.id);
    expect(copySprints[0].syncGroupId).toBe(sourceSprint!.syncGroupId);
    expect(copySprints[0].syncGroupId).not.toBeNull();
  });

  it('guards: same roadmap, foreign source, bad initiative, out-of-range dates', async () => {
    const { roadmap, initiative, item } = await seedRoadmap(store);
    const target = await seedTarget();

    // same roadmap
    const same = await importRoute.POST(
      reqAs(OWNER, 'POST', { sourceItemId: item.id, initiativeId: initiative.id }),
      { params: { id: roadmap.id } },
    );
    expect(same.status).toBe(400);

    // caller has no access to the source roadmap → 404, not 403
    const foreign = await importRoute.POST(
      reqAs(STRANGER, 'POST', { sourceItemId: item.id, initiativeId: target.initiativeId }),
      { params: { id: target.roadmap.id } },
    );
    expect(foreign.status).toBe(403); // stranger can't even write the target

    const strangerMap = await store.createRoadmap(
      { uid: STRANGER.uid, email: STRANGER.email },
      { title: 'Stranger map', startMonth: '2026-07-01', endMonth: '2026-12-01' },
    );
    const strangerIni = await store.createInitiative(strangerMap.id, 'Theirs');
    const noSource = await importRoute.POST(
      reqAs(STRANGER, 'POST', { sourceItemId: item.id, initiativeId: strangerIni.id }),
      { params: { id: strangerMap.id } },
    );
    expect(noSource.status).toBe(404);

    // initiative from another roadmap
    const badIni = await importRoute.POST(
      reqAs(OWNER, 'POST', { sourceItemId: item.id, initiativeId: initiative.id }),
      { params: { id: target.roadmap.id } },
    );
    expect(badIni.status).toBe(400);

    // narrow target range → dates don't fit
    const narrow = await store.createRoadmap(
      { uid: OWNER.uid, email: OWNER.email },
      { title: 'Narrow', startMonth: '2026-10-01', endMonth: '2026-12-01' },
    );
    const narrowIni = await store.createInitiative(narrow.id, 'Tight');
    const outOfRange = await importRoute.POST(
      reqAs(OWNER, 'POST', { sourceItemId: item.id, initiativeId: narrowIni.id }),
      { params: { id: narrow.id } },
    );
    expect(outOfRange.status).toBe(400);
    expect((await json(outOfRange)).error).toContain('range');
  });

  it('content edits propagate to linked copies; placement does not', async () => {
    const { item, initiative } = await seedRoadmap(store);
    const target = await seedTarget();
    const { item: copy } = await importInto(target, item.id);

    const res = await itemRoute.PATCH(
      reqAs(OWNER, 'PATCH', { title: 'Renamed everywhere', endDate: '2026-10-01', status: 'red' }),
      { params: { id: item.id } },
    );
    expect(res.status).toBe(200);

    const mirrored = await store.getItem(copy!.id);
    expect(mirrored!.title).toBe('Renamed everywhere');
    expect(mirrored!.endDate).toBe('2026-10-01');
    expect(mirrored!.status).toBe('red');
    // placement is per-roadmap
    expect(mirrored!.initiativeId).toBe(target.initiativeId);

    // moving the source between initiatives never moves the copy
    const second = await store.createInitiative((await store.getItem(item.id))!.roadmapId, 'Other');
    await itemRoute.PATCH(reqAs(OWNER, 'PATCH', { initiativeId: second.id }), {
      params: { id: item.id },
    });
    expect((await store.getItem(item.id))!.initiativeId).toBe(second.id);
    expect((await store.getItem(copy!.id))!.initiativeId).toBe(target.initiativeId);
    expect(initiative.id).not.toBe(second.id);
  });

  it('sprint create, update, and delete propagate across copies', async () => {
    const { item } = await seedRoadmap(store);
    const target = await seedTarget();
    const { item: copy } = await importInto(target, item.id);

    // create on the source → appears on the copy
    const created = await itemSprintsRoute.POST(
      reqAs(OWNER, 'POST', { name: 'Sync sprint', startDate: '2026-08-17', endDate: '2026-08-28' }),
      { params: { id: item.id } },
    );
    expect(created.status).toBe(201);
    const createdSprint = (await json(created)).sprint;
    const copySprints = await store.listSprints(copy!.id);
    expect(copySprints.map((s) => s.name)).toContain('Sync sprint');
    const twin = copySprints.find((s) => s.name === 'Sync sprint')!;
    expect(twin.syncGroupId).toBe(createdSprint.syncGroupId);

    // update on the copy's twin → source sprint follows
    const upd = await sprintRoute.PATCH(reqAs(OWNER, 'PATCH', { name: 'Renamed sprint' }), {
      params: { id: twin.id },
    });
    expect(upd.status).toBe(200);
    expect((await store.getSprint(createdSprint.id))!.name).toBe('Renamed sprint');

    // delete on the source → twin disappears
    const del = await sprintRoute.DELETE(reqAs(OWNER, 'DELETE'), {
      params: { id: createdSprint.id },
    });
    expect(del.status).toBe(200);
    expect(await store.getSprint(twin.id)).toBeNull();
  });

  it('deleting one copy leaves the other roadmap untouched', async () => {
    const { item } = await seedRoadmap(store);
    const target = await seedTarget();
    const { item: copy } = await importInto(target, item.id);

    const res = await itemRoute.DELETE(reqAs(OWNER, 'DELETE'), { params: { id: copy!.id } });
    expect(res.status).toBe(200);
    expect(await store.getItem(copy!.id)).toBeNull();
    expect(await store.getItem(item.id)).not.toBeNull();
    expect(await store.listSprints(item.id)).toHaveLength(1);
  });

  it('GET /api/items/[id] returns the full initiative list for the move dropdown', async () => {
    const { roadmap, item } = await seedRoadmap(store);
    await store.createInitiative(roadmap.id, 'Growth');
    const res = await itemRoute.GET(reqAs(OWNER), { params: { id: item.id } });
    const body = await json(res);
    expect(body.initiatives.map((i: { name: string }) => i.name)).toEqual([
      'Onboarding',
      'Growth',
    ]);
  });
});
