import { beforeEach, describe, expect, it } from 'vitest';
import { GET as getRoadmap } from '@/app/api/roadmaps/[id]/route';
import { POST as postItem } from '@/app/api/roadmaps/[id]/items/route';
import { PATCH as patchItem } from '@/app/api/items/[id]/route';
import { POST as postSprint } from '@/app/api/items/[id]/sprints/route';
import { PATCH as patchSprint } from '@/app/api/sprints/[id]/route';
import { POST as importTeam } from '@/app/api/roadmaps/[id]/team/import/route';
import { GET as getMe } from '@/app/api/me/route';
import type { MemoryStore } from '@/lib/store';
import type { Identity } from '@/lib/types';
import { EDITOR, OWNER, VIEWER, freshStore, reqAs, seedRoadmap } from './harness';

/**
 * BDD scenarios — assignments resolve to LabOS profiles (F-13b).
 *
 * - Given a roster person, When an editor assigns them as DRI, Then the item
 *   stores the roster identity (not just a name) and it survives a reload
 *   (AC-13b.1).
 * - Given two roster people with the SAME display name, When each is assigned,
 *   Then the two assignments stay distinguishable (AC-13b.2).
 * - Given an assignment, When it is changed or cleared, Then the stored
 *   identity follows (AC-13b.3).
 * - Given a person id from another roadmap, Then the assignment is rejected
 *   (AC-13b.4).
 * - Given a viewer, Then changing an assignment is 403 and the saved
 *   assignment is untouched (AC-13b.5).
 * - Given a legacy free-typed DRI, Then it is preserved as-is with no
 *   identity (AC-13b.6).
 */

let store: MemoryStore;

beforeEach(() => {
  store = freshStore();
});

const params = (id: string) => ({ params: { id } });

/** Two distinct LabOS members who share a display name. */
const ALEX_ONE: Identity = { uid: 'u-alex-1', name: 'Alex Smith', email: null };
const ALEX_TWO: Identity = { uid: 'u-alex-2', name: 'Alex Smith', email: null };

async function seedWithRoster() {
  const seeded = await seedRoadmap(store);
  const roadmapId = seeded.roadmap.id;
  const ada = await store.addTeamMember(roadmapId, {
    name: 'Ada Lovelace',
    memberUid: 'u-ada',
    image: 'https://labos.example/ada.png',
  });
  const manual = await store.addTeamMember(roadmapId, { name: 'Contractor Kim' });
  return { ...seeded, roadmapId, ada, manual };
}

async function itemById(roadmapId: string, itemId: string) {
  const body = await (await getRoadmap(reqAs(OWNER), params(roadmapId))).json();
  return body.items.find((i: { id: string }) => i.id === itemId);
}

describe('assignments resolve to LabOS profile identities (F-13b)', () => {
  it('AC-13b.1 stores the roster identity for a picked DRI and it survives reload', async () => {
    const { roadmapId, initiative, ada } = await seedWithRoster();

    const res = await postItem(
      reqAs(EDITOR, 'POST', {
        initiativeId: initiative.id,
        title: 'Identity work',
        startDate: '2026-07-01',
        endDate: '2026-08-01',
        driMemberId: ada.id,
        responsibleTeam: 'Platform',
        responsibleTeamUid: 'team-platform',
      }),
      params(roadmapId),
    );
    expect(res.status).toBe(201);
    const { item } = await res.json();

    // The identity is stored, and the display text is taken from the roster
    // row rather than whatever the client typed.
    expect(item.driMemberId).toBe(ada.id);
    expect(item.dris).toBe('Ada Lovelace');
    expect(item.responsibleTeamUid).toBe('team-platform');

    const reloaded = await itemById(roadmapId, item.id);
    expect(reloaded.driMemberId).toBe(ada.id);
    expect(reloaded.dris).toBe('Ada Lovelace');
    expect(reloaded.responsibleTeam).toBe('Platform');
    expect(reloaded.responsibleTeamUid).toBe('team-platform');
  });

  it('AC-13b.2 keeps two same-named people distinguishable', async () => {
    const { roadmapId, initiative } = await seedWithRoster();
    const one = await store.addTeamMember(roadmapId, {
      name: ALEX_ONE.name,
      memberUid: ALEX_ONE.uid,
    });
    const two = await store.addTeamMember(roadmapId, {
      name: ALEX_TWO.name,
      memberUid: ALEX_TWO.uid,
    });
    expect(one.id).not.toBe(two.id);

    const mk = async (memberId: string) => {
      const res = await postItem(
        reqAs(EDITOR, 'POST', {
          initiativeId: initiative.id,
          title: `Work for ${memberId}`,
          startDate: '2026-07-01',
          endDate: '2026-08-01',
          driMemberId: memberId,
        }),
        params(roadmapId),
      );
      return (await res.json()).item;
    };
    const first = await mk(one.id);
    const second = await mk(two.id);

    // Same display name, different stored identities → different profiles.
    expect(first.dris).toBe(second.dris);
    expect(first.driMemberId).not.toBe(second.driMemberId);
    const rosterOne = await store.getTeamMember(first.driMemberId);
    const rosterTwo = await store.getTeamMember(second.driMemberId);
    expect(rosterOne?.memberUid).toBe(ALEX_ONE.uid);
    expect(rosterTwo?.memberUid).toBe(ALEX_TWO.uid);
  });

  it('AC-13b.2 imports a same-named LabOS member instead of silently skipping them', async () => {
    const { roadmapId } = await seedWithRoster();
    // A manual placeholder typed by hand before the person joined.
    await store.addTeamMember(roadmapId, { name: 'Ed Editor' });

    await importTeam(reqAs(EDITOR, 'POST'), params(roadmapId));

    const roster = await store.listTeamMembers(roadmapId);
    const eds = roster.filter((m) => m.name === 'Ed Editor');
    // The placeholder is linked to the real profile rather than duplicated.
    expect(eds).toHaveLength(1);
    expect(eds[0].memberUid).toBe(EDITOR.uid);
  });

  it('AC-13b.3 changes and clears an assignment', async () => {
    const { roadmapId, initiative, ada, manual } = await seedWithRoster();
    const created = await postItem(
      reqAs(EDITOR, 'POST', {
        initiativeId: initiative.id,
        title: 'Reassignable',
        startDate: '2026-07-01',
        endDate: '2026-08-01',
        driMemberId: ada.id,
      }),
      params(roadmapId),
    );
    const { item } = await created.json();

    const changed = await patchItem(
      reqAs(EDITOR, 'PATCH', { driMemberId: manual.id }),
      params(item.id),
    );
    expect(changed.status).toBe(200);
    expect((await changed.json()).item).toMatchObject({
      driMemberId: manual.id,
      dris: 'Contractor Kim',
    });

    const cleared = await patchItem(
      reqAs(EDITOR, 'PATCH', { driMemberId: null, responsibleTeamUid: null }),
      params(item.id),
    );
    const after = (await cleared.json()).item;
    expect(after.driMemberId).toBeNull();
    expect(after.dris).toBe('');
    expect(after.responsibleTeamUid).toBeNull();

    const reloaded = await itemById(roadmapId, item.id);
    expect(reloaded.driMemberId).toBeNull();
    expect(reloaded.dris).toBe('');
  });

  it('AC-13b.4 rejects a person who is not on this roadmap’s roster', async () => {
    const { roadmapId, initiative } = await seedWithRoster();
    const other = await seedRoadmap(store);
    const outsider = await store.addTeamMember(other.roadmap.id, {
      name: 'Outsider',
      memberUid: 'u-outsider',
    });

    const res = await postItem(
      reqAs(EDITOR, 'POST', {
        initiativeId: initiative.id,
        title: 'Foreign DRI',
        startDate: '2026-07-01',
        endDate: '2026-08-01',
        driMemberId: outsider.id,
      }),
      params(roadmapId),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).field).toBe('driMemberId');
  });

  it('AC-13b.5 a viewer cannot change an assignment and the saved one is preserved', async () => {
    const { roadmapId, initiative, ada, manual } = await seedWithRoster();
    const created = await postItem(
      reqAs(EDITOR, 'POST', {
        initiativeId: initiative.id,
        title: 'Read-only target',
        startDate: '2026-07-01',
        endDate: '2026-08-01',
        driMemberId: ada.id,
      }),
      params(roadmapId),
    );
    const { item } = await created.json();

    const denied = await patchItem(
      reqAs(VIEWER, 'PATCH', { driMemberId: manual.id }),
      params(item.id),
    );
    expect(denied.status).toBe(403);

    const reloaded = await itemById(roadmapId, item.id);
    expect(reloaded.driMemberId).toBe(ada.id);
    expect(reloaded.dris).toBe('Ada Lovelace');
  });

  it('AC-13b.6 preserves a legacy free-typed DRI with no identity', async () => {
    const { roadmapId, initiative } = await seedWithRoster();
    const res = await postItem(
      reqAs(EDITOR, 'POST', {
        initiativeId: initiative.id,
        title: 'Legacy text',
        startDate: '2026-07-01',
        endDate: '2026-08-01',
        dris: 'Someone Not On The Roster',
        responsibleTeam: 'Growth',
      }),
      params(roadmapId),
    );
    const { item } = await res.json();
    expect(item.dris).toBe('Someone Not On The Roster');
    expect(item.driMemberId).toBeNull();
    expect(item.responsibleTeam).toBe('Growth');
    expect(item.responsibleTeamUid).toBeNull();
  });

  it('assigns a sprint DRI by identity and rejects a foreign one', async () => {
    const { roadmapId, item, ada } = await seedWithRoster();
    const other = await seedRoadmap(store);
    const outsider = await store.addTeamMember(other.roadmap.id, { name: 'Outsider' });

    const created = await postSprint(
      reqAs(EDITOR, 'POST', {
        name: 'Sprint A',
        startDate: '2026-08-03',
        endDate: '2026-08-14',
        driMemberId: ada.id,
      }),
      params(item.id),
    );
    expect(created.status).toBe(201);
    const { sprint } = await created.json();
    expect(sprint.driMemberId).toBe(ada.id);
    expect(sprint.dri).toBe('Ada Lovelace');

    const bad = await patchSprint(
      reqAs(EDITOR, 'PATCH', { driMemberId: outsider.id }),
      params(sprint.id),
    );
    expect(bad.status).toBe(400);
    expect(roadmapId).toBeTruthy();
  });

  it('exposes only uid + name of the member’s own LabOS teams', async () => {
    const withTeams = {
      ...EDITOR,
      teams: [
        { uid: 't-1', name: 'Platform', role: 'Engineer', mainTeam: true, skills: ['Go'] },
      ],
    };
    const res = await getMe(reqAs(withTeams as unknown as Identity));
    const body = await res.json();
    expect(body.user.teams).toEqual([{ uid: 't-1', name: 'Platform' }]);
    // No role/mainTeam/skills leak into the app's own surface.
    expect(JSON.stringify(body.user.teams)).not.toContain('Engineer');
    expect(JSON.stringify(body.user.teams)).not.toContain('Go');
  });
});
