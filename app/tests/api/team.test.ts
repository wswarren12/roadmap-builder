import { beforeEach, describe, expect, it } from 'vitest';
import { GET as getTeam, POST as addMember } from '@/app/api/roadmaps/[id]/team/route';
import { POST as importTeam } from '@/app/api/roadmaps/[id]/team/import/route';
import { DELETE as removeMember } from '@/app/api/team-members/[id]/route';
import type { Identity } from '@/lib/types';
import type { MemoryStore } from '@/lib/store';
import { EDITOR, OWNER, STRANGER, VIEWER, freshStore, reqAs, seedRoadmap } from './harness';

/**
 * BDD scenarios — team roster & DRI avatars (F-13).
 *
 * - Given a roadmap with LabOS members joined via invite links, When an
 *   editor imports "people with access", Then the roster gains the requester
 *   and every uid-share member, deduped by uid across repeat imports
 *   (AC-13.1).
 * - Given the requester's LabOS profile has an image, When they import or
 *   load the team, Then their roster entry carries that image (AC-13.2).
 * - Given a manual name, When added, Then it has no uid/image (initials
 *   avatar); duplicate names are rejected with 409 (AC-13.3).
 * - Given a viewer, Then reading is allowed but add/import/remove are 403;
 *   strangers get 403 (AC-13.4).
 * - Given a roster member is removed, Then the roster no longer lists them
 *   (AC-13.5).
 */

let store: MemoryStore;

beforeEach(() => {
  store = freshStore();
});

const OWNER_WITH_IMAGE: Identity = {
  ...OWNER,
  image: 'https://images.test/olive.png',
};

describe('team roster (F-13)', () => {
  it('imports the requester and joined LabOS members, deduped across repeats (AC-13.1)', async () => {
    const { roadmap } = await seedRoadmap(store);
    // harness seeds: VIEWER as email whitelist (no uid), EDITOR as uid share

    const res = await importTeam(reqAs(OWNER, 'POST'), { params: { id: roadmap.id } });
    expect(res.status).toBe(200);
    const { members, added } = await res.json();
    expect(added).toBe(2); // owner (requester) + editor uid-share
    const names = members.map((m: { name: string }) => m.name).sort();
    expect(names).toEqual(['Ed Editor', 'Olive Owner']);
    expect(members.every((m: { memberUid: string | null }) => m.memberUid)).toBe(true);

    // re-import is a no-op
    const again = await importTeam(reqAs(OWNER, 'POST'), { params: { id: roadmap.id } });
    expect((await again.json()).added).toBe(0);
    expect(await store.listTeamMembers(roadmap.id)).toHaveLength(2);
  });

  it("captures the requester's profile image on import and on team load (AC-13.2)", async () => {
    const { roadmap } = await seedRoadmap(store);

    await importTeam(reqAs(OWNER, 'POST'), { params: { id: roadmap.id } });
    let mine = (await store.listTeamMembers(roadmap.id)).find(
      (m) => m.memberUid === OWNER.uid,
    )!;
    expect(mine.image).toBeNull();

    // next visit, LabOS now serves an image → GET refreshes the entry
    const res = await getTeam(reqAs(OWNER_WITH_IMAGE), { params: { id: roadmap.id } });
    expect(res.status).toBe(200);
    mine = (await res.json()).members.find(
      (m: { memberUid: string | null }) => m.memberUid === OWNER.uid,
    );
    expect(mine.image).toBe('https://images.test/olive.png');
  });

  it('manual entries have no uid/image; duplicate names 409 (AC-13.3)', async () => {
    const { roadmap } = await seedRoadmap(store);

    const res = await addMember(reqAs(OWNER, 'POST', { name: '  Maria Garcia  ' }), {
      params: { id: roadmap.id },
    });
    expect(res.status).toBe(201);
    const { member } = await res.json();
    expect(member.name).toBe('Maria Garcia');
    expect(member.memberUid).toBeNull();
    expect(member.image).toBeNull();

    const dupe = await addMember(reqAs(OWNER, 'POST', { name: 'maria garcia' }), {
      params: { id: roadmap.id },
    });
    expect(dupe.status).toBe(409);

    const blank = await addMember(reqAs(OWNER, 'POST', { name: '   ' }), {
      params: { id: roadmap.id },
    });
    expect(blank.status).toBe(400);
  });

  it('viewers read but cannot mutate; strangers are shut out (AC-13.4)', async () => {
    const { roadmap } = await seedRoadmap(store);
    await addMember(reqAs(OWNER, 'POST', { name: 'Maria Garcia' }), {
      params: { id: roadmap.id },
    });

    const read = await getTeam(reqAs(VIEWER), { params: { id: roadmap.id } });
    expect(read.status).toBe(200);
    expect((await read.json()).members).toHaveLength(1);

    expect(
      (
        await addMember(reqAs(VIEWER, 'POST', { name: 'Nope' }), {
          params: { id: roadmap.id },
        })
      ).status,
    ).toBe(403);
    expect(
      (await importTeam(reqAs(VIEWER, 'POST'), { params: { id: roadmap.id } })).status,
    ).toBe(403);
    expect(
      (await getTeam(reqAs(STRANGER), { params: { id: roadmap.id } })).status,
    ).toBe(403);

    // editors may manage the roster
    expect(
      (
        await addMember(reqAs(EDITOR, 'POST', { name: 'Ed Pick' }), {
          params: { id: roadmap.id },
        })
      ).status,
    ).toBe(201);
  });

  it('removes roster members (AC-13.5)', async () => {
    const { roadmap } = await seedRoadmap(store);
    const { member } = await (
      await addMember(reqAs(OWNER, 'POST', { name: 'Maria Garcia' }), {
        params: { id: roadmap.id },
      })
    ).json();

    const denied = await removeMember(reqAs(VIEWER, 'DELETE'), {
      params: { id: member.id },
    });
    expect(denied.status).toBe(403);

    const res = await removeMember(reqAs(OWNER, 'DELETE'), { params: { id: member.id } });
    expect(res.status).toBe(200);
    expect(await store.listTeamMembers(roadmap.id)).toHaveLength(0);

    const gone = await removeMember(reqAs(OWNER, 'DELETE'), { params: { id: member.id } });
    expect(gone.status).toBe(404);
  });
});
