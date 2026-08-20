import { expect, test } from '@playwright/test';
import { loginAs, makeUser, seedItem, seedRoadmap, seedSprint } from './helpers';

/** '#RRGGBB' → the 'rgb(r, g, b)' string getComputedStyle returns. */
function rgb(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}

const PL_GREEN = rgb('#067647');
const SUNSET_FIRST = rgb('#B42318');
const SUNSET_GREEN = rgb('#15803D');

test.describe('color palettes & completion', () => {
  test('new-roadmap modal offers 3 palettes; chosen palette colors the item bars', async ({
    page,
    context,
  }) => {
    const owner = makeUser('owner');
    await loginAs(context, owner);

    await page.goto('/');
    await page.getByTestId('new-roadmap').click();
    await expect(page.getByTestId('palette-pl')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('palette-sunset')).toBeVisible();
    await expect(page.getByTestId('palette-orchid')).toBeVisible();

    await page.getByTestId('roadmap-title-input').fill('Sunset roadmap');
    await page.getByTestId('start-month').fill('2026-07');
    await page.getByTestId('end-month').fill('2026-12');
    await page.getByTestId('palette-sunset').click();
    await page.getByTestId('create-roadmap').click();

    await page.getByTestId('add-item').click();
    await page.getByTestId('item-title').fill('Warm item');
    await page.getByTestId('item-start').fill('2026-08-01');
    await page.getByTestId('item-end').fill('2026-09-15');
    await page.getByTestId('save-item').click();

    const bar = page.getByTestId('item-bar').first();
    await expect(bar).toContainText('Warm item');
    expect(await bar.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
      SUNSET_FIRST,
    );
  });

  test('marking an item complete turns its bar green; unmarking restores the hue', async ({
    page,
    context,
    request,
  }) => {
    const owner = makeUser('owner');
    await loginAs(context, owner);
    const seeded = await seedRoadmap(request, owner, { palette: 'sunset' });
    const itemId = await seedItem(request, owner, seeded);

    await page.goto(`/roadmaps/${seeded.roadmapId}/items/${itemId}`);
    await page.getByTestId('edit-item').click();
    await page.getByTestId('item-completed').check();
    await page.getByTestId('item-completed-date').fill('2026-09-01');
    await page.getByTestId('save-item').click();

    await expect(page.getByTestId('item-completed-value')).toContainText('2026');

    // The roadmap bar renders in the palette's green.
    await page.goto(`/roadmaps/${seeded.roadmapId}`);
    const bar = page.getByTestId('item-bar').first();
    await expect(bar).toBeVisible();
    expect(await bar.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
      SUNSET_GREEN,
    );

    // Un-complete → hue comes back.
    await bar.click();
    await page.getByTestId('edit-item').click();
    await page.getByTestId('item-completed').uncheck();
    await page.getByTestId('save-item').click();
    await page.goto(`/roadmaps/${seeded.roadmapId}`);
    expect(
      await page
        .getByTestId('item-bar')
        .first()
        .evaluate((el) => getComputedStyle(el).backgroundColor),
    ).toBe(SUNSET_FIRST);
  });

  test('Mark complete button in the sprint view completes the item via the date modal', async ({
    page,
    context,
    request,
  }) => {
    const owner = makeUser('owner');
    await loginAs(context, owner);
    const seeded = await seedRoadmap(request, owner, { palette: 'sunset' });
    const itemId = await seedItem(request, owner, seeded);

    await page.goto(`/roadmaps/${seeded.roadmapId}/items/${itemId}`);
    await page.getByTestId('mark-complete').click();
    await page.getByTestId('complete-date').fill('2026-09-10');
    await page.getByTestId('confirm-complete').click();

    // Button disappears once complete; detail shows the date.
    await expect(page.getByTestId('mark-complete')).toHaveCount(0);
    await expect(page.getByTestId('item-completed-value')).toContainText('2026');

    // Roadmap bar is the palette's green.
    await page.goto(`/roadmaps/${seeded.roadmapId}`);
    const bar = page.getByTestId('item-bar').first();
    await expect(bar).toBeVisible();
    expect(await bar.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
      SUNSET_GREEN,
    );

    // Un-complete stays possible via the edit form checkbox.
    await bar.click();
    await page.getByTestId('edit-item').click();
    await expect(page.getByTestId('item-completed')).toBeChecked();
  });

  test('bar color is user-selectable from the palette (green excluded)', async ({
    page,
    context,
    request,
  }) => {
    const owner = makeUser('owner');
    await loginAs(context, owner);
    const seeded = await seedRoadmap(request, owner, { palette: 'sunset' });

    // Create: swatches show exactly the 6 palette hues — never the green.
    await page.goto(`/roadmaps/${seeded.roadmapId}`);
    await page.getByTestId('add-item').click();
    const swatches = page.locator('.color-swatch-btn');
    await expect(swatches).toHaveCount(6);
    const swatchColors = await swatches.evaluateAll((els) =>
      els.map((el) => getComputedStyle(el).backgroundColor),
    );
    expect(swatchColors).not.toContain(SUNSET_GREEN);

    await page.getByTestId('item-title').fill('Hand-picked');
    await page.getByTestId('item-start').fill('2026-08-01');
    await page.getByTestId('item-end').fill('2026-09-15');
    await page.getByTestId('item-color-2').click();
    await page.getByTestId('save-item').click();

    const bar = page.getByTestId('item-bar').first();
    await expect(bar).toBeVisible();
    expect(await bar.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
      swatchColors[2],
    );

    // Edit: switch to another hue and verify the bar follows.
    await bar.click();
    await page.getByTestId('edit-item').click();
    await page.getByTestId('item-color-5').click();
    await page.getByTestId('save-item').click();
    await page.goto(`/roadmaps/${seeded.roadmapId}`);
    expect(
      await page
        .getByTestId('item-bar')
        .first()
        .evaluate((el) => getComputedStyle(el).backgroundColor),
    ).toBe(swatchColors[5]);
  });

  test('marking a sprint complete turns its bar green and shows the date on the card', async ({
    page,
    context,
    request,
  }) => {
    const owner = makeUser('owner');
    await loginAs(context, owner);
    const seeded = await seedRoadmap(request, owner); // default PL palette
    const itemId = await seedItem(request, owner, seeded);
    await seedSprint(request, owner, itemId, { name: 'Sprint done' });

    await page.goto(`/roadmaps/${seeded.roadmapId}/items/${itemId}`);
    await page.getByTestId('sprint-bar').first().click();
    await page.getByTestId('sprint-card-edit').click();
    await page.getByTestId('sprint-completed').check();
    await page.getByTestId('sprint-completed-date').fill('2026-08-14');
    await page.getByTestId('save-sprint').click();

    const bar = page.getByTestId('sprint-bar').first();
    await expect(bar).toBeVisible();
    await expect
      .poll(() => bar.evaluate((el) => getComputedStyle(el).backgroundColor))
      .toBe(PL_GREEN);

    await bar.click();
    await expect(page.getByTestId('sprint-card-completed')).toContainText('2026');
  });
});
