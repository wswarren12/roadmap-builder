import { MemoryStore, setStore } from '@/lib/store';
import type { Identity } from '@/lib/types';

/**
 * Integration-test harness: Next route handlers are plain
 * (Request, {params}) => Response functions, so we invoke them directly with
 * a dev_user cookie (DEV_AUTH=1 is set in tests/setup.ts).
 */

export const OWNER: Identity = { uid: 'u-owner', name: 'Olive Owner', email: 'owner@pl.network' };
export const EDITOR: Identity = { uid: 'u-editor', name: 'Ed Editor', email: 'editor@pl.network' };
export const VIEWER: Identity = { uid: 'u-viewer', name: 'Vic Viewer', email: 'viewer@pl.network' };
export const STRANGER: Identity = { uid: 'u-stranger', name: 'Sam Stranger', email: 'stranger@pl.network' };

export function freshStore(): MemoryStore {
  const store = new MemoryStore();
  setStore(store);
  return store;
}

export function reqAs(
  identity: Identity | null,
  method = 'GET',
  body?: unknown,
): Request {
  const headers: Record<string, string> = {};
  headers.cookie = identity
    ? `dev_user=${encodeURIComponent(JSON.stringify(identity))}`
    : 'dev_user=anonymous';
  if (body !== undefined) headers['content-type'] = 'application/json';
  return new Request('http://test.local/api', {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export async function json(res: Response) {
  return res.json();
}

/** Creates a roadmap owned by OWNER with VIEWER whitelisted and EDITOR
 *  granted an editor uid-share; returns ids. */
export async function seedRoadmap(store: MemoryStore) {
  const roadmap = await store.createRoadmap(
    { uid: OWNER.uid, email: OWNER.email },
    {
      title: 'H2 2026 Platform Roadmap',
      description: 'Second-half platform work',
      startMonth: '2026-07-01',
      endMonth: '2026-12-01',
    },
  );
  const initiative = await store.createInitiative(roadmap.id, 'Onboarding');
  await store.addShare(roadmap.id, VIEWER.email!);
  await store.addUidShare(roadmap.id, EDITOR.uid, EDITOR.name, 'editor');
  const item = await store.createItem(
    roadmap.id,
    {
      initiativeId: initiative.id,
      title: 'Signup revamp',
      startDate: '2026-08-01',
      endDate: '2026-09-15',
    },
    0,
  );
  const sprint = await store.createSprint(item.id, {
    name: 'Sprint 1',
    startDate: '2026-08-03',
    endDate: '2026-08-14',
  });
  return { roadmap, initiative, item, sprint };
}
