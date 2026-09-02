import { beforeEach, describe, expect, it } from 'vitest';
import { GET as getRoadmap, PATCH as patchRoadmap, DELETE as deleteRoadmap } from '@/app/api/roadmaps/[id]/route';
import { POST as postInitiative } from '@/app/api/roadmaps/[id]/initiatives/route';
import { PATCH as patchInitiative, DELETE as deleteInitiative } from '@/app/api/initiatives/[id]/route';
import { POST as postItem } from '@/app/api/roadmaps/[id]/items/route';
import { GET as getItem, PATCH as patchItem, DELETE as deleteItem } from '@/app/api/items/[id]/route';
import { POST as postSprint } from '@/app/api/items/[id]/sprints/route';
import { PATCH as patchSprint, DELETE as deleteSprint } from '@/app/api/sprints/[id]/route';
import { GET as getShares, POST as postShare } from '@/app/api/roadmaps/[id]/shares/route';
import { DELETE as deleteShare } from '@/app/api/shares/[id]/route';
import type { MemoryStore } from '@/lib/store';
import { EDITOR, OWNER, STRANGER, VIEWER, freshStore, reqAs, seedRoadmap } from './harness';

/**
 * The full authorization matrix (AC-6.1..6.4, PRD §8 "Viewer access matrix"):
 * owner / editor / viewer / stranger / anonymous × every read, write, and
 * owner-only endpoint. Server-side enforcement is the requirement — these
 * tests hit the handlers directly, bypassing any UI affordance hiding.
 */

let store: MemoryStore;
let seeded: Awaited<ReturnType<typeof seedRoadmap>>;

beforeEach(async () => {
  store = freshStore();
  seeded = await seedRoadmap(store);
});

type Caller = {
  label: string;
  identity: typeof OWNER | null;
  read: number;
  write: number;
  share: number;
  ownerOnly: number;
};

const CALLERS: Caller[] = [
  { label: 'owner', identity: OWNER, read: 200, write: 200, share: 200, ownerOnly: 200 },
  { label: 'editor', identity: EDITOR, read: 200, write: 200, share: 200, ownerOnly: 403 },
  { label: 'viewer', identity: VIEWER, read: 200, write: 403, share: 403, ownerOnly: 403 },
  { label: 'stranger', identity: STRANGER, read: 403, write: 403, share: 403, ownerOnly: 403 },
  { label: 'anonymous', identity: null, read: 401, write: 401, share: 401, ownerOnly: 401 },
];

describe('read endpoints', () => {
  for (const caller of CALLERS) {
    it(`${caller.label} GET roadmap → ${caller.read}`, async () => {
      const res = await getRoadmap(reqAs(caller.identity), { params: { id: seeded.roadmap.id } });
      expect(res.status).toBe(caller.read);
    });

    it(`${caller.label} GET item → ${caller.read}`, async () => {
      const res = await getItem(reqAs(caller.identity), { params: { id: seeded.item.id } });
      expect(res.status).toBe(caller.read);
    });
  }
});

describe('write endpoints reject read-only callers (AC-6.3)', () => {
  const expectWrite = (caller: Caller, actual: number, okStatus = 200) => {
    if (caller.write === 200) {
      expect([okStatus, 200, 201]).toContain(actual);
    } else {
      expect(actual).toBe(caller.write);
    }
  };

  for (const caller of CALLERS) {
    it(`${caller.label} PATCH roadmap`, async () => {
      const res = await patchRoadmap(
        reqAs(caller.identity, 'PATCH', { title: 'Renamed' }),
        { params: { id: seeded.roadmap.id } },
      );
      expectWrite(caller, res.status);
    });

    it(`${caller.label} POST initiative`, async () => {
      const res = await postInitiative(
        reqAs(caller.identity, 'POST', { name: 'New row' }),
        { params: { id: seeded.roadmap.id } },
      );
      expectWrite(caller, res.status, 201);
    });

    it(`${caller.label} PATCH initiative`, async () => {
      const res = await patchInitiative(
        reqAs(caller.identity, 'PATCH', { name: 'Renamed row' }),
        { params: { id: seeded.initiative.id } },
      );
      expectWrite(caller, res.status);
    });

    it(`${caller.label} POST item`, async () => {
      const res = await postItem(
        reqAs(caller.identity, 'POST', {
          initiativeId: seeded.initiative.id,
          title: 'New item',
          startDate: '2026-10-01',
          endDate: '2026-10-20',
        }),
        { params: { id: seeded.roadmap.id } },
      );
      expectWrite(caller, res.status, 201);
    });

    it(`${caller.label} PATCH item (drag)`, async () => {
      const res = await patchItem(
        reqAs(caller.identity, 'PATCH', { startDate: '2026-08-05', endDate: '2026-09-19' }),
        { params: { id: seeded.item.id } },
      );
      expectWrite(caller, res.status);
    });

    it(`${caller.label} POST sprint`, async () => {
      const res = await postSprint(
        reqAs(caller.identity, 'POST', {
          name: 'Sprint 2',
          startDate: '2026-08-17',
          endDate: '2026-08-28',
        }),
        { params: { id: seeded.item.id } },
      );
      expectWrite(caller, res.status, 201);
    });

    it(`${caller.label} PATCH sprint`, async () => {
      const res = await patchSprint(
        reqAs(caller.identity, 'PATCH', { name: 'Sprint renamed' }),
        { params: { id: seeded.sprint.id } },
      );
      expectWrite(caller, res.status);
    });

    it(`${caller.label} DELETE sprint`, async () => {
      const res = await deleteSprint(reqAs(caller.identity, 'DELETE'), {
        params: { id: seeded.sprint.id },
      });
      expectWrite(caller, res.status);
    });

    it(`${caller.label} DELETE item`, async () => {
      const res = await deleteItem(reqAs(caller.identity, 'DELETE'), {
        params: { id: seeded.item.id },
      });
      expectWrite(caller, res.status);
    });

  }
});

describe('sharing endpoints allow owner and editors (editors can further share)', () => {
  const expectShare = (caller: Caller, actual: number, okStatus = 200) => {
    if (caller.share === 200) {
      expect([okStatus, 200, 201]).toContain(actual);
    } else {
      expect(actual).toBe(caller.share);
    }
  };

  for (const caller of CALLERS) {
    it(`${caller.label} GET shares`, async () => {
      const res = await getShares(reqAs(caller.identity), { params: { id: seeded.roadmap.id } });
      expectShare(caller, res.status);
    });

    it(`${caller.label} POST share`, async () => {
      const res = await postShare(
        reqAs(caller.identity, 'POST', { email: 'new@pl.network' }),
        { params: { id: seeded.roadmap.id } },
      );
      expectShare(caller, res.status, 201);
    });

    it(`${caller.label} DELETE share`, async () => {
      const shares = await store.listShares(seeded.roadmap.id);
      const res = await deleteShare(reqAs(caller.identity, 'DELETE'), {
        params: { id: shares[0].id },
      });
      expectShare(caller, res.status);
    });
  }
});

describe('owner-only endpoints reject editors too (destruction stays with the owner)', () => {
  for (const caller of CALLERS) {
    it(`${caller.label} DELETE roadmap`, async () => {
      const res = await deleteRoadmap(reqAs(caller.identity, 'DELETE'), {
        params: { id: seeded.roadmap.id },
      });
      if (caller.ownerOnly === 200) {
        expect([200, 201]).toContain(res.status);
      } else {
        expect(res.status).toBe(caller.ownerOnly);
      }
    });
  }
});

describe('whitelist behavior (AC-6.1, AC-6.4)', () => {
  it('matches emails case-insensitively', async () => {
    const shoutingViewer = { ...VIEWER, email: 'VIEWER@PL.NETWORK' };
    const res = await getRoadmap(reqAs(shoutingViewer), { params: { id: seeded.roadmap.id } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.role).toBe('viewer');
  });

  it('revoking removes access', async () => {
    const shares = await store.listShares(seeded.roadmap.id);
    const del = await deleteShare(reqAs(OWNER, 'DELETE'), { params: { id: shares[0].id } });
    expect(del.status).toBe(200);
    const res = await getRoadmap(reqAs(VIEWER), { params: { id: seeded.roadmap.id } });
    expect(res.status).toBe(403);
  });

  it('viewer with no email resolves to none', async () => {
    const emailless = { uid: 'u-noemail', name: 'No Email', email: null };
    const res = await getRoadmap(reqAs(emailless), { params: { id: seeded.roadmap.id } });
    expect(res.status).toBe(403);
  });

  it('duplicate share add is a no-op with hint', async () => {
    const before = (await store.listShares(seeded.roadmap.id)).length;
    const res = await postShare(
      reqAs(OWNER, 'POST', { email: 'Viewer@PL.Network' }),
      { params: { id: seeded.roadmap.id } },
    );
    expect(res.status).toBe(200);
    expect((await res.json()).noop).toBe('duplicate');
    expect(await store.listShares(seeded.roadmap.id)).toHaveLength(before);
  });

  it("owner's own email add is a no-op with hint", async () => {
    const res = await postShare(
      reqAs(OWNER, 'POST', { email: OWNER.email }),
      { params: { id: seeded.roadmap.id } },
    );
    expect(res.status).toBe(200);
    expect((await res.json()).noop).toBe('own-email');
  });

  it('malformed email is rejected (AC-6.5)', async () => {
    const res = await postShare(
      reqAs(OWNER, 'POST', { email: 'not-an-email' }),
      { params: { id: seeded.roadmap.id } },
    );
    expect(res.status).toBe(400);
  });
});
