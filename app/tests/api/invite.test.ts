import { beforeEach, describe, expect, it } from 'vitest';
import { GET as getInvite, POST as postInvite, DELETE as deleteInvite } from '@/app/api/roadmaps/[id]/invite/route';
import { POST as postJoin } from '@/app/api/join/[token]/route';
import { GET as getRoadmap } from '@/app/api/roadmaps/[id]/route';
import { PATCH as patchRoadmap, DELETE as deleteRoadmap } from '@/app/api/roadmaps/[id]/route';
import { POST as postInitiative } from '@/app/api/roadmaps/[id]/initiatives/route';
import { GET as getMyRoadmaps } from '@/app/api/me/roadmaps/route';
import { DELETE as deleteShare } from '@/app/api/shares/[id]/route';
import type { MemoryStore } from '@/lib/store';
import { EDITOR, OWNER, STRANGER, VIEWER, freshStore, reqAs, seedRoadmap } from './harness';

let store: MemoryStore;
let seeded: Awaited<ReturnType<typeof seedRoadmap>>;

beforeEach(async () => {
  store = freshStore();
  seeded = await seedRoadmap(store);
});

const rid = () => ({ params: { id: seeded.roadmap.id } });

async function ownerToken(role: 'editor' | 'viewer' = 'viewer'): Promise<string> {
  const res = await postInvite(reqAs(OWNER, 'POST', { role }), rid());
  expect(res.status).toBe(201);
  return (await res.json()).token;
}

async function readTokens(): Promise<{ editor: string | null; viewer: string | null }> {
  const res = await getInvite(reqAs(OWNER), rid());
  expect(res.status).toBe(200);
  return (await res.json()).tokens;
}

describe('invite token management (owner only, one token per role)', () => {
  it('starts with no tokens for either role', async () => {
    expect(await readTokens()).toEqual({ editor: null, viewer: null });
  });

  it('generates, reads, rotates, and disables each role token independently', async () => {
    const viewerToken = await ownerToken('viewer');
    expect(viewerToken.length).toBeGreaterThanOrEqual(20);
    expect(await readTokens()).toEqual({ editor: null, viewer: viewerToken });

    const editorToken = await ownerToken('editor');
    expect(editorToken).not.toBe(viewerToken);
    expect(await readTokens()).toEqual({ editor: editorToken, viewer: viewerToken });

    // rotating the viewer link leaves the editor link alone
    const rotated = await ownerToken('viewer');
    expect(rotated).not.toBe(viewerToken);
    expect(await readTokens()).toEqual({ editor: editorToken, viewer: rotated });

    // disabling the editor link leaves the viewer link alone
    const off = await deleteInvite(reqAs(OWNER, 'DELETE', { role: 'editor' }), rid());
    expect(off.status).toBe(200);
    expect(await readTokens()).toEqual({ editor: null, viewer: rotated });
  });

  it('POST without a role defaults to a viewer link', async () => {
    const res = await postInvite(reqAs(OWNER, 'POST'), rid());
    expect(res.status).toBe(201);
    const { token } = await res.json();
    expect((await readTokens()).viewer).toBe(token);
  });

  it('rejects an invalid role', async () => {
    const res = await postInvite(reqAs(OWNER, 'POST', { role: 'admin' }), rid());
    expect(res.status).toBe(400);
  });

  it('rejects non-owners — including editors — on all three invite verbs', async () => {
    for (const caller of [
      { identity: EDITOR, status: 403 },
      { identity: VIEWER, status: 403 },
      { identity: STRANGER, status: 403 },
      { identity: null, status: 401 },
    ]) {
      expect((await getInvite(reqAs(caller.identity), rid())).status).toBe(caller.status);
      expect(
        (await postInvite(reqAs(caller.identity, 'POST', { role: 'viewer' }), rid())).status,
      ).toBe(caller.status);
      expect(
        (await deleteInvite(reqAs(caller.identity, 'DELETE', { role: 'viewer' }), rid())).status,
      ).toBe(caller.status);
    }
  });
});

describe('claiming a viewer invite (POST /api/join/:token)', () => {
  it('binds the claimant uid as a viewer with read access and 403 on writes', async () => {
    const token = await ownerToken('viewer');

    const claim = await postJoin(reqAs(STRANGER, 'POST'), { params: { token } });
    expect(claim.status).toBe(200);
    const claimBody = await claim.json();
    expect(claimBody.roadmapId).toBe(seeded.roadmap.id);
    expect(claimBody.role).toBe('viewer');

    const read = await getRoadmap(reqAs(STRANGER), rid());
    expect(read.status).toBe(200);
    expect((await read.json()).role).toBe('viewer');

    const write = await patchRoadmap(reqAs(STRANGER, 'PATCH', { title: 'hacked' }), rid());
    expect(write.status).toBe(403);

    // Share row carries the verified uid + name + role for the owner's panel.
    const shares = await store.listShares(seeded.roadmap.id);
    const uidShare = shares.find((s) => s.memberUid === STRANGER.uid);
    expect(uidShare?.memberName).toBe(STRANGER.name);
    expect(uidShare?.role).toBe('viewer');
  });

  it('requires authentication (link grants nothing anonymously)', async () => {
    const token = await ownerToken('viewer');
    expect((await postJoin(reqAs(null, 'POST'), { params: { token } })).status).toBe(401);
  });

  it('404s on unknown or disabled tokens', async () => {
    expect((await postJoin(reqAs(STRANGER, 'POST'), { params: { token: 'nope' } })).status).toBe(404);

    const token = await ownerToken('viewer');
    await deleteInvite(reqAs(OWNER, 'DELETE', { role: 'viewer' }), rid());
    expect((await postJoin(reqAs(STRANGER, 'POST'), { params: { token } })).status).toBe(404);
  });

  it('disabling one role link does not kill the other one', async () => {
    const viewerToken = await ownerToken('viewer');
    const editorToken = await ownerToken('editor');
    await deleteInvite(reqAs(OWNER, 'DELETE', { role: 'viewer' }), rid());

    expect((await postJoin(reqAs(STRANGER, 'POST'), { params: { token: viewerToken } })).status).toBe(404);
    expect((await postJoin(reqAs(STRANGER, 'POST'), { params: { token: editorToken } })).status).toBe(200);
  });

  it('rotating the token invalidates the old link but keeps claimed viewers', async () => {
    const token = await ownerToken('viewer');
    await postJoin(reqAs(STRANGER, 'POST'), { params: { token } });

    await ownerToken('viewer'); // rotate
    expect(
      (await postJoin(reqAs({ ...STRANGER, uid: 'other' }, 'POST'), { params: { token } })).status,
    ).toBe(404);
    // claimed viewer keeps access
    expect((await getRoadmap(reqAs(STRANGER), rid())).status).toBe(200);
  });

  it('owner and existing-claimant claims are no-ops (no duplicate rows)', async () => {
    const token = await ownerToken('viewer');
    const before = (await store.listShares(seeded.roadmap.id)).length;

    expect((await postJoin(reqAs(OWNER, 'POST'), { params: { token } })).status).toBe(200);
    await postJoin(reqAs(STRANGER, 'POST'), { params: { token } });
    await postJoin(reqAs(STRANGER, 'POST'), { params: { token } });

    const after = await store.listShares(seeded.roadmap.id);
    expect(after.length).toBe(before + 1); // only the stranger's single row
  });

  it('claim updates last-visited and the roadmap appears in the profile shared list', async () => {
    const token = await ownerToken('viewer');
    await postJoin(reqAs(STRANGER, 'POST'), { params: { token } });

    const lists = await (await getMyRoadmaps(reqAs(STRANGER))).json();
    expect(lists.shared).toHaveLength(1);
    expect(lists.shared[0].id).toBe(seeded.roadmap.id);

    const state = await store.getUserState(STRANGER.uid);
    expect(state?.lastRoadmapId).toBe(seeded.roadmap.id);
  });

  it('removing a claimed share revokes access (AC-6.4 equivalent)', async () => {
    const token = await ownerToken('viewer');
    await postJoin(reqAs(STRANGER, 'POST'), { params: { token } });

    const share = (await store.listShares(seeded.roadmap.id)).find(
      (s) => s.memberUid === STRANGER.uid,
    )!;
    await deleteShare(reqAs(OWNER, 'DELETE'), { params: { id: share.id } });
    expect((await getRoadmap(reqAs(STRANGER), rid())).status).toBe(403);
  });

  it('deleting the roadmap clears both invite token mappings', async () => {
    const viewerToken = await ownerToken('viewer');
    const editorToken = await ownerToken('editor');
    await store.deleteRoadmap(seeded.roadmap.id);
    expect(await store.findRoadmapByInviteToken(viewerToken)).toBeNull();
    expect(await store.findRoadmapByInviteToken(editorToken)).toBeNull();
  });
});

describe('claiming an editor invite (POST /api/join/:token)', () => {
  it('binds the claimant uid as an editor who can edit and add content', async () => {
    const token = await ownerToken('editor');

    const claim = await postJoin(reqAs(STRANGER, 'POST'), { params: { token } });
    expect(claim.status).toBe(200);
    expect((await claim.json()).role).toBe('editor');

    const read = await getRoadmap(reqAs(STRANGER), rid());
    expect(read.status).toBe(200);
    expect((await read.json()).role).toBe('editor');

    // editors can edit the header and add content…
    expect(
      (await patchRoadmap(reqAs(STRANGER, 'PATCH', { title: 'Edited by editor' }), rid())).status,
    ).toBe(200);
    expect(
      (await postInitiative(reqAs(STRANGER, 'POST', { name: 'Editor row' }), rid())).status,
    ).toBe(201);

    // …but stay locked out of owner-only surface
    expect((await postInvite(reqAs(STRANGER, 'POST', { role: 'viewer' }), rid())).status).toBe(403);
    expect((await deleteRoadmap(reqAs(STRANGER, 'DELETE'), rid())).status).toBe(403);

    const share = (await store.listShares(seeded.roadmap.id)).find(
      (s) => s.memberUid === STRANGER.uid,
    );
    expect(share?.role).toBe('editor');
  });

  it('upgrades an existing viewer to editor without duplicating their row', async () => {
    const viewerToken = await ownerToken('viewer');
    await postJoin(reqAs(STRANGER, 'POST'), { params: { token: viewerToken } });
    expect((await (await getRoadmap(reqAs(STRANGER), rid())).json()).role).toBe('viewer');
    const before = (await store.listShares(seeded.roadmap.id)).length;

    const editorToken = await ownerToken('editor');
    const claim = await postJoin(reqAs(STRANGER, 'POST'), { params: { token: editorToken } });
    expect(claim.status).toBe(200);
    expect((await claim.json()).role).toBe('editor');

    expect((await (await getRoadmap(reqAs(STRANGER), rid())).json()).role).toBe('editor');
    expect((await store.listShares(seeded.roadmap.id)).length).toBe(before);
  });

  it('never downgrades: an editor claiming a viewer link stays an editor', async () => {
    const viewerToken = await ownerToken('viewer');
    const claim = await postJoin(reqAs(EDITOR, 'POST'), { params: { token: viewerToken } });
    expect(claim.status).toBe(200);
    expect((await claim.json()).role).toBe('editor');

    expect((await (await getRoadmap(reqAs(EDITOR), rid())).json()).role).toBe('editor');
  });
});
