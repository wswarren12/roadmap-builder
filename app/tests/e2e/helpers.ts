import type { APIRequestContext, BrowserContext, Page } from '@playwright/test';

export interface DevUser {
  uid: string;
  name: string;
  email: string;
}

let counter = 0;

/** Unique user per test so the shared in-memory store never cross-talks. */
export function makeUser(prefix: string): DevUser {
  const id = `${prefix}-${Date.now().toString(36)}-${counter++}`;
  return { uid: id, name: `${prefix} ${counter}`, email: `${id}@e2e.test` };
}

export function devCookie(user: DevUser | 'anonymous') {
  return {
    name: 'dev_user',
    value: user === 'anonymous' ? 'anonymous' : encodeURIComponent(JSON.stringify(user)),
    domain: '127.0.0.1',
    path: '/',
  };
}

export async function loginAs(context: BrowserContext, user: DevUser | 'anonymous') {
  await context.addCookies([devCookie(user)]);
}

function authHeaders(user: DevUser | 'anonymous') {
  const value =
    user === 'anonymous' ? 'anonymous' : encodeURIComponent(JSON.stringify(user));
  return { cookie: `dev_user=${value}` };
}

/** Direct API call as a given user — used for seeding and 403 assertions. */
export async function apiAs(
  request: APIRequestContext,
  user: DevUser | 'anonymous',
  method: 'get' | 'post' | 'patch' | 'delete',
  path: string,
  data?: unknown,
) {
  return request[method](path, { headers: authHeaders(user), data });
}

export interface Seeded {
  roadmapId: string;
  initiativeId: string;
}

/** Seed a roadmap (Jul–Dec 2026) owned by `owner`. */
export async function seedRoadmap(
  request: APIRequestContext,
  owner: DevUser,
  overrides: Partial<{ title: string; startMonth: string; endMonth: string }> = {},
): Promise<Seeded> {
  const res = await apiAs(request, owner, 'post', '/api/roadmaps', {
    title: overrides.title ?? 'H2 2026 Platform Roadmap',
    description: 'E2E seeded roadmap',
    startMonth: overrides.startMonth ?? '2026-07-01',
    endMonth: overrides.endMonth ?? '2026-12-01',
  });
  if (res.status() !== 201) throw new Error(`seedRoadmap failed: ${res.status()}`);
  const body = await res.json();
  return { roadmapId: body.roadmap.id, initiativeId: body.initiatives[0].id };
}

export async function seedItem(
  request: APIRequestContext,
  owner: DevUser,
  seeded: Seeded,
  overrides: Partial<{
    title: string;
    startDate: string;
    endDate: string;
    milestoneText: string;
    milestoneDate: string;
    dris: string;
    status: string;
    kpi: string;
    description: string;
  }> = {},
): Promise<string> {
  const res = await apiAs(request, owner, 'post', `/api/roadmaps/${seeded.roadmapId}/items`, {
    initiativeId: seeded.initiativeId,
    title: overrides.title ?? 'Signup revamp',
    description: overrides.description ?? 'Rework the signup funnel',
    startDate: overrides.startDate ?? '2026-08-01',
    endDate: overrides.endDate ?? '2026-09-15',
    milestoneText: overrides.milestoneText ?? '',
    milestoneDate: overrides.milestoneDate ?? null,
    dris: overrides.dris ?? 'Ada',
    status: overrides.status ?? 'green',
    kpi: overrides.kpi ?? '',
  });
  if (res.status() !== 201) throw new Error(`seedItem failed: ${res.status()}`);
  return (await res.json()).item.id;
}

export async function seedSprint(
  request: APIRequestContext,
  owner: DevUser,
  itemId: string,
  overrides: Partial<{
    name: string;
    startDate: string;
    endDate: string;
    description: string;
    kpi: string;
    dri: string;
  }> = {},
): Promise<string> {
  const res = await apiAs(request, owner, 'post', `/api/items/${itemId}/sprints`, {
    name: overrides.name ?? 'Sprint 1',
    description: overrides.description ?? 'First sprint',
    startDate: overrides.startDate ?? '2026-08-03',
    endDate: overrides.endDate ?? '2026-08-14',
    kpi: overrides.kpi ?? 'Green CI',
    dri: overrides.dri ?? 'Grace',
  });
  if (res.status() !== 201) throw new Error(`seedSprint failed: ${res.status()}`);
  return (await res.json()).sprint.id;
}

/** Drag helper: pointer-drag from the center of a locator by dx pixels. */
export async function dragBy(page: Page, locator: ReturnType<Page['locator']>, dx: number) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('drag target not visible');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  // several intermediate moves so the 4px threshold and previews engage
  await page.mouse.move(x + dx / 3, y, { steps: 4 });
  await page.mouse.move(x + dx, y, { steps: 6 });
  await page.mouse.up();
}
