import { expect, test } from '@playwright/test';
import { apiAs, loginAs, makeUser, seedRoadmap } from './helpers';

const ownRows = (page: import('@playwright/test').Page) =>
  page.locator('section[aria-label="Roadmaps you own"] [data-testid="roadmap-row"]');

test.describe('home chooser & deletion', () => {
  test('deleting from the chooser removes the row immediately and it stays gone after reload; its deep link is not found', async ({
    page,
    context,
    request,
  }) => {
    const owner = makeUser('owner');
    await loginAs(context, owner);
    const keep = await seedRoadmap(request, owner, { title: 'Keep me' });
    const doomed = await seedRoadmap(request, owner, { title: 'Doomed' });

    await page.goto('/');
    await expect(page).toHaveURL(/\/profile$/);
    await expect(ownRows(page)).toHaveCount(2);

    await page.locator('[data-testid="roadmap-row"]', { hasText: 'Doomed' }).getByRole('button', { name: /Delete/ }).click();
    await page.getByTestId('confirm-delete').click();
    await expect(ownRows(page)).toHaveCount(1);
    await expect(ownRows(page).first()).toContainText('Keep me');
    await expect(page.locator('.confirm-message')).toHaveCount(0);

    await page.reload();
    await expect(ownRows(page)).toHaveCount(1);
    await expect(ownRows(page).first()).toContainText('Keep me');

    // Deep link to the deleted roadmap follows the existing not-found state.
    await page.goto(`/roadmaps/${doomed.roadmapId}`);
    await expect(page.getByText('This roadmap no longer exists')).toBeVisible();
    await page.getByRole('button', { name: 'Go home' }).click();
    await expect(page).toHaveURL(/\/profile$/);
    await expect(ownRows(page)).toHaveCount(1);
    expect((await apiAs(request, owner, 'get', `/api/roadmaps/${doomed.roadmapId}`)).status()).toBe(404);
    expect((await apiAs(request, owner, 'get', `/api/roadmaps/${keep.roadmapId}`)).status()).toBe(200);
  });

  test('a failed deletion keeps the row visible and shows an error', async ({ page, context, request }) => {
    const owner = makeUser('owner');
    await loginAs(context, owner);
    const seeded = await seedRoadmap(request, owner, { title: 'Sticky' });
    await page.route(`**/api/roadmaps/${seeded.roadmapId}`, (route) =>
      route.request().method() === 'DELETE'
        ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' })
        : route.continue(),
    );

    await page.goto('/profile');
    await expect(ownRows(page)).toHaveCount(1);
    await page.getByRole('button', { name: /Delete Sticky/ }).click();
    await page.getByTestId('confirm-delete').click();
    await expect(page.locator('.toast-stack')).toContainText('boom');
    await expect(page.locator('.confirm-message')).toBeVisible(); // confirm stays open for retry
    await page.keyboard.press('Escape');
    await expect(ownRows(page)).toHaveCount(1);
    await page.reload();
    await expect(ownRows(page)).toHaveCount(1);
  });

  test('deleting from inside the roadmap lands on the chooser without it', async ({ page, context, request }) => {
    const owner = makeUser('owner');
    await loginAs(context, owner);
    await seedRoadmap(request, owner, { title: 'Survivor' });
    const doomed = await seedRoadmap(request, owner, { title: 'Doomed' });

    await page.goto('/profile');
    await expect(ownRows(page)).toHaveCount(2);
    await page.goto(`/roadmaps/${doomed.roadmapId}`);
    await page.getByTestId('delete-roadmap').click();
    await page.getByTestId('confirm-delete').click();
    await expect(page).toHaveURL(/\/profile$/);
    await expect(ownRows(page)).toHaveCount(1);
    await expect(ownRows(page).first()).toContainText('Survivor');
  });

  test('editors and viewers cannot delete; the owner list is unchanged', async ({ page, context, request }) => {
    const owner = makeUser('owner');
    const editor = makeUser('editor');
    const viewer = makeUser('viewer');
    const seeded = await seedRoadmap(request, owner, { title: 'Guarded' });
    for (const [user, role] of [[editor, 'editor'], [viewer, 'viewer']] as const) {
      const invite = await (await apiAs(request, owner, 'post', `/api/roadmaps/${seeded.roadmapId}/invite`, { role })).json();
      await apiAs(request, user, 'post', `/api/join/${invite.token}`);
      expect((await apiAs(request, user, 'delete', `/api/roadmaps/${seeded.roadmapId}`)).status()).toBe(403);
    }
    expect((await apiAs(request, 'anonymous', 'delete', `/api/roadmaps/${seeded.roadmapId}`)).status()).toBe(401);

    await loginAs(context, editor);
    await page.goto(`/roadmaps/${seeded.roadmapId}`);
    await expect(page.getByTestId('editor-badge')).toBeVisible();
    await expect(page.getByTestId('delete-roadmap')).toHaveCount(0);

    const ownerPage = await (await page.context().browser()!.newContext()).newPage();
    await loginAs(ownerPage.context(), owner);
    await ownerPage.goto('/profile');
    await expect(ownRows(ownerPage)).toHaveCount(1);
    await ownerPage.context().close();
  });
});
