import { expect, test } from '@playwright/test';
import { dragBy, loginAs, makeUser, seedItem, seedRoadmap, seedSprint } from './helpers';

test.describe('F-4 sprint items', () => {
  test('sprint bars share one uniform color and stack when overlapping (AC-4.1, AC-4.2)', async ({
    page,
    context,
    request,
  }) => {
    const owner = makeUser('owner');
    await loginAs(context, owner);
    const seeded = await seedRoadmap(request, owner);
    const itemId = await seedItem(request, owner, seeded);
    await seedSprint(request, owner, itemId, {
      name: 'Sprint A',
      startDate: '2026-08-03',
      endDate: '2026-08-14',
    });
    await seedSprint(request, owner, itemId, {
      name: 'Sprint B',
      startDate: '2026-08-10',
      endDate: '2026-08-21',
    });

    await page.goto(`/roadmaps/${seeded.roadmapId}/items/${itemId}`);
    const bars = page.getByTestId('sprint-bar');
    await expect(bars).toHaveCount(2);

    const colorA = await bars.nth(0).evaluate((el) => getComputedStyle(el).backgroundColor);
    const colorB = await bars.nth(1).evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(colorA).toBe(colorB); // uniform sprint color

    const boxA = (await bars.nth(0).boundingBox())!;
    const boxB = (await bars.nth(1).boundingBox())!;
    expect(Math.abs(boxA.y - boxB.y)).toBeGreaterThanOrEqual(30); // stacked lanes
  });

  test('clicking a sprint bar opens the full-detail right-hand card (AC-4.3)', async ({
    page,
    context,
    request,
  }) => {
    const owner = makeUser('owner');
    await loginAs(context, owner);
    const seeded = await seedRoadmap(request, owner);
    const itemId = await seedItem(request, owner, seeded);
    await seedSprint(request, owner, itemId, {
      name: 'Sprint A',
      description: 'Scaffold the API',
      kpi: 'All routes green',
      dri: 'Grace',
    });

    await page.goto(`/roadmaps/${seeded.roadmapId}/items/${itemId}`);
    await page.getByTestId('sprint-bar').first().click();

    const card = page.getByTestId('sprint-card');
    await expect(card).toBeVisible();
    await expect(card).toContainText('Scaffold the API');
    await expect(card).toContainText('All routes green');
    await expect(card).toContainText('Grace');
    await expect(page.getByTestId('sprint-card-dates')).toContainText('Aug 3, 2026');

    // dismiss with Escape
    await page.keyboard.press('Escape');
    await expect(card).not.toBeVisible();
  });

  test('edit from the card persists; delete requires confirm', async ({
    page,
    context,
    request,
  }) => {
    const owner = makeUser('owner');
    await loginAs(context, owner);
    const seeded = await seedRoadmap(request, owner);
    const itemId = await seedItem(request, owner, seeded);
    await seedSprint(request, owner, itemId, { name: 'Sprint A' });

    await page.goto(`/roadmaps/${seeded.roadmapId}/items/${itemId}`);
    await page.getByTestId('sprint-bar').first().click();
    await page.getByTestId('sprint-card-edit').click();
    await page.getByTestId('sprint-name').fill('Sprint A — renamed');
    await page.getByTestId('save-sprint').click();
    await expect(page.getByTestId('sprint-bar').first()).toContainText('Sprint A — renamed');

    await page.getByTestId('sprint-bar').first().click();
    await page.getByTestId('sprint-card-delete').click();
    await page.getByTestId('confirm-delete').click();
    await expect(page.getByTestId('sprint-bar')).toHaveCount(0);
  });

  test('sprint dates outside the parent item are rejected in the form (AC-4.4)', async ({
    page,
    context,
    request,
  }) => {
    const owner = makeUser('owner');
    await loginAs(context, owner);
    const seeded = await seedRoadmap(request, owner);
    const itemId = await seedItem(request, owner, seeded); // Aug 1 – Sep 15

    await page.goto(`/roadmaps/${seeded.roadmapId}/items/${itemId}`);
    await page.getByTestId('add-sprint').click();
    await page.getByTestId('sprint-name').fill('Escapes the span');
    await page.getByTestId('sprint-start').fill('2026-07-20');
    await page.getByTestId('sprint-end').fill('2026-08-05');
    await page.getByTestId('save-sprint').click();

    await expect(page.locator('.modal-content')).toContainText(/parent item/i);
    await expect(page.getByTestId('sprint-bar')).toHaveCount(0);
  });

  test('drag-resize is clamped to the parent span and persists (AC-4.4 drag path)', async ({
    page,
    context,
    request,
  }) => {
    const owner = makeUser('owner');
    await loginAs(context, owner);
    const seeded = await seedRoadmap(request, owner);
    const itemId = await seedItem(request, owner, seeded); // Aug 1 – Sep 15
    await seedSprint(request, owner, itemId, {
      name: 'Sprint A',
      startDate: '2026-09-01',
      endDate: '2026-09-10',
    });

    await page.goto(`/roadmaps/${seeded.roadmapId}/items/${itemId}`);
    const bar = page.getByTestId('sprint-bar').first();

    // drag the right edge far past the parent end — must clamp to Sep 15
    const handle = page.getByTestId('sprint-bar-handle-right').first();
    await dragBy(page, handle, 2000);
    await expect(bar).toHaveAttribute('data-end', '2026-09-15');

    await page.reload();
    await expect(page.getByTestId('sprint-bar').first()).toHaveAttribute(
      'data-end',
      '2026-09-15',
    );
  });
});
