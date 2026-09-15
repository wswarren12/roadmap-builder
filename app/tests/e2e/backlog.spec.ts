import { expect, test } from '@playwright/test';
import { apiAs, loginAs, makeUser, seedItem, seedRoadmap, seedSprint } from './helpers';

const rows = (page: import('@playwright/test').Page) => page.getByTestId('backlog-row');

test.describe('roadmap-scoped backlog', () => {
  test('shows only the open roadmap; creates, edits and reloads stay in scope; picker + deep link switch cleanly', async ({
    page,
    context,
    request,
  }) => {
    const owner = makeUser('owner');
    await loginAs(context, owner);
    const a = await seedRoadmap(request, owner, { title: 'Alpha' });
    const b = await seedRoadmap(request, owner, { title: 'Beta' });
    await apiAs(request, owner, 'post', `/api/roadmaps/${a.roadmapId}/backlog`, { title: 'Alpha idea' });
    await apiAs(request, owner, 'post', `/api/roadmaps/${b.roadmapId}/backlog`, { title: 'Beta idea' });

    await page.goto(`/backlog?roadmap=${a.roadmapId}`);
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText('Alpha idea');
    await expect(page.getByText('Beta idea')).toHaveCount(0);

    // Create in Alpha, edit it, reload — still only Alpha's.
    await page.getByTestId('new-backlog-item').click();
    await page.getByTestId('backlog-title').fill('Alpha second');
    await page.getByTestId('save-backlog-item').click();
    await expect(rows(page)).toHaveCount(2);
    await rows(page).filter({ hasText: 'Alpha second' }).getByRole('button', { name: 'Inspect / edit' }).click();
    await page.getByTestId('backlog-title').fill('Alpha refined');
    await page.getByTestId('save-backlog-item').click();
    await expect(rows(page).filter({ hasText: 'Alpha refined' })).toHaveCount(1);
    await page.reload();
    await expect(rows(page)).toHaveCount(2);
    await expect(page.getByText('Beta idea')).toHaveCount(0);

    // Picker switches to Beta: its single entry, none of Alpha's.
    await page.getByTestId('backlog-roadmap-picker').selectOption(b.roadmapId);
    await expect(page).toHaveURL(new RegExp(`roadmap=${b.roadmapId}`));
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText('Beta idea');

    // Rapid switching ends on the last choice with no stale rows.
    const picker = page.getByTestId('backlog-roadmap-picker');
    await picker.selectOption(a.roadmapId);
    await picker.selectOption(b.roadmapId);
    await picker.selectOption(a.roadmapId);
    await expect(page.getByTestId('backlog-view')).toHaveAttribute('data-roadmap-id', a.roadmapId);
    await expect(rows(page)).toHaveCount(2);
    await expect(page.getByText('Beta idea')).toHaveCount(0);

    // Server-side: Beta untouched by everything above.
    const beta = await (await apiAs(request, owner, 'get', `/api/roadmaps/${b.roadmapId}/backlog`)).json();
    expect(beta.backlog.map((e: { title: string }) => e.title)).toEqual(['Beta idea']);
  });

  test('empty backlog has a clear empty state; the nav link carries the open roadmap', async ({ page, context, request }) => {
    const owner = makeUser('owner');
    await loginAs(context, owner);
    const a = await seedRoadmap(request, owner, { title: 'Alpha' });
    await page.goto(`/roadmaps/${a.roadmapId}`);
    await page.getByRole('link', { name: 'Backlog' }).click();
    await expect(page).toHaveURL(new RegExp(`/backlog\\?roadmap=${a.roadmapId}`));
    await expect(page.getByText("This roadmap's backlog is empty")).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create backlog item' })).toBeVisible();
  });

  test('move from the drill-down lands in THAT roadmap backlog with sprints; scheduling rebuilds them', async ({
    page,
    context,
    request,
  }) => {
    const owner = makeUser('owner');
    await loginAs(context, owner);
    const a = await seedRoadmap(request, owner, { title: 'Alpha' });
    const b = await seedRoadmap(request, owner, { title: 'Beta' });
    const itemId = await seedItem(request, owner, a, { title: 'Move me' });
    await seedSprint(request, owner, itemId, { name: 'Sprint 1', startDate: '2026-08-03', endDate: '2026-08-14' });

    await page.goto(`/roadmaps/${a.roadmapId}/items/${itemId}`);
    await page.getByTestId('move-to-backlog').click();
    await expect(page.getByText("Move item to this roadmap's backlog?")).toBeVisible();
    await page.getByTestId('confirm-delete').click();
    await expect(page).toHaveURL(new RegExp(`/backlog\\?roadmap=${a.roadmapId}`));
    const row = rows(page).filter({ hasText: 'Move me' });
    await expect(row).toBeVisible();
    await expect(row).toContainText('1'); // preserved sprint count
    const beta = await (await apiAs(request, owner, 'get', `/api/roadmaps/${b.roadmapId}/backlog`)).json();
    expect(beta.backlog).toEqual([]);

    await row.getByRole('button', { name: 'Schedule' }).click();
    await page.getByLabel('Start date').fill('2026-10-01');
    await page.getByLabel('End date').fill('2026-11-01');
    await page.getByTestId('confirm-backlog-schedule').click();
    await expect(page).toHaveURL(new RegExp(`/roadmaps/${a.roadmapId}/items/`));
    await expect(page.getByTestId('sprint-bar')).toHaveCount(1);
    const after = await (await apiAs(request, owner, 'get', `/api/roadmaps/${a.roadmapId}/backlog`)).json();
    expect(after.backlog).toEqual([]);
  });

  test('cross-roadmap ids and read-only mutations are rejected server-side; viewer sees a read-only list', async ({
    page,
    context,
    request,
  }) => {
    const owner = makeUser('owner');
    const viewer = makeUser('viewer');
    const a = await seedRoadmap(request, owner, { title: 'Alpha' });
    const b = await seedRoadmap(request, owner, { title: 'Beta' });
    const aEntry = (await (await apiAs(request, owner, 'post', `/api/roadmaps/${a.roadmapId}/backlog`, { title: 'Alpha idea' })).json()).item;
    const invite = await (await apiAs(request, owner, 'post', `/api/roadmaps/${a.roadmapId}/invite`, { role: 'viewer' })).json();
    await apiAs(request, viewer, 'post', `/api/join/${invite.token}`);

    // Alpha's id through Beta's route: not found; Beta unchanged.
    expect((await apiAs(request, owner, 'patch', `/api/roadmaps/${b.roadmapId}/backlog`, { id: aEntry.id, title: 'hijack' })).status()).toBe(404);
    expect((await apiAs(request, owner, 'delete', `/api/roadmaps/${b.roadmapId}/backlog?id=${aEntry.id}`)).status()).toBe(404);
    expect((await apiAs(request, owner, 'post', `/api/roadmaps/${b.roadmapId}/items`, {
      initiativeId: b.initiativeId, title: 'x', startDate: '2026-08-01', endDate: '2026-08-10', fromBacklogId: aEntry.id,
    })).status()).toBe(404);
    // Viewer: can read Alpha, cannot write it, cannot see Beta at all.
    expect((await apiAs(request, viewer, 'get', `/api/roadmaps/${a.roadmapId}/backlog`)).status()).toBe(200);
    expect((await apiAs(request, viewer, 'post', `/api/roadmaps/${a.roadmapId}/backlog`, { title: 'nope' })).status()).toBe(403);
    expect((await apiAs(request, viewer, 'patch', `/api/roadmaps/${a.roadmapId}/backlog`, { id: aEntry.id, title: 'nope' })).status()).toBe(403);
    expect((await apiAs(request, viewer, 'get', `/api/roadmaps/${b.roadmapId}/backlog`)).status()).toBe(403);
    const alpha = await (await apiAs(request, owner, 'get', `/api/roadmaps/${a.roadmapId}/backlog`)).json();
    expect(alpha.backlog.map((e: { title: string }) => e.title)).toEqual(['Alpha idea']);

    await loginAs(context, viewer);
    await page.goto(`/backlog?roadmap=${a.roadmapId}`);
    await expect(rows(page)).toHaveCount(1);
    await expect(page.getByTestId('backlog-readonly')).toBeVisible();
    await expect(page.getByTestId('new-backlog-item')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Schedule' })).toHaveCount(0);
    // The picker only offers roadmaps the viewer can access.
    const options = await page.getByTestId('backlog-roadmap-picker').locator('option').allTextContents();
    expect(options).toEqual(['Alpha']);
  });
});
