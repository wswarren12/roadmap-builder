import { expect, test } from '@playwright/test';
import { apiAs, loginAs, makeUser, seedItem, seedRoadmap } from './helpers';

const card = (page: import('@playwright/test').Page, title: string) =>
  page.getByTestId('board-card').filter({ hasText: title });

test.describe('Kanban view by status', () => {
  test('empty roadmap shows empty columns; switching views keeps items, dates and DRIs intact', async ({
    page,
    context,
    request,
  }) => {
    const owner = makeUser('owner');
    await loginAs(context, owner);
    const seeded = await seedRoadmap(request, owner);

    await page.goto(`/roadmaps/${seeded.roadmapId}`);
    await page.getByTestId('view-board').click();
    await expect(page.getByTestId('board-view')).toBeVisible();
    for (const col of ['backlog', 'green', 'yellow', 'red', 'deprioritized', 'completed']) {
      await expect(page.getByTestId(`board-col-${col}`)).toContainText('Nothing here');
    }
    // Deprioritized sits past Completed, at the far right.
    await expect(page.locator('.board-col-head > span:first-child')).toHaveText([
      'Backlog', 'On track', 'At risk', 'Off track', 'Completed', 'Deprioritized',
    ]);
    await expect(page.getByTestId('board-card')).toHaveCount(0);

    await seedItem(request, owner, seeded, { title: 'Signup revamp', status: 'yellow', dris: 'Ada' });
    await page.reload();
    await expect(page.getByTestId('board-col-yellow').getByTestId('board-card')).toHaveCount(1);
    await expect(card(page, 'Signup revamp')).toContainText('Ada');
    await expect(card(page, 'Signup revamp')).toContainText('Aug 1, 2026 – Sep 15, 2026');

    // Timeline ⇄ board: still exactly one item, same dates and DRI.
    await page.getByTestId('view-timeline').click();
    await expect(page.getByTestId('item-bar')).toHaveCount(1);
    await page.getByTestId('view-board').click();
    await expect(page.getByTestId('board-card')).toHaveCount(1);
    const { items } = await (await apiAs(request, owner, 'get', `/api/roadmaps/${seeded.roadmapId}`)).json();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ startDate: '2026-08-01', endDate: '2026-09-15', dris: 'Ada', status: 'yellow' });
  });

  test('editor moves a card by select and by drag; status persists across reload, timeline and the item form', async ({
    page,
    context,
    request,
  }) => {
    const owner = makeUser('owner');
    await loginAs(context, owner);
    const seeded = await seedRoadmap(request, owner);
    const itemId = await seedItem(request, owner, seeded, { title: 'Signup revamp', status: 'green' });

    await page.goto(`/roadmaps/${seeded.roadmapId}`);
    await page.getByTestId('view-board').click();
    await expect(page.getByTestId('board-col-green').getByTestId('board-card')).toHaveCount(1);

    // Select fallback → Off track.
    await card(page, 'Signup revamp').getByTestId('board-card-move').selectOption('red');
    await expect(page.getByTestId('board-col-red').getByTestId('board-card')).toHaveCount(1);
    await expect(page.getByTestId('board-col-green').getByTestId('board-card')).toHaveCount(0);

    // Drag → Completed.
    await card(page, 'Signup revamp').dragTo(page.getByTestId('board-col-completed'));
    await expect(page.getByTestId('board-col-completed').getByTestId('board-card')).toHaveCount(1);

    await page.reload();
    await expect(page.getByTestId('board-col-completed').getByTestId('board-card')).toHaveCount(1);
    let stored = await (await apiAs(request, owner, 'get', `/api/items/${itemId}`)).json();
    expect(stored.item.status).toBe('red');
    expect(stored.item.completedAt).not.toBeNull();

    // Back out of Completed → At risk clears completion; the timeline agrees.
    await card(page, 'Signup revamp').getByTestId('board-card-move').selectOption('yellow');
    await expect(page.getByTestId('board-col-yellow').getByTestId('board-card')).toHaveCount(1);
    stored = await (await apiAs(request, owner, 'get', `/api/items/${itemId}`)).json();
    expect(stored.item).toMatchObject({ status: 'yellow', completedAt: null });
    await page.getByTestId('view-timeline').click();
    await page.getByTestId('item-bar').hover();
    await expect(page.getByTestId('item-bar')).toHaveCount(1);
    await page.goto(`/roadmaps/${seeded.roadmapId}/items/${itemId}`);
    await page.getByTestId('edit-item').click();
    await expect(page.getByTestId('status-yellow')).toHaveAttribute('aria-checked', 'true');
  });

  test('viewers get a read-only board and the API rejects their moves', async ({ page, context, request }) => {
    const owner = makeUser('owner');
    const viewer = makeUser('viewer');
    const seeded = await seedRoadmap(request, owner);
    const itemId = await seedItem(request, owner, seeded, { title: 'Locked', status: 'green' });
    const invite = await (await apiAs(request, owner, 'post', `/api/roadmaps/${seeded.roadmapId}/invite`, { role: 'viewer' })).json();
    await apiAs(request, viewer, 'post', `/api/join/${invite.token}`);

    await loginAs(context, viewer);
    await page.goto(`/roadmaps/${seeded.roadmapId}`);
    await page.getByTestId('view-board').click();
    await expect(card(page, 'Locked')).toContainText('On track');
    await expect(page.getByTestId('board-card-move')).toHaveCount(0);
    expect(await card(page, 'Locked').getAttribute('draggable')).not.toBe('true');
    expect((await apiAs(request, viewer, 'patch', `/api/items/${itemId}`, { status: 'red' })).status()).toBe(403);
    const stored = await (await apiAs(request, owner, 'get', `/api/items/${itemId}`)).json();
    expect(stored.item.status).toBe('green');
  });

  test('two roadmaps: each board shows only its own items and moves do not leak', async ({ page, context, request }) => {
    const owner = makeUser('owner');
    await loginAs(context, owner);
    const a = await seedRoadmap(request, owner, { title: 'A' });
    const b = await seedRoadmap(request, owner, { title: 'B' });
    await seedItem(request, owner, a, { title: 'Alpha work', status: 'green' });
    const bId = await seedItem(request, owner, b, { title: 'Beta work', status: 'green' });

    await page.goto(`/roadmaps/${a.roadmapId}`);
    await page.getByTestId('view-board').click();
    await expect(page.getByTestId('board-card')).toHaveCount(1);
    await expect(card(page, 'Alpha work')).toBeVisible();
    await card(page, 'Alpha work').getByTestId('board-card-move').selectOption('deprioritized');
    await expect(page.getByTestId('board-col-deprioritized').getByTestId('board-card')).toHaveCount(1);

    await page.goto(`/roadmaps/${b.roadmapId}`);
    await page.getByTestId('view-board').click();
    await expect(page.getByTestId('board-card')).toHaveCount(1);
    await expect(card(page, 'Beta work')).toBeVisible();
    await expect(page.getByTestId('board-col-green').getByTestId('board-card')).toHaveCount(1);
    const stored = await (await apiAs(request, owner, 'get', `/api/items/${bId}`)).json();
    expect(stored.item.status).toBe('green');
  });
});
