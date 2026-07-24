import { beforeEach, describe, expect, it } from 'vitest';
import { GET as getInvite, POST as postInvite, DELETE as deleteInvite } from '@/app/api/roadmaps/[id]/invite/route';
import { POST as postJoin } from '@/app/api/join/[token]/route';
import { GET as getRoadmap } from '@/app/api/roadmaps/[id]/route';
import { PATCH as patchRoadmap } from '@/app/api/roadmaps/[id]/route';
import { GET as getMyRoadmaps } from '@/app/api/me/roadmaps/route';
import { DELETE as deleteShare } from '@/app/api/shares/[id]/route';
import type { MemoryStore } from '@/lib/store';
import { OWNER, STRANGER, VIEWER, freshStore, reqAs, seedRoadmap } from './harness';

let store: MemoryStore;
let seeded: Awaited<ReturnType<typeof seedRoadmap>>;

beforeEach(async () => {
  store = freshStore();
  seeded = await seedRoadmap(store);
});

const rid = () => ({ params: { id: seeded.roadmap.id } });

async function ownerToken(): Promise<string> {
  const res = await postInvite(reqAs(OWNER, 'POST'), rid());
  expect(res.status).toBe(201);
  return (await res.json()).token;
}

describe('invite token management (owner only)', () => {
  it('generates, reads, rotates, and disables the token', async () => {
    expect((await (await getInvite(reqAs(OWNER), rid())).json()).token).toBeNull();

    const token = await ownerToken();
    expect(token.length).toBeGreaterThanOrEqual(20);
    expect((await (await getInvite(reqAs(OWNER), rid())).json()).token).toBe(token);

    const rotated = await ownerToken();
    expect(rotated).not.toBe(token);

    await deleteInvite(reqAs(OWNER, 'DELETE'), rid());
    expect((await (await getInvite(reqAs(OWNER), rid())).json()).token).toBeNull();
  });

  it('rejects non-owners on all three invite verbs (authorization matrix)', async () => {
    for (const caller of [
      { identity: VIEWER, status: 403 },
      { identity: STRANGER, status: 403 },
      { identity: null, status: 401 },
    ]) {
      expect((await getInvite(reqAs(caller.identity), rid())).status).toBe(caller.status);
      expect((await postInvite(reqAs(caller.identity, 'POST'), rid())).status).toBe(caller.status);
      expect((await deleteInvite(reqAs(caller.identity, 'DELETE'), rid())).status).toBe(caller.status);
    }
  });
});

describe('claiming an invite (POST /api/join/:token)', () => {
  it('binds the claimant uid as a viewer with read access and 403 on writes', async () => {
    const token = await ownerToken();

    const claim = await postJoin(reqAs(STRANGER, 'POST'), { params: { token } });
    expect(claim.status).toBe(200);
    expect((await claim.json()).roadmapId).toBe(seeded.roadmap.id);

    const read = await getRoadmap(reqAs(STRANGER), rid());
    expect(read.status).toBe(200);
    expect((await read.json()).role).toBe('viewer');

    const write = await patchRoadmap(reqAs(STRANGER, 'PATCH', { title: 'hacked' }), rid());
    expect(write.status).toBe(403);

    // Share row carries the verified uid + name for the owner's panel.
    const shares = await store.listShares(seeded.roadmap.id);
    const uidShare = shares.find((s) => s.memberUid === STRANGER.uid);
    expect(uidShare?.memberName).toBe(STRANGER.name);
  });

  it('requires authentication (link grants nothing anonymously)', async () => {
    const token = await ownerToken();
    expect((await postJoin(reqAs(null, 'POST'), { params: { token } })).status).toBe(401);
  });

  it('404s on unknown or disabled tokens', async () => {
    expect((await postJoin(reqAs(STRANGER, 'POST'), { params: { token: 'nope' } })).status).toBe(404);

    const token = await ownerToken();
    await deleteInvite(reqAs(OWNER, 'DELETE'), rid());
    expect((await postJoin(reqAs(STRANGER, 'POST'), { params: { token } })).status).toBe(404);
  });

  it('rotating the token invalidates the old link but keeps claimed viewers', async () => {
    const token = await ownerToken();
    await postJoin(reqAs(STRANGER, 'POST'), { params: { token } });

    await ownerToken(); // rotate
    expect((await postJoin(reqAs({ ...STRANGER, uid: 'other' }, 'POST'), { params: { token } })).status).toBe(404);
    // claimed viewer keeps access
    expect((await getRoadmap(reqAs(STRANGER), rid())).status).toBe(200);
  });

  it('owner and existing-viewer claims are no-ops (no duplicate rows)', async () => {
    const token = await ownerToken();
    const before = (await store.listShares(seeded.roadmap.id)).length;

    expect((await postJoin(reqAs(OWNER, 'POST'), { params: { token } })).status).toBe(200);
    await postJoin(reqAs(STRANGER, 'POST'), { params: { token } });
    await postJoin(reqAs(STRANGER, 'POST'), { params: { token } });

    const after = await store.listShares(seeded.roadmap.id);
    expect(after.length).toBe(before + 1); // only the stranger's single row
  });

  it('claim updates last-visited and the roadmap appears in the profile shared list', async () => {
    const token = await ownerToken();
    await postJoin(reqAs(STRANGER, 'POST'), { params: { token } });

    const lists = await (await getMyRoadmaps(reqAs(STRANGER))).json();
    expect(lists.shared).toHaveLength(1);
    expect(lists.shared[0].id).toBe(seeded.roadmap.id);

    const state = await store.getUserState(STRANGER.uid);
    expect(state?.lastRoadmapId).toBe(seeded.roadmap.id);
  });

  it('removing a claimed share revokes access (AC-6.4 equivalent)', async () => {
    const token = await ownerToken();
    await postJoin(reqAs(STRANGER, 'POST'), { params: { token } });

    const share = (await store.listShares(seeded.roadmap.id)).find(
      (s) => s.memberUid === STRANGER.uid,
    )!;
    await deleteShare(reqAs(OWNER, 'DELETE'), { params: { id: share.id } });
    expect((await getRoadmap(reqAs(STRANGER), rid())).status).toBe(403);
  });

  it('deleting the roadmap clears its invite token mapping', async () => {
    const token = await ownerToken();
    await store.deleteRoadmap(seeded.roadmap.id);
    expect(await store.findRoadmapByInviteToken(token)).toBeNull();
  });
});
