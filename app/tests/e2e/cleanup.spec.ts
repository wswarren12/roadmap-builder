import { expect, test } from '@playwright/test';
import { loginAs, makeUser, seedItem, seedRoadmap } from './helpers';

test.describe('cleanup batch: initiative descriptions + responsible team', () => {
  test('initiative theme description saves and reloads', async ({ page, context, request }) => {
    const owner = makeUser('owner');
    await loginAs(context, owner);
    const seeded = await seedRoadmap(request, owner);

    await page.goto(`/roadmaps/${seeded.roadmapId}`);
    await page.getByTestId('initiative-desc').fill('Everything onboarding-related');
    await page.getByTestId('roadmap-title').click(); // blur → save
    await page.reload();
    await expect(page.getByTestId('initiative-desc')).toHaveValue(
      'Everything onboarding-related',
    );
  });

  test('responsible team round-trips through the item form and drill-down', async ({
    page,
    context,
    request,
  }) => {
    const owner = makeUser('owner');
    await loginAs(context, owner);
    const seeded = await seedRoadmap(request, owner);
    const itemId = await seedItem(request, owner, seeded);

    await page.goto(`/roadmaps/${seeded.roadmapId}/items/${itemId}`);
    await page.getByTestId('edit-item').click();
    await page.getByTestId('item-responsible-team').fill('Platform');
    await page.getByTestId('save-item').click();
    await expect(page.getByTestId('item-responsible-team-value')).toHaveText('Platform');

    // labels renamed (item 5) — 'DRI' also appears in the detail grid behind
    // the modal, so assert on first() and that the old labels are gone.
    await page.getByTestId('edit-item').click();
    await expect(page.getByText('Key Result', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('DRI', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('OKRs', { exact: true })).toHaveCount(0);
    await expect(page.getByText('DRIs', { exact: true })).toHaveCount(0);
  });
});
