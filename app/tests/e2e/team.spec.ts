import { expect, test } from '@playwright/test';
import { loginAs, makeUser, seedItem, seedRoadmap, seedSprint } from './helpers';

/**
 * BDD scenarios — team roster & DRI avatars (F-13, UI layer).
 *
 * - Given an owner opens the Team panel, When they import people with access
 *   and add a manual name, Then the roster lists both — the LabOS entry
 *   tagged, the manual one with an initials avatar (AC-13.1/13.3).
 * - Given an item whose DRI matches a roster member, Then an avatar chip
 *   renders on its bar; a free-typed DRI still gets an initials chip
 *   (AC-13.6/13.7).
 * - Given a sprint with a roster DRI, Then its bar carries the avatar too.
 */
test.describe('F-13 team roster & DRI avatars', () => {
  test('team panel: import access members + manual add with initials', async ({
    page,
    context,
    request,
  }) => {
    const owner = makeUser('owner');
    await loginAs(context, owner);
    const seeded = await seedRoadmap(request, owner);

    await page.goto(`/roadmaps/${seeded.roadmapId}`);
    await page.getByTestId('team-button').click();
    await expect(page.getByTestId('team-empty')).toBeVisible();

    // import brings in the requester (an actual LabOS-style user)
    await page.getByTestId('team-import').click();
    const rows = page.getByTestId('team-member');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(owner.name);
    await expect(rows.first()).toContainText('LabOS');

    // manual add renders an initials avatar ("Maria Garcia" → MG)
    await page.getByTestId('team-add-name').fill('Maria Garcia');
    await page.getByTestId('team-add').click();
    await expect(rows).toHaveCount(2);
    const maria = rows.filter({ hasText: 'Maria Garcia' });
    await expect(maria.getByTestId('team-avatar')).toHaveText('MG');
    await expect(maria).not.toContainText('LabOS');

    // duplicates are rejected with a visible error
    await page.getByTestId('team-add-name').fill('maria garcia');
    await page.getByTestId('team-add').click();
    await expect(page.getByTestId('team-error')).toContainText(/already on the team/i);
    await expect(rows).toHaveCount(2);
  });

  test('DRI avatars appear on item and sprint bars; free-typed DRIs get initials', async ({
    page,
    context,
    request,
  }) => {
    const owner = makeUser('owner');
    await loginAs(context, owner);
    const seeded = await seedRoadmap(request, owner);
    const itemId = await seedItem(request, owner, seeded, { dris: 'Maria Garcia' });
    await seedSprint(request, owner, itemId, { dri: 'Grace Hopper' });

    // roster: Maria on the team; Grace intentionally NOT on it
    await page.goto(`/roadmaps/${seeded.roadmapId}`);
    await page.getByTestId('team-button').click();
    await page.getByTestId('team-add-name').fill('Maria Garcia');
    await page.getByTestId('team-add').click();
    await expect(page.getByTestId('team-member')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('team-panel')).toBeHidden();

    // item bar shows Maria's chip (initials — no LabOS image in dev)
    const itemAvatars = page.getByTestId('item-bar-avatars');
    await expect(itemAvatars.getByTestId('bar-avatar')).toHaveText('MG');

    // sprint bar shows a chip for the free-typed, non-roster DRI
    await page.getByTestId('item-bar').click();
    const sprintAvatars = page.getByTestId('sprint-bar-avatars');
    await expect(sprintAvatars.getByTestId('bar-avatar')).toHaveText('GH');
  });
});
