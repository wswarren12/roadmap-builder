import { expect, test } from '@playwright/test';
import { loginAs, makeUser, seedItem, seedRoadmap } from './helpers';

test.describe('F-3 drill-down subcalendar', () => {
  test('week columns cover exactly the item span, partial edges included (AC-3.1)', async ({
    page,
    context,
    request,
  }) => {
    const owner = makeUser('owner');
    await loginAs(context, owner);
    const seeded = await seedRoadmap(request, owner);
    // Aug 5 2026 is a Wednesday; Sep 22 2026 is a Tuesday → partial edge weeks.
    const itemId = await seedItem(request, owner, seeded, {
      startDate: '2026-08-05',
      endDate: '2026-09-22',
    });

    await page.goto(`/roadmaps/${seeded.roadmapId}`);
    await page.getByTestId('item-bar').first().click();
    await expect(page).toHaveURL(new RegExp(`/items/${itemId}$`));

    const weekCols = page.getByTestId('week-col');
    await expect(weekCols.first()).toHaveAttribute('data-start', '2026-08-05');
    await expect(weekCols.last()).toHaveAttribute('data-end', '2026-09-22');

    // Interior columns are Monday-start full weeks.
    const starts = await weekCols.evaluateAll((els) =>
      els.map((el) => el.getAttribute('data-start')),
    );
    for (const start of starts.slice(1)) {
      expect(new Date(`${start}T00:00:00Z`).getUTCDay()).toBe(1); // Monday
    }

    // Header strip shows the item's details.
    await expect(page.locator('.subcal-title')).toContainText('Signup revamp');
    await expect(page.locator('.subcal-desc')).toContainText('Rework the signup funnel');
  });

  test('back navigation restores the roadmap with prior scroll (AC-3.2)', async ({
    page,
    context,
    request,
  }) => {
    const owner = makeUser('owner');
    await loginAs(context, owner);
    // 12-month roadmap so the grid overflows and scroll matters.
    const seeded = await seedRoadmap(request, owner, {
      startMonth: '2026-01-01',
      endMonth: '2026-12-01',
    });
    const itemId = await seedItem(request, owner, seeded, {
      startDate: '2026-03-10',
      endDate: '2026-05-20',
    });

    await page.setViewportSize({ width: 900, height: 800 });
    await page.goto(`/roadmaps/${seeded.roadmapId}`);
    const scroller = page.getByTestId('timeline-scroll');
    await scroller.evaluate((el) => (el.scrollLeft = 240));

    await page.getByTestId('item-bar').first().click();
    await expect(page).toHaveURL(new RegExp(`/items/${itemId}$`));

    await page.getByTestId('back-to-roadmap').click();
    await expect(page).toHaveURL(new RegExp(`/roadmaps/${seeded.roadmapId}$`));
    await expect
      .poll(async () => scroller.evaluate((el) => el.scrollLeft))
      .toBeGreaterThan(200);
  });

  test('deleted item shows a friendly gone state (F-3 error state)', async ({
    page,
    context,
    request,
  }) => {
    const owner = makeUser('owner');
    await loginAs(context, owner);
    const seeded = await seedRoadmap(request, owner);

    await page.goto(`/roadmaps/${seeded.roadmapId}/items/00000000-0000-0000-0000-000000000000`);
    await expect(page.getByText('This item no longer exists')).toBeVisible();
    await page.getByRole('button', { name: 'Back to the roadmap' }).click();
    await expect(page).toHaveURL(new RegExp(`/roadmaps/${seeded.roadmapId}$`));
  });
});
