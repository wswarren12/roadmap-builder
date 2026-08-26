import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as listBacklog, POST as createBacklog } from '@/app/api/backlog/route';
import { DELETE as deleteBacklog, GET as getBacklog, PATCH as patchBacklog } from '@/app/api/backlog/[id]/route';
import { POST as importBacklog } from '@/app/api/backlog/[id]/import/route';
import { POST as moveToBacklog } from '@/app/api/items/[id]/backlog/route';
import { EDITOR, OWNER, STRANGER, freshStore, json, reqAs, seedRoadmap } from './harness';
import type { MemoryStore } from '@/lib/store';

const ctx = (id: string) => ({ params: { id } });

describe('personal backlog API', () => {
  let store: MemoryStore;
  beforeEach(() => { store = freshStore(); });

  it('supports owner-scoped direct CRUD without dates', async () => {
    const created = await createBacklog(reqAs(OWNER, 'POST', { title: 'Unscheduled idea', description: 'Later' }));
    expect(created.status).toBe(201);
    const item = (await json(created)).item;
    expect(item).toMatchObject({ ownerUid: OWNER.uid, title: 'Unscheduled idea', sprints: [] });
    expect(JSON.stringify(item)).not.toContain('startDate');

    expect((await listBacklog(reqAs(STRANGER))).status).toBe(200);
    expect((await json(await listBacklog(reqAs(STRANGER)))).items).toEqual([]);
    expect((await getBacklog(reqAs(STRANGER), ctx(item.id))).status).toBe(404);

    const updated = await patchBacklog(reqAs(OWNER, 'PATCH', { title: 'Refined idea', status: 'yellow' }), ctx(item.id));
    expect((await json(updated)).item).toMatchObject({ title: 'Refined idea', status: 'yellow' });
    expect((await deleteBacklog(reqAs(STRANGER, 'DELETE'), ctx(item.id))).status).toBe(404);
    expect((await deleteBacklog(reqAs(OWNER, 'DELETE'), ctx(item.id))).status).toBe(204);
  });

  it('allows only the roadmap owner to atomically move one linked copy and scrubs every date', async () => {
    const seeded = await seedRoadmap(store);
    await store.updateItem(seeded.item.id, { milestoneDate: '2026-08-20', completedAt: '2026-09-01' });
    await store.updateSprint(seeded.sprint.id, { milestoneDate: '2026-08-08', completedAt: '2026-08-14' });
    await store.setItemSyncGroup(seeded.item.id, 'group');
    const otherRoadmap = await store.createRoadmap({ uid: OWNER.uid, email: OWNER.email }, { title: 'Other', startMonth: '2026-07-01', endMonth: '2026-12-01' });
    const otherInitiative = await store.createInitiative(otherRoadmap.id, 'Other');
    const sibling = await store.createItem(otherRoadmap.id, { initiativeId: otherInitiative.id, title: 'Sibling', startDate: '2026-08-01', endDate: '2026-09-15' }, 0, 'group');

    expect((await moveToBacklog(reqAs(EDITOR, 'POST'), ctx(seeded.item.id))).status).toBe(403);
    const moved = await moveToBacklog(reqAs(OWNER, 'POST'), ctx(seeded.item.id));
    expect(moved.status).toBe(201);
    const backlog = (await json(moved)).item;
    expect(await store.getItem(seeded.item.id)).toBeNull();
    expect(await store.getItem(sibling.id)).not.toBeNull();
    expect(backlog.sprints).toHaveLength(1);
    const { createdAt: _created, updatedAt: _updated, ...dateFreePayload } = backlog;
    expect(JSON.stringify(dateFreePayload)).not.toMatch(/2026-|completedAt|syncGroupId/);
  });

  it('requires writable destination, matching initiative and dates, then consumes on success', async () => {
    const seeded = await seedRoadmap(store);
    const moved = await moveToBacklog(reqAs(OWNER, 'POST'), ctx(seeded.item.id));
    const id = (await json(moved)).item.id;
    const missingDates = await importBacklog(reqAs(OWNER, 'POST', { roadmapId: seeded.roadmap.id, initiativeId: seeded.initiative.id }), ctx(id));
    expect(missingDates.status).toBe(400);
    expect(await store.getBacklogItem(id, OWNER.uid)).not.toBeNull();

    const foreignInitiative = await store.createInitiative((await store.createRoadmap({ uid: STRANGER.uid, email: STRANGER.email }, { title: 'Foreign', startMonth: '2026-07-01', endMonth: '2026-12-01' })).id, 'Foreign');
    const wrongInitiative = await importBacklog(reqAs(OWNER, 'POST', { roadmapId: seeded.roadmap.id, initiativeId: foreignInitiative.id, startDate: '2026-10-01', endDate: '2026-10-20' }), ctx(id));
    expect(wrongInitiative.status).toBe(400);

    const imported = await importBacklog(reqAs(EDITOR, 'POST', { roadmapId: seeded.roadmap.id, initiativeId: seeded.initiative.id, startDate: '2026-10-01', endDate: '2026-10-20' }), ctx(id));
    expect(imported.status).toBe(404); // backlog belongs to OWNER, never to the editor

    const success = await importBacklog(reqAs(OWNER, 'POST', { roadmapId: seeded.roadmap.id, initiativeId: seeded.initiative.id, startDate: '2026-10-01', endDate: '2026-10-20' }), ctx(id));
    expect(success.status).toBe(201);
    const importedItem = (await json(success)).item;
    expect(importedItem).toMatchObject({ roadmapId: seeded.roadmap.id, syncGroupId: null, completedAt: null, sprintCount: 1 });
    expect(await store.getBacklogItem(id, OWNER.uid)).toBeNull();
  });

  it('serializes concurrent memory moves and imports so each item is transferred once', async () => {
    const seeded = await seedRoadmap(store);

    const moves = await Promise.allSettled([
      store.moveItemToBacklog(seeded.item.id, OWNER.uid),
      store.moveItemToBacklog(seeded.item.id, OWNER.uid),
    ]);
    expect(moves.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(moves.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(await store.listBacklogItems(OWNER.uid)).toHaveLength(1);
    expect(await store.getItem(seeded.item.id)).toBeNull();

    const [backlog] = await store.listBacklogItems(OWNER.uid);
    const target = {
      roadmapId: seeded.roadmap.id,
      initiativeId: seeded.initiative.id,
      startDate: '2026-10-01',
      endDate: '2026-10-20',
      colorIndex: 0,
    };
    const imports = await Promise.allSettled([
      store.importBacklogItem(backlog.id, OWNER.uid, target),
      store.importBacklogItem(backlog.id, OWNER.uid, target),
    ]);
    expect(imports.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(imports.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(await store.listBacklogItems(OWNER.uid)).toHaveLength(0);
    expect(await store.countItems(seeded.roadmap.id)).toBe(1);
  });

  it('serializes a delete-vs-import race without creating work after deletion', async () => {
    const seeded = await seedRoadmap(store);
    const backlog = await store.createBacklogItem(OWNER.uid, {
      title: 'Race candidate', description: '', milestoneText: '', okrs: '', dris: '',
      responsibleTeam: '', status: 'green', kpi: '', colorIndex: 0,
    });
    const countBefore = await store.countItems(seeded.roadmap.id);
    const target = {
      roadmapId: seeded.roadmap.id,
      initiativeId: seeded.initiative.id,
      startDate: '2026-10-01',
      endDate: '2026-10-20',
      colorIndex: 0,
    };

    const [deleted, imported] = await Promise.allSettled([
      store.deleteBacklogItem(backlog.id, OWNER.uid),
      store.importBacklogItem(backlog.id, OWNER.uid, target),
    ]);

    expect(deleted).toMatchObject({ status: 'fulfilled', value: true });
    expect(imported.status).toBe('rejected');
    expect(await store.getBacklogItem(backlog.id, OWNER.uid)).toBeNull();
    expect(await store.countItems(seeded.roadmap.id)).toBe(countBefore);
  });

  it('rolls back a backlog insert when source deletion fails during a move', async () => {
    const seeded = await seedRoadmap(store);
    const original = store.deleteItem.bind(store);
    vi.spyOn(store, 'deleteItem').mockRejectedValueOnce(new Error('delete failed'));

    await expect(store.moveItemToBacklog(seeded.item.id, OWNER.uid)).rejects.toThrow('delete failed');
    expect(await store.getItem(seeded.item.id)).not.toBeNull();
    expect(await store.getSprint(seeded.sprint.id)).not.toBeNull();
    expect(await store.listBacklogItems(OWNER.uid)).toHaveLength(0);
    vi.mocked(store.deleteItem).mockImplementation(original);
  });

  it('rolls back created roadmap rows and retains backlog when a child insert fails', async () => {
    const seeded = await seedRoadmap(store);
    const moved = await store.moveItemToBacklog(seeded.item.id, OWNER.uid);
    const countBefore = await store.countItems(seeded.roadmap.id);
    const original = store.createSprint.bind(store);
    vi.spyOn(store, 'createSprint').mockRejectedValueOnce(new Error('insert failed'));
    await expect(store.importBacklogItem(moved.id, OWNER.uid, {
      roadmapId: seeded.roadmap.id, initiativeId: seeded.initiative.id,
      startDate: '2026-10-01', endDate: '2026-10-20', colorIndex: 0,
    })).rejects.toThrow('insert failed');
    expect(await store.countItems(seeded.roadmap.id)).toBe(countBefore);
    expect(await store.getBacklogItem(moved.id, OWNER.uid)).not.toBeNull();
    vi.mocked(store.createSprint).mockImplementation(original);
  });
});
