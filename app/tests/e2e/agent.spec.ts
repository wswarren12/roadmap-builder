import { expect, test } from '@playwright/test';
import { loginAs, makeUser, seedRoadmap } from './helpers';

/**
 * BDD scenarios — planning agent chat UI (F-14, mock-backed).
 *
 * - Given an editor opens the agent bubble and asks to add an item, When
 *   the agent (mock) walks get_roadmap → create_item, Then the reply and
 *   an action chip appear in the chat and the new bar renders on the
 *   roadmap without a manual refresh (AC-14.1/14.6).
 * - Given an off-scope message, Then the agent answers with its scoped
 *   redirect and no actions (AC-14.2 surface check).
 * - Given a viewer, Then no agent bubble is shown (AC-14.5).
 */
test.describe('F-14 planning agent chat', () => {
  test('agent adds an item from chat; roadmap refreshes with the new bar', async ({
    page,
    context,
    request,
  }) => {
    const owner = makeUser('owner');
    await loginAs(context, owner);
    const seeded = await seedRoadmap(request, owner);

    await page.goto(`/roadmaps/${seeded.roadmapId}`);
    await page.getByTestId('agent-bubble').click();
    await expect(page.getByTestId('agent-panel')).toBeVisible();

    await page.getByTestId('agent-input').fill('Please add an item "Payments revamp"');
    await page.getByTestId('agent-send').click();

    await expect(page.getByTestId('agent-msg-user')).toContainText('Payments revamp');
    await expect(page.getByTestId('agent-msg-assistant')).toContainText(/Added "Payments revamp"/);
    await expect(page.getByTestId('agent-action')).toContainText(/Added item "Payments revamp"/);

    // the roadmap reloaded itself — the new bar is on the canvas
    await expect(
      page.getByTestId('item-bar').filter({ hasText: 'Payments revamp' }),
    ).toHaveCount(1);
  });

  test('off-scope chat gets the scoped redirect, no actions', async ({
    page,
    context,
    request,
  }) => {
    const owner = makeUser('owner');
    await loginAs(context, owner);
    const seeded = await seedRoadmap(request, owner);

    await page.goto(`/roadmaps/${seeded.roadmapId}`);
    await page.getByTestId('agent-bubble').click();
    await page.getByTestId('agent-input').fill('What is the weather today?');
    await page.getByTestId('agent-send').click();

    await expect(page.getByTestId('agent-msg-assistant')).toContainText(
      /only help with this roadmap/i,
    );
    await expect(page.getByTestId('agent-action')).toHaveCount(0);
  });

  test('viewers see no agent bubble (AC-14.5)', async ({ page, context, request, browser }) => {
    const owner = makeUser('owner');
    await loginAs(context, owner);
    const seeded = await seedRoadmap(request, owner);

    await page.goto(`/roadmaps/${seeded.roadmapId}`);
    await expect(page.getByTestId('agent-bubble')).toBeVisible();

    // owner generates a viewer link; a second user joins read-only
    await page.getByTestId('share-button').click();
    await page.getByTestId('invite-generate-viewer').click();
    await expect(page.getByTestId('invite-active-viewer')).toBeVisible();
    const joinUrl = (await page.getByTestId('invite-link-viewer').textContent())!.trim();

    const viewer = makeUser('viewer');
    const viewerContext = await browser.newContext();
    await loginAs(viewerContext, viewer);
    const viewerPage = await viewerContext.newPage();
    await viewerPage.goto(joinUrl);
    await expect(viewerPage.getByTestId('roadmap-view')).toBeVisible();
    await expect(viewerPage.getByTestId('viewer-badge')).toBeVisible();
    await expect(viewerPage.getByTestId('agent-bubble')).toHaveCount(0);
    await viewerContext.close();
  });
});
