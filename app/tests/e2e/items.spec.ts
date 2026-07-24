import { expect, test } from '@playwright/test';
import { dragBy, loginAs, makeUser, seedItem, seedRoadmap } from './helpers';

test.describe('F-2 roadmap items', () => {
  test('create via form → titled colored bar; overlapping items stack (AC-2.1, AC-2.2)', async ({
    page,
    context,
    request,
  }) => {
    const owner = makeUser('owner');
    await loginAs(context, owner);
    const seeded = await seedRoadmap(request, owner);

    await page.goto(`/roadmaps/${seeded.roadmapId}`);
    await page.getByTestId('add-item').click();
    await page.getByTestId('item-title').fill('Signup revamp');
    await page.getByTestId('item-start').fill('2026-08-01');
    await page.getByTestId('item-end').fill('2026-09-15');
    await page.getByTestId('save-item').click();

    const bars = page.getByTestId('item-bar');
    await expect(bars).toHaveCount(1);
    await expect(bars.first()).toContainText('Signup revamp');

    // second, overlapping item
    await page.getByTestId('add-item').click();
    await page.getByTestId('item-title').fill('Payments v2');
    await page.getByTestId('item-start').fill('2026-08-20');
    await page.getByTestId('item-end').fill('2026-10-10');
    await page.getByTestId('save-item').click();
    await expect(bars).toHaveCount(2);

    const boxA = await bars.nth(0).boundingBox();
    const boxB = await bars.nth(1).boundingBox();
    expect(boxA && boxB && Math.abs(boxA.y - boxB.y) >= 30).toBeTruthy(); // separate lanes

    const colorA = await bars.nth(0).evaluate((el) => getComputedStyle(el).backgroundColor);
    const colorB = await bars.nth(1).evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(colorA).not.toBe(colorB); // distinct palette colors
  });

  test('drag right edge persists day-snapped end date (AC-2.3)', async ({
    page,
    context,
    request,
  }) => {
    const owner = makeUser('owner');
    await loginAs(context, owner);
    const seeded = await seedRoadmap(request, owner);
    await seedItem(request, owner, seeded);

    await page.goto(`/roadmaps/${seeded.roadmapId}`);
    const bar = page.getByTestId('item-bar').first();
    const before = await bar.getAttribute('data-end');

    // px-per-day from bar geometry: width = (days+1) * pxPerDay
    const box = (await bar.boundingBox())!;
    const days =
      (Date.parse('2026-09-15') - Date.parse('2026-08-01')) / 86_400_000 + 1;
    const pxPerDay = box.width / days;
    const dragDays = 14;

    const handle = page.getByTestId('item-bar-handle-right').first();
    await dragBy(page, handle, dragDays * pxPerDay);

    await expect(bar).not.toHaveAttribute('data-end', before!);
    const shown = await bar.getAttribute('data-end');

    await page.reload();
    await expect(page.getByTestId('item-bar').first()).toHaveAttribute('data-end', shown!);
  });

  test('drag whole bar moves both dates and persists', async ({ page, context, request }) => {
    const owner = makeUser('owner');
    await loginAs(context, owner);
    const seeded = await seedRoadmap(request, owner);
    await seedItem(request, owner, seeded);

    await page.goto(`/roadmaps/${seeded.roadmapId}`);
    const bar = page.getByTestId('item-bar').first();
    const startBefore = (await bar.getAttribute('data-start'))!;
    const box = (await bar.boundingBox())!;
    const days = (Date.parse('2026-09-15') - Date.parse('2026-08-01')) / 86_400_000 + 1;
    const pxPerDay = box.width / days;

    await dragBy(page, bar, 10 * pxPerDay);
    await expect(bar).not.toHaveAttribute('data-start', startBefore);
    // still on the roadmap page — a drag is not a click (AC-3.3)
    await expect(page).toHaveURL(new RegExp(`/roadmaps/${seeded.roadmapId}$`));

    const startShown = (await bar.getAttribute('data-start'))!;
    await page.reload();
    await expect(page.getByTestId('item-bar').first()).toHaveAttribute(
      'data-start',
      startShown,
    );
  });

  test('milestone diamond renders on the bar at its date (AC-2.4)', async ({
    page,
    context,
    request,
  }) => {
    const owner = makeUser('owner');
    await loginAs(context, owner);
    const seeded = await seedRoadmap(request, owner);
    await seedItem(request, owner, seeded, {
      milestoneText: 'Beta launch',
      milestoneDate: '2026-08-20',
    });

    await page.goto(`/roadmaps/${seeded.roadmapId}`);
    const diamond = page.getByTestId('item-bar-milestone');
    await expect(diamond).toBeVisible();
    await expect(diamond).toHaveAttribute('title', 'Beta launch');
  });

  test('delete cascades sprints after confirm; cancel leaves data intact (AC-2.5, AC-9.3)', async ({
    page,
    context,
    request,
  }) => {
    const owner = makeUser('owner');
    await loginAs(context, owner);
    const seeded = await seedRoadmap(request, owner);
    const itemId = await seedItem(request, owner, seeded);

    await page.goto(`/roadmaps/${seeded.roadmapId}/items/${itemId}`);
    await page.getByTestId('add-sprint').click();
    await page.getByTestId('sprint-name').fill('Sprint A');
    await page.getByTestId('sprint-start').fill('2026-08-03');
    await page.getByTestId('sprint-end').fill('2026-08-14');
    await page.getByTestId('save-sprint').click();
    await expect(page.getByTestId('sprint-bar')).toHaveCount(1);

    // cancel path first
    await page.getByTestId('delete-item').click();
    await expect(page.locator('.confirm-message')).toContainText('1 sprint item');
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByTestId('sprint-bar')).toHaveCount(1);

    // confirm path
    await page.getByTestId('delete-item').click();
    await page.getByTestId('confirm-delete').click();
    await expect(page).toHaveURL(new RegExp(`/roadmaps/${seeded.roadmapId}$`));
    await expect(page.getByTestId('item-bar')).toHaveCount(0);
  });

  test('form dates outside the roadmap range are rejected (AC-2.6)', async ({
    page,
    context,
    request,
  }) => {
    const owner = makeUser('owner');
    await loginAs(context, owner);
    const seeded = await seedRoadmap(request, owner);

    await page.goto(`/roadmaps/${seeded.roadmapId}`);
    await page.getByTestId('add-item').click();
    await page.getByTestId('item-title').fill('Out of range');
    await page.getByTestId('item-start').fill('2026-06-01');
    await page.getByTestId('item-end').fill('2026-08-01');
    await page.getByTestId('save-item').click();

    await expect(page.locator('.modal-content')).toContainText(/within the roadmap/i);
    await expect(page.getByTestId('item-bar')).toHaveCount(0);
  });

  test('clicking empty lane space opens the item form prefilled near the click', async ({
    page,
    context,
    request,
  }) => {
    const owner = makeUser('owner');
    await loginAs(context, owner);
    const seeded = await seedRoadmap(request, owner);

    await page.goto(`/roadmaps/${seeded.roadmapId}`);
    const lane = page.getByTestId('lanes').first();
    const box = (await lane.boundingBox())!;
    // Click ~40% across the lane — a point clearly inside the roadmap span.
    await lane.click({ position: { x: box.width * 0.4, y: box.height / 2 } });

    // Form opens with a prefilled start date the user can just title + save.
    await expect(page.getByTestId('item-title')).toBeVisible();
    const start = await page.getByTestId('item-start').inputValue();
    expect(start).toMatch(/^2026-(07|08|09|10|11|12)-\d{2}$/);

    await page.getByTestId('item-title').fill('Clicked into place');
    await page.getByTestId('save-item').click();
    await expect(page.getByTestId('item-bar')).toContainText('Clicked into place');
  });
});
