import { expect, test } from '@playwright/test';
import { loginAs, makeUser, seedRoadmap } from './helpers';

test.describe('F-1 roadmap canvas & header', () => {
  test('create roadmap via UI renders one column per month (AC-1.1)', async ({
    page,
    context,
  }) => {
    const owner = makeUser('owner');
    await loginAs(context, owner);

    await page.goto('/profile');
    await page.getByTestId('new-roadmap').click();
    await page.getByTestId('roadmap-title-input').fill('H2 2026 Platform Roadmap');
    await page.getByTestId('start-month').fill('2026-07');
    await page.getByTestId('end-month').fill('2026-12');
    await page.getByTestId('create-roadmap').click();

    await expect(page).toHaveURL(/\/roadmaps\//);
    await expect(page.getByTestId('roadmap-title')).toHaveValue('H2 2026 Platform Roadmap');
    const months = page.locator('.timeline-head .time-col');
    await expect(months).toHaveCount(6);
    await expect(months.first()).toHaveText('Jul 2026');
    await expect(months.last()).toHaveText('Dec 2026');
    // one default initiative row
    await expect(page.getByTestId('initiative-row')).toHaveCount(1);
  });

  test('2-month range is rejected with a clear inline error (AC-1.3)', async ({
    page,
    context,
  }) => {
    const owner = makeUser('owner');
    await loginAs(context, owner);

    await page.goto('/profile');
    await page.getByTestId('new-roadmap').click();
    await page.getByTestId('roadmap-title-input').fill('Too short');
    await page.getByTestId('start-month').fill('2026-07');
    await page.getByTestId('end-month').fill('2026-08');
    await page.getByTestId('create-roadmap').click();

    await expect(page.locator('.range-error').first()).toContainText(/3–12 months|3 to 12/);
    await expect(page).toHaveURL(/\/profile/);
  });

  test('ninth initiative is blocked with a max-8 hint (AC-1.2)', async ({
    page,
    context,
    request,
  }) => {
    const owner = makeUser('owner');
    await loginAs(context, owner);
    const seeded = await seedRoadmap(request, owner);

    await page.goto(`/roadmaps/${seeded.roadmapId}`);
    const addBtn = page.getByTestId('add-initiative');
    for (let i = 2; i <= 8; i++) {
      await addBtn.click();
      await expect(page.getByTestId('initiative-row')).toHaveCount(i);
    }
    await expect(addBtn).toBeDisabled();
    await expect(page.getByTestId('max-initiatives-hint')).toHaveText(/max 8 initiatives/i);
  });

  test('initiative rename persists without a page reload (AC-1.4)', async ({
    page,
    context,
    request,
  }) => {
    const owner = makeUser('owner');
    await loginAs(context, owner);
    const seeded = await seedRoadmap(request, owner);

    await page.goto(`/roadmaps/${seeded.roadmapId}`);
    const nameInput = page.getByTestId('initiative-name').first();
    await nameInput.fill('Onboarding');
    await nameInput.blur();
    await expect(nameInput).toHaveValue('Onboarding');

    await page.reload();
    await expect(page.getByTestId('initiative-name').first()).toHaveValue('Onboarding');
  });
});
