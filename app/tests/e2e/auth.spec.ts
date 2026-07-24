import { expect, test } from '@playwright/test';
import { apiAs, loginAs, makeUser, seedRoadmap } from './helpers';

test.describe('F-5 auth & last-roadmap redirect', () => {
  test('first-time user lands on Profile with a create CTA (AC-5.3)', async ({
    page,
    context,
  }) => {
    const user = makeUser('fresh');
    await loginAs(context, user);
    await page.goto('/');
    await expect(page).toHaveURL(/\/profile/);
    await expect(
      page.getByRole('button', { name: 'Create your first roadmap' }),
    ).toBeVisible();
  });

  test('login lands on the last visited roadmap; visiting B then landing on B (AC-5.1, AC-5.4)', async ({
    page,
    context,
    request,
  }) => {
    const owner = makeUser('owner');
    await loginAs(context, owner);
    const a = await seedRoadmap(request, owner, { title: 'Roadmap A' });
    const b = await seedRoadmap(request, owner, { title: 'Roadmap B' });

    await page.goto(`/roadmaps/${a.roadmapId}`);
    await expect(page.getByTestId('roadmap-view')).toBeVisible();
    await page.goto('/');
    await expect(page).toHaveURL(new RegExp(`/roadmaps/${a.roadmapId}$`));

    await page.goto(`/roadmaps/${b.roadmapId}`);
    await expect(page.getByTestId('roadmap-view')).toBeVisible();
    await page.goto('/');
    await expect(page).toHaveURL(new RegExp(`/roadmaps/${b.roadmapId}$`));
  });

  test('anonymous users see the friendly signed-out state and APIs return 401 (AC-5.2)', async ({
    page,
    context,
    request,
  }) => {
    await loginAs(context, 'anonymous');
    await page.goto('/');
    await expect(page.getByText('Sign in through LabOS')).toBeVisible();

    const res = await apiAs(request, 'anonymous', 'get', '/api/me');
    expect(res.status()).toBe(401);
    const roadmaps = await apiAs(request, 'anonymous', 'post', '/api/roadmaps', {
      title: 'x',
      startMonth: '2026-07-01',
      endMonth: '2026-10-01',
    });
    expect(roadmaps.status()).toBe(401);
  });

  test('deleted last roadmap falls back to Profile, never a dead end (AC-5 error state)', async ({
    page,
    context,
    request,
  }) => {
    const owner = makeUser('owner');
    await loginAs(context, owner);
    const seeded = await seedRoadmap(request, owner);

    await page.goto(`/roadmaps/${seeded.roadmapId}`);
    await expect(page.getByTestId('roadmap-view')).toBeVisible();
    await apiAs(request, owner, 'delete', `/api/roadmaps/${seeded.roadmapId}`);

    await page.goto('/');
    await expect(page).toHaveURL(/\/profile/);
  });
});

test.describe('F-7 profile', () => {
  test('owned + shared lists render and navigate (AC-7.1); cascade delete clears viewer lists (AC-7.2)', async ({
    browser,
    page,
    context,
    request,
  }) => {
    const owner = makeUser('owner');
    const viewer = makeUser('viewer');
    await loginAs(context, owner);
    const a = await seedRoadmap(request, owner, { title: 'Owned One' });
    await seedRoadmap(request, owner, { title: 'Owned Two' });
    await apiAs(request, owner, 'post', `/api/roadmaps/${a.roadmapId}/shares`, {
      email: viewer.email,
    });

    await page.goto('/profile');
    const ownRows = page.locator('section[aria-label="Roadmaps you own"] [data-testid="roadmap-row"]');
    await expect(ownRows).toHaveCount(2);

    const viewerContext = await browser.newContext();
    await loginAs(viewerContext, viewer);
    const vp = await viewerContext.newPage();
    await vp.goto('/profile');
    const sharedRows = vp.locator('section[aria-label="Shared with you"] [data-testid="roadmap-row"]');
    await expect(sharedRows).toHaveCount(1);
    await expect(sharedRows.first()).toContainText('Owned One');

    // owner deletes from profile with confirm; it vanishes from the viewer's list
    await page
      .locator('[data-testid="roadmap-row"]', { hasText: 'Owned One' })
      .getByRole('button', { name: /Delete/ })
      .click();
    await expect(page.locator('.confirm-message')).toContainText('permanently deleted');
    await page.getByTestId('confirm-delete').click();
    await expect(ownRows).toHaveCount(1);

    await vp.reload();
    await expect(vp.getByText('Nothing shared with you yet')).toBeVisible();
    await viewerContext.close();
  });

  test('empty states render friendly copy (AC-7.3)', async ({ page, context }) => {
    const user = makeUser('empty');
    await loginAs(context, user);
    await page.goto('/profile');
    await expect(page.getByText('No roadmaps yet')).toBeVisible();
    await expect(page.getByText('Nothing shared with you yet')).toBeVisible();
  });
});
