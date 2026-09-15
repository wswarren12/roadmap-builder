import { beforeEach, describe, expect, it } from 'vitest';
import { DELETE, GET, PATCH, POST } from '@/app/api/roadmaps/[id]/backlog/route';
import { GET as getRoadmap } from '@/app/api/roadmaps/[id]/route';
import { PATCH as patchItem } from '@/app/api/items/[id]/route';
import { POST as postItem } from '@/app/api/roadmaps/[id]/items/route';
import type { MemoryStore } from '@/lib/store';
import { EDITOR, OWNER, STRANGER, VIEWER, freshStore, reqAs, seedRoadmap } from './harness';

let store: MemoryStore;

beforeEach(() => {
  store = freshStore();
});

const params = (id: string) => ({ params: { id } });

describe('roadmap board backlog', () => {
  it('editors create, edit and delete unscheduled items; they persist on the roadmap', async () => {
    const { roadmap: { id: roadmapId } } = await seedRoadmap(store);

    const created = await POST(
      reqAs(EDITOR, 'POST', { title: '  SSO audit ', status: 'yellow', dris: 'Ada' }),
      params(roadmapId),
    );
    expect(created.status).toBe(201);
    const { item } = await created.json();
    expect(item).toMatchObject({ title: 'SSO audit', status: 'yellow', dris: 'Ada' });

    // Persisted: the roadmap payload carries it on the next load.
    let body = await (await getRoadmap(reqAs(OWNER), params(roadmapId))).json();
    expect(body.roadmap.backlog).toHaveLength(1);
    expect(body.roadmap.backlog[0].id).toBe(item.id);

    const patched = await PATCH(
      reqAs(OWNER, 'PATCH', { id: item.id, status: 'deprioritized' }),
      params(roadmapId),
    );
    expect(patched.status).toBe(200);
    expect((await patched.json()).item).toMatchObject({ title: 'SSO audit', status: 'deprioritized' });

    const removed = await DELETE(
      new Request(`http://test.local/api?id=${item.id}`, {
        method: 'DELETE',
        headers: { cookie: `dev_user=${encodeURIComponent(JSON.stringify(OWNER))}` },
      }),
      params(roadmapId),
    );
    expect(removed.status).toBe(200);
    body = await (await getRoadmap(reqAs(OWNER), params(roadmapId))).json();
    expect(body.roadmap.backlog).toEqual([]);
  });

  it('rejects empty titles, unknown ids and invalid JSON', async () => {
    const { roadmap: { id: roadmapId } } = await seedRoadmap(store);
    expect((await POST(reqAs(OWNER, 'POST', { title: '  ' }), params(roadmapId))).status).toBe(400);
    expect((await PATCH(reqAs(OWNER, 'PATCH', { id: 'nope', title: 'x' }), params(roadmapId))).status).toBe(404);
    const noBody = new Request('http://test.local/api', {
      method: 'POST',
      headers: { cookie: `dev_user=${encodeURIComponent(JSON.stringify(OWNER))}` },
    });
    expect((await POST(noBody, params(roadmapId))).status).toBe(400);
  });

  it('is scoped to one roadmap — another roadmap never sees the entries', async () => {
    const { roadmap: { id: roadmapId } } = await seedRoadmap(store);
    const other = await store.createRoadmap(
      { uid: OWNER.uid, email: OWNER.email },
      { title: 'Other', startMonth: '2026-01-01', endMonth: '2026-06-01' },
    );
    await POST(reqAs(OWNER, 'POST', { title: 'Only here' }), params(roadmapId));

    const a = await (await getRoadmap(reqAs(OWNER), params(roadmapId))).json();
    const b = await (await getRoadmap(reqAs(OWNER), params(other.id))).json();
    expect(a.roadmap.backlog.map((e: { title: string }) => e.title)).toEqual(['Only here']);
    expect(b.roadmap.backlog).toEqual([]);
  });

  it('enforces the write tier: viewers/strangers 403, anonymous 401', async () => {
    const { roadmap: { id: roadmapId } } = await seedRoadmap(store);
    expect((await POST(reqAs(VIEWER, 'POST', { title: 'x' }), params(roadmapId))).status).toBe(403);
    expect((await POST(reqAs(STRANGER, 'POST', { title: 'x' }), params(roadmapId))).status).toBe(403);
    expect((await POST(reqAs(null, 'POST', { title: 'x' }), params(roadmapId))).status).toBe(401);
    expect((await PATCH(reqAs(VIEWER, 'PATCH', { id: 'x' }), params(roadmapId))).status).toBe(403);
    // Viewers can still read the backlog with the roadmap payload.
    const read = await getRoadmap(reqAs(VIEWER), params(roadmapId));
    expect(read.status).toBe(200);
    expect((await read.json()).roadmap.backlog).toEqual([]);
  });
});

describe('deprioritized status', () => {
  it('is accepted on create and update; unknown statuses are rejected on update', async () => {
    const seeded = await seedRoadmap(store);
    const roadmapId = seeded.roadmap.id;
    const initiativeId = seeded.initiative.id;
    const itemId = seeded.item.id;
    const created = await postItem(
      reqAs(OWNER, 'POST', {
        initiativeId,
        title: 'Parked',
        startDate: '2026-08-01',
        endDate: '2026-08-15',
        status: 'deprioritized',
      }),
      params(roadmapId),
    );
    expect(created.status).toBe(201);
    expect((await created.json()).item.status).toBe('deprioritized');

    const ok = await patchItem(reqAs(OWNER, 'PATCH', { status: 'deprioritized' }), params(itemId));
    expect(ok.status).toBe(200);
    const bad = await patchItem(reqAs(OWNER, 'PATCH', { status: 'purple' }), params(itemId));
    expect(bad.status).toBe(400);
  });
});

describe('kanban card moves reuse the item PATCH', () => {
  it('editors move cards (status / completion), viewers are rejected, other roadmaps untouched', async () => {
    const seeded = await seedRoadmap(store);
    const itemId = seeded.item.id;
    const other = await store.createRoadmap(
      { uid: OWNER.uid, email: OWNER.email },
      { title: 'Other', startMonth: '2026-07-01', endMonth: '2026-12-01' },
    );
    const otherIni = await store.createInitiative(other.id, 'X');
    const otherItem = await store.createItem(
      other.id,
      { initiativeId: otherIni.id, title: 'Elsewhere', startDate: '2026-08-01', endDate: '2026-08-10', status: 'red' },
      0,
    );

    const moved = await patchItem(reqAs(EDITOR, 'PATCH', { status: 'yellow', completedAt: null }), params(itemId));
    expect(moved.status).toBe(200);
    expect((await moved.json()).item).toMatchObject({ status: 'yellow', completedAt: null });

    const done = await patchItem(reqAs(EDITOR, 'PATCH', { completedAt: '2026-09-01' }), params(itemId));
    expect((await done.json()).item.completedAt).toBe('2026-09-01');

    expect((await patchItem(reqAs(VIEWER, 'PATCH', { status: 'red' }), params(itemId))).status).toBe(403);
    expect((await patchItem(reqAs(null, 'PATCH', { status: 'red' }), params(itemId))).status).toBe(401);

    // Persisted on the open roadmap only; the other roadmap's item is untouched.
    const body = await (await getRoadmap(reqAs(OWNER), params(seeded.roadmap.id))).json();
    expect(body.items.map((i: { id: string }) => i.id)).toEqual([itemId]);
    expect(body.items[0]).toMatchObject({ status: 'yellow', completedAt: '2026-09-01' });
    expect((await store.getItem(otherItem.id))!).toMatchObject({ status: 'red', completedAt: null });
  });
});

describe('roadmap-scoped backlog: reads, writes, moves and schedule', () => {
  async function twoRoadmaps() {
    const a = await seedRoadmap(store); // OWNER owns, EDITOR edits, VIEWER views
    const b = await store.createRoadmap({ uid: OWNER.uid, email: OWNER.email }, { title: 'B', startMonth: '2026-07-01', endMonth: '2026-12-01' });
    const bIni = await store.createInitiative(b.id, 'B-1');
    const bEntry = (await (await POST(reqAs(OWNER, 'POST', { title: 'B only' }), params(b.id))).json()).item;
    const aEntry = (await (await POST(reqAs(EDITOR, 'POST', { title: 'A only', kpi: 'k' }), params(a.roadmap.id))).json()).item;
    return { a, b, bIni, aEntry, bEntry };
  }

  it('GET lists only the open roadmap; cross-roadmap ids are not found on edit/delete/schedule', async () => {
    const { a, b, aEntry, bEntry } = await twoRoadmaps();
    const listA = await (await GET(reqAs(VIEWER), params(a.roadmap.id))).json();
    expect(listA.backlog.map((e: { title: string }) => e.title)).toEqual(['A only']);
    expect(listA.role).toBe('viewer');
    const listB = await (await GET(reqAs(OWNER), params(b.id))).json();
    expect(listB.backlog.map((e: { title: string }) => e.title)).toEqual(['B only']);

    // B's id through A's route (and vice versa) never resolves.
    expect((await PATCH(reqAs(OWNER, 'PATCH', { id: bEntry.id, title: 'hijack' }), params(a.roadmap.id))).status).toBe(404);
    const del = new Request(`http://test.local/api?id=${aEntry.id}`, { method: 'DELETE', headers: { cookie: `dev_user=${encodeURIComponent(JSON.stringify(OWNER))}` } });
    expect((await DELETE(del, params(b.id))).status).toBe(404);
    const sched = await postItem(
      reqAs(OWNER, 'POST', { initiativeId: a.initiative.id, title: 'x', startDate: '2026-08-01', endDate: '2026-08-10', fromBacklogId: bEntry.id }),
      params(a.roadmap.id),
    );
    expect(sched.status).toBe(404);
    // Nothing changed anywhere.
    expect((await store.getRoadmap(a.roadmap.id))!.backlog).toHaveLength(1);
    expect((await store.getRoadmap(b.id))!.backlog).toHaveLength(1);
    expect((await store.getRoadmap(b.id))!.backlog[0].title).toBe('B only');
  });

  it('viewers and strangers cannot read the other roadmap or mutate; anonymous is 401', async () => {
    const { a, b } = await twoRoadmaps();
    expect((await GET(reqAs(VIEWER), params(b.id))).status).toBe(403); // VIEWER has no access to B
    expect((await GET(reqAs(STRANGER), params(a.roadmap.id))).status).toBe(403);
    expect((await POST(reqAs(VIEWER, 'POST', { title: 'x' }), params(a.roadmap.id))).status).toBe(403);
    expect((await PATCH(reqAs(VIEWER, 'PATCH', { id: 'x' }), params(a.roadmap.id))).status).toBe(403);
    expect((await GET(reqAs(null), params(a.roadmap.id))).status).toBe(401);
  });

  it('moving a scheduled item keeps its sprints (dates scrubbed) in ITS roadmap only, owner-only', async () => {
    const { a, b } = await twoRoadmaps();
    await store.setItemSyncGroup(a.item.id, 'g');
    const sibling = await store.createItem(b.id, { initiativeId: (await store.createInitiative(b.id, 'S')).id, title: 'Sibling', startDate: '2026-08-01', endDate: '2026-09-15' }, 0, 'g');

    expect((await POST(reqAs(EDITOR, 'POST', { fromItemId: a.item.id }), params(a.roadmap.id))).status).toBe(403);
    // The item is on A; asking B to take it is not found on B.
    expect((await POST(reqAs(OWNER, 'POST', { fromItemId: a.item.id }), params(b.id))).status).toBe(404);

    const moved = await POST(reqAs(OWNER, 'POST', { fromItemId: a.item.id }), params(a.roadmap.id));
    expect(moved.status).toBe(201);
    const { item: entry } = await moved.json();
    expect(entry.sprints).toHaveLength(1);
    const { createdAt: _c, ...dateFree } = entry;
    expect(JSON.stringify(dateFree)).not.toMatch(/2026-|completedAt|syncGroupId/);
    expect(await store.getItem(a.item.id)).toBeNull();
    expect(await store.getItem(sibling.id)).not.toBeNull();
    expect((await store.getRoadmap(a.roadmap.id))!.backlog.map((e) => e.title)).toEqual(['A only', 'Signup revamp']);
    expect((await store.getRoadmap(b.id))!.backlog).toHaveLength(1);

    // Schedule it back with fromBacklogId: sprints rebuilt, entry consumed.
    const back = await postItem(
      reqAs(EDITOR, 'POST', { ...entry, initiativeId: a.initiative.id, startDate: '2026-10-01', endDate: '2026-10-20', fromBacklogId: entry.id }),
      params(a.roadmap.id),
    );
    expect(back.status).toBe(201);
    const { item } = await back.json();
    expect(item).toMatchObject({ roadmapId: a.roadmap.id, sprintCount: 1, syncGroupId: null });
    const sprints = await store.listSprints(item.id);
    expect(sprints).toHaveLength(1);
    expect(sprints[0].startDate >= '2026-10-01' && sprints[0].endDate <= '2026-10-20').toBe(true);
    expect((await store.getRoadmap(a.roadmap.id))!.backlog.map((e) => e.title)).toEqual(['A only']);
  });
});
