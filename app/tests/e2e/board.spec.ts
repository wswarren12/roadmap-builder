import { expect, test } from '@playwright/test';
import { apiAs, loginAs, makeUser, seedItem, seedRoadmap } from './helpers';

test.describe('board, sticky months, status colors, DRI', () => {
  test('month headings stay visible on vertical scroll and aligned on horizontal scroll', async ({
    page,
    context,
    request,
  }) => {
    const owner = makeUser('owner');
    await loginAs(context, owner);
    const seeded = await seedRoadmap(request, owner, { startMonth: '2026-01-01', endMonth: '2026-12-01' });
    for (let i = 0; i < 7; i++) {
      await apiAs(request, owner, 'post', `/api/roadmaps/${seeded.roadmapId}/initiatives`, { name: `Row ${i}` });
    }
    await page.setViewportSize({ width: 900, height: 600 });
    await page.goto(`/roadmaps/${seeded.roadmapId}`);
    const scroll = page.getByTestId('timeline-scroll');
    await expect(page.getByTestId('initiative-row')).toHaveCount(8);

    const metrics = await scroll.evaluate((el) => {
      el.scrollTop = 400;
      el.scrollLeft = 300;
      const head = el.querySelector('.timeline-head')!.getBoundingClientRect();
      const cols = [...el.querySelectorAll('.time-col')].map((c) => c.getBoundingClientRect().left);
      const lines = [...el.querySelector('.lanes')!.querySelectorAll('.lane-grid-line')].map(
        (l) => l.getBoundingClientRect().left,
      );
      return { scrollTop: el.scrollTop, scrollLeft: el.scrollLeft, headTop: head.top, boxTop: el.getBoundingClientRect().top, cols, lines };
    });
    expect(metrics.scrollTop).toBeGreaterThan(0);
    expect(metrics.scrollLeft).toBeGreaterThan(0);
    // Sticky: header pinned to the top of the scrolling box while rows scroll.
    expect(Math.abs(metrics.headTop - metrics.boxTop)).toBeLessThan(1);
    // Aligned: every month boundary line sits exactly under its heading edge.
    metrics.lines.forEach((left, i) => expect(Math.abs(left - metrics.cols[i + 1])).toBeLessThan(1));
  });

  test('editor creates a backlog item on the board; it persists, survives view switches and can be scheduled', async ({
    page,
    context,
    request,
  }) => {
    const owner = makeUser('owner');
    await loginAs(context, owner);
    const seeded = await seedRoadmap(request, owner);
    const otherRoadmap = await seedRoadmap(request, owner, { title: 'Other' });
    await seedItem(request, owner, seeded, { title: 'Signup revamp' });

    await page.goto(`/roadmaps/${seeded.roadmapId}`);
    await page.getByTestId('view-board').click();
    await expect(page.getByTestId('board-view')).toBeVisible();
    await expect(page.getByTestId('board-card').filter({ hasText: 'Signup revamp' })).toBeVisible();

    await page.getByTestId('backlog-add-title').fill('SSO audit');
    await page.getByTestId('backlog-add').click();
    const card = page.getByTestId('backlog-card').filter({ hasText: 'SSO audit' });
    await expect(card).toBeVisible();
    await card.getByTestId('backlog-card-status').selectOption('yellow');
    await expect(card).toContainText('At risk');

    // Persists across reload (and the board choice is remembered).
    await page.reload();
    await expect(page.getByTestId('board-view')).toBeVisible();
    await expect(page.getByTestId('backlog-card').filter({ hasText: 'SSO audit' })).toContainText('At risk');

    // Switching views keeps scheduled items and their dates untouched.
    await page.getByTestId('view-timeline').click();
    await expect(page.getByTestId('item-bar')).toHaveCount(1);
    const res = await apiAs(request, owner, 'get', `/api/roadmaps/${seeded.roadmapId}`);
    const body = await res.json();
    expect(body.items[0]).toMatchObject({ startDate: '2026-08-01', endDate: '2026-09-15' });
    expect(body.roadmap.backlog).toHaveLength(1);

    // Isolation: the other roadmap's backlog is untouched.
    const other = await (await apiAs(request, owner, 'get', `/api/roadmaps/${otherRoadmap.roadmapId}`)).json();
    expect(other.roadmap.backlog).toEqual([]);

    // Schedule → item form prefilled → lands on the timeline, leaves the backlog.
    await page.getByTestId('view-board').click();
    await page.getByTestId('backlog-schedule').click();
    await expect(page.getByTestId('item-title')).toHaveValue('SSO audit');
    await page.getByTestId('item-start').fill('2026-10-01');
    await page.getByTestId('item-end').fill('2026-10-20');
    await page.getByTestId('save-item').click();
    await expect(page.getByTestId('backlog-card')).toHaveCount(0);
    await expect(page.getByTestId('board-card').filter({ hasText: 'SSO audit' })).toBeVisible();
    await page.getByTestId('view-timeline').click();
    await expect(page.getByTestId('item-bar')).toHaveCount(2);
  });

  test('viewers see the board read-only', async ({ page, context, request }) => {
    const owner = makeUser('owner');
    const viewer = makeUser('viewer');
    const seeded = await seedRoadmap(request, owner);
    await apiAs(request, owner, 'post', `/api/roadmaps/${seeded.roadmapId}/backlog`, { title: 'Parked' });
    const invite = await (
      await apiAs(request, owner, 'post', `/api/roadmaps/${seeded.roadmapId}/invite`, { role: 'viewer' })
    ).json();
    await apiAs(request, viewer, 'post', `/api/join/${invite.token}`);

    await loginAs(context, viewer);
    await page.goto(`/roadmaps/${seeded.roadmapId}`);
    await page.getByTestId('view-board').click();
    await expect(page.getByTestId('backlog-card').filter({ hasText: 'Parked' })).toBeVisible();
    await expect(page.getByTestId('backlog-add-title')).toHaveCount(0);
    await expect(page.getByTestId('backlog-schedule')).toHaveCount(0);
    await expect(page.getByTestId('backlog-delete')).toHaveCount(0);
    const denied = await apiAs(request, viewer, 'post', `/api/roadmaps/${seeded.roadmapId}/backlog`, { title: 'x' });
    expect(denied.status()).toBe(403);
  });

  test('status-color mode recolors bars by R/Y/G, completed and deprioritized; off keeps palette colors', async ({
    page,
    context,
    request,
  }) => {
    const owner = makeUser('owner');
    await loginAs(context, owner);
    const seeded = await seedRoadmap(request, owner);
    await seedItem(request, owner, seeded, { title: 'Red one', status: 'red', startDate: '2026-07-01', endDate: '2026-07-20' });
    await seedItem(request, owner, seeded, { title: 'Parked', status: 'deprioritized', startDate: '2026-08-01', endDate: '2026-08-20' });
    const doneId = await seedItem(request, owner, seeded, { title: 'Done', status: 'green', startDate: '2026-09-01', endDate: '2026-09-20' });
    await apiAs(request, owner, 'patch', `/api/items/${doneId}`, { completedAt: '2026-09-10' });

    await page.goto(`/roadmaps/${seeded.roadmapId}`);
    const bg = (title: string) =>
      page.getByTestId('item-bar').filter({ hasText: title }).evaluate((el) => getComputedStyle(el).backgroundColor);
    const before = { red: await bg('Red one'), parked: await bg('Parked') };

    await page.getByTestId('status-colors-toggle').check();
    await expect(page.getByTestId('status-legend')).toContainText('Off track');
    expect(await bg('Red one')).toBe('rgb(180, 35, 24)');
    expect(await bg('Parked')).toBe('rgb(102, 112, 133)');
    expect(await bg('Done')).toBe('rgb(5, 79, 49)');
    // Readable label in the tooltip / board badge.
    await page.getByTestId('view-board').click();
    await expect(page.getByTestId('board-card').filter({ hasText: 'Red one' })).toContainText('Off track');
    await expect(page.getByTestId('board-card').filter({ hasText: 'Parked' })).toContainText('Deprioritized');
    await page.getByTestId('view-timeline').click();

    // Persists on reload; off restores the roadmap palette colors.
    await page.reload();
    await expect(page.getByTestId('status-colors-toggle')).toBeChecked();
    await page.getByTestId('status-colors-toggle').uncheck();
    expect(await bg('Red one')).toBe(before.red);
    expect(await bg('Parked')).toBe(before.parked);
  });

  test('DRI is picked from the team roster, links to the LabOS member and persists', async ({
    page,
    context,
    request,
  }) => {
    const owner = makeUser('owner');
    await loginAs(context, owner);
    const seeded = await seedRoadmap(request, owner);
    await apiAs(request, owner, 'post', `/api/roadmaps/${seeded.roadmapId}/team/import`);
    await apiAs(request, owner, 'post', `/api/roadmaps/${seeded.roadmapId}/team`, { name: 'Maria Garcia' });
    const itemId = await seedItem(request, owner, seeded, { title: 'Signup revamp', dris: '' });

    await page.goto(`/roadmaps/${seeded.roadmapId}/items/${itemId}`);
    await page.getByTestId('edit-item').click();
    const select = page.getByTestId('item-dri');
    // F-13b: roster people without a LabOS profile are labelled as such.
    await expect(select.locator('option')).toHaveText([
      'No DRI',
      `${owner.name} · LabOS`,
      'Maria Garcia · no LabOS profile',
    ]);
    await select.selectOption({ label: `${owner.name} · LabOS` });
    await page.getByTestId('save-item').click();

    await page.reload();
    await page.getByTestId('edit-item').click();
    // The picker now stores the roster identity, so the selected OPTION is
    // asserted by its label rather than by a name-valued <option>.
    await expect(
      page.getByTestId('item-dri').locator('option:checked'),
    ).toHaveText(`${owner.name} · LabOS`);
    const stored = await (await apiAs(request, owner, 'get', `/api/items/${itemId}`)).json();
    expect(stored.item.dris).toBe(owner.name);
  });
});
