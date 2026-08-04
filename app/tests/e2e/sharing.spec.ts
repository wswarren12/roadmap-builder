import { expect, test } from '@playwright/test';
import {
  apiAs,
  loginAs,
  makeUser,
  seedItem,
  seedRoadmap,
  seedSprint,
} from './helpers';

test.describe('F-6 sharing via invite link & the viewer experience', () => {
  test('invite link → viewer gets the full read experience with zero write surface (AC-6.1)', async ({
    browser,
    page,
    context,
    request,
  }) => {
    const owner = makeUser('owner');
    const viewer = makeUser('viewer');
    await loginAs(context, owner);
    const seeded = await seedRoadmap(request, owner);
    const itemId = await seedItem(request, owner, seeded);
    await seedSprint(request, owner, itemId);

    // owner creates the viewer invite link in the panel
    await page.goto(`/roadmaps/${seeded.roadmapId}`);
    await page.getByTestId('share-button').click();
    await page.getByTestId('invite-generate-viewer').click();
    await expect(page.getByTestId('invite-active-viewer')).toBeVisible();
    const joinUrl = (await page.getByTestId('invite-link-viewer').textContent())!.trim();
    expect(joinUrl).toContain('/join/');

    // viewer opens the link signed-in → lands on the roadmap read-only
    const viewerContext = await browser.newContext();
    await loginAs(viewerContext, viewer);
    const vp = await viewerContext.newPage();
    await vp.goto(joinUrl);
    await expect(vp).toHaveURL(new RegExp(`/roadmaps/${seeded.roadmapId}$`));

    // no edit affordances anywhere
    await expect(vp.getByTestId('viewer-badge')).toBeVisible();
    await expect(vp.getByTestId('share-button')).toHaveCount(0);
    await expect(vp.getByTestId('add-initiative')).toHaveCount(0);
    await expect(vp.getByTestId('add-item')).toHaveCount(0);
    await expect(vp.getByTestId('delete-roadmap')).toHaveCount(0);
    await expect(vp.getByTestId('roadmap-title')).toBeDisabled();
    await expect(vp.getByTestId('item-bar-handle-right')).toHaveCount(0);

    // drill-down + read-only card still work
    await vp.getByTestId('item-bar').first().click();
    await expect(vp).toHaveURL(new RegExp(`/items/${itemId}$`));
    await expect(vp.getByTestId('add-sprint')).toHaveCount(0);
    await expect(vp.getByTestId('edit-item')).toHaveCount(0);
    await vp.getByTestId('sprint-bar').first().click();
    await expect(vp.getByTestId('sprint-card')).toBeVisible();
    await expect(vp.getByTestId('sprint-card-edit')).toHaveCount(0);
    await expect(vp.getByTestId('sprint-card-delete')).toHaveCount(0);

    // viewer appears by verified name + role when the owner reopens the panel
    // (the list is fetched on open, so a reopen reflects the new claim).
    // Wait for the drawer's ~200ms close animation to finish before
    // reopening — Radix drops a reopen dispatched mid-exit-animation.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('share-panel')).toBeHidden();
    await page.getByTestId('share-button').click();
    await expect(page.getByTestId('share-row')).toContainText(viewer.name);
    await expect(page.getByTestId('share-role')).toContainText('Viewer');

    // roadmap shows on the viewer's profile under "Shared with you"
    await vp.goto('/profile');
    await expect(
      vp.locator('section[aria-label="Shared with you"] [data-testid="roadmap-row"]'),
    ).toHaveCount(1);

    await viewerContext.close();
  });

  test('editor invite link → editor can edit and add, but not share or delete', async ({
    browser,
    page,
    context,
    request,
  }) => {
    const owner = makeUser('owner');
    const editor = makeUser('editor');
    await loginAs(context, owner);
    const seeded = await seedRoadmap(request, owner);
    await seedItem(request, owner, seeded);

    // owner creates the editor invite link in the panel
    await page.goto(`/roadmaps/${seeded.roadmapId}`);
    await page.getByTestId('share-button').click();
    await page.getByTestId('invite-generate-editor').click();
    await expect(page.getByTestId('invite-active-editor')).toBeVisible();
    const joinUrl = (await page.getByTestId('invite-link-editor').textContent())!.trim();
    expect(joinUrl).toContain('/join/');
    // the viewer link stays independent and un-generated
    await expect(page.getByTestId('invite-generate-viewer')).toBeVisible();

    // editor opens the link signed-in → lands on the roadmap with edit surface
    const editorContext = await browser.newContext();
    await loginAs(editorContext, editor);
    const ep = await editorContext.newPage();
    await ep.goto(joinUrl);
    await expect(ep).toHaveURL(new RegExp(`/roadmaps/${seeded.roadmapId}$`));

    await expect(ep.getByTestId('editor-badge')).toBeVisible();
    await expect(ep.getByTestId('roadmap-title')).toBeEnabled();
    await expect(ep.getByTestId('add-item').first()).toBeVisible();
    await expect(ep.getByTestId('add-initiative')).toBeVisible();
    // owner-only surface stays hidden
    await expect(ep.getByTestId('share-button')).toHaveCount(0);
    await expect(ep.getByTestId('delete-roadmap')).toHaveCount(0);

    // editor makes a real addition: a new initiative row appears and sticks
    const rowsBefore = await ep.getByTestId('initiative-row').count();
    await ep.getByTestId('add-initiative').click();
    await expect(ep.getByTestId('initiative-row')).toHaveCount(rowsBefore + 1);
    await ep.reload();
    await expect(ep.getByTestId('initiative-row')).toHaveCount(rowsBefore + 1);

    // editor appears with the Editor role when the owner reopens the panel
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('share-panel')).toBeHidden();
    await page.getByTestId('share-button').click();
    await expect(page.getByTestId('share-row')).toContainText(editor.name);
    await expect(page.getByTestId('share-role')).toContainText('Editor');

    await editorContext.close();
  });

  test('server rejects every crafted viewer mutation with 403 (AC-6.3)', async ({
    context,
    request,
  }) => {
    const owner = makeUser('owner');
    const viewer = makeUser('viewer');
    await loginAs(context, owner);
    const seeded = await seedRoadmap(request, owner);
    const itemId = await seedItem(request, owner, seeded);
    const sprintId = await seedSprint(request, owner, itemId);

    // viewer joins via API-claimed invite
    const inviteRes = await apiAs(request, owner, 'post', `/api/roadmaps/${seeded.roadmapId}/invite`);
    const { token } = await inviteRes.json();
    const claim = await apiAs(request, viewer, 'post', `/api/join/${token}`);
    expect(claim.status()).toBe(200);

    const attempts: Array<[method: 'post' | 'patch' | 'delete', path: string, data?: unknown]> = [
      ['patch', `/api/roadmaps/${seeded.roadmapId}`, { title: 'hacked' }],
      ['delete', `/api/roadmaps/${seeded.roadmapId}`],
      ['post', `/api/roadmaps/${seeded.roadmapId}/initiatives`, { name: 'hacked' }],
      ['patch', `/api/initiatives/${seeded.initiativeId}`, { name: 'hacked' }],
      ['delete', `/api/initiatives/${seeded.initiativeId}`],
      [
        'post',
        `/api/roadmaps/${seeded.roadmapId}/items`,
        {
          initiativeId: seeded.initiativeId,
          title: 'hacked',
          startDate: '2026-08-01',
          endDate: '2026-08-10',
        },
      ],
      ['patch', `/api/items/${itemId}`, { title: 'hacked' }],
      ['delete', `/api/items/${itemId}`],
      [
        'post',
        `/api/items/${itemId}/sprints`,
        { name: 'hacked', startDate: '2026-08-03', endDate: '2026-08-05' },
      ],
      ['patch', `/api/sprints/${sprintId}`, { name: 'hacked' }],
      ['delete', `/api/sprints/${sprintId}`],
      ['post', `/api/roadmaps/${seeded.roadmapId}/shares`, { email: 'x@y.zz' }],
      ['post', `/api/roadmaps/${seeded.roadmapId}/invite`],
      ['delete', `/api/roadmaps/${seeded.roadmapId}/invite`],
    ];

    for (const [method, path, data] of attempts) {
      const res = await apiAs(request, viewer, method, path, data);
      expect(res.status(), `${method.toUpperCase()} ${path}`).toBe(403);
    }
  });

  test('non-whitelisted user gets the no-access state (AC-6.2)', async ({
    page,
    context,
    request,
  }) => {
    const owner = makeUser('owner');
    const stranger = makeUser('stranger');
    await loginAs(context, owner);
    const seeded = await seedRoadmap(request, owner);

    const res = await apiAs(request, stranger, 'get', `/api/roadmaps/${seeded.roadmapId}`);
    expect(res.status()).toBe(403);

    await context.clearCookies();
    await loginAs(context, stranger);
    await page.goto(`/roadmaps/${seeded.roadmapId}`);
    await expect(page.getByText("You don't have access")).toBeVisible();
    await expect(page.getByText(/ask the owner to share/i)).toBeVisible();
  });

  test('removing a joined viewer revokes access and clears their profile (AC-6.4)', async ({
    browser,
    page,
    context,
    request,
  }) => {
    const owner = makeUser('owner');
    const viewer = makeUser('viewer');
    await loginAs(context, owner);
    const seeded = await seedRoadmap(request, owner);
    const inviteRes = await apiAs(request, owner, 'post', `/api/roadmaps/${seeded.roadmapId}/invite`);
    const { token } = await inviteRes.json();

    const viewerContext = await browser.newContext();
    await loginAs(viewerContext, viewer);
    const vp = await viewerContext.newPage();
    await vp.goto(`/join/${token}`);
    await expect(vp).toHaveURL(new RegExp(`/roadmaps/${seeded.roadmapId}$`));

    // owner removes the viewer from the panel
    await page.goto(`/roadmaps/${seeded.roadmapId}`);
    await page.getByTestId('share-button').click();
    await expect(page.getByTestId('share-row')).toContainText(viewer.name);
    await page.getByTestId('share-remove').click();
    await expect(page.getByTestId('share-row')).toHaveCount(0);

    await vp.reload();
    await expect(vp.getByText("You don't have access")).toBeVisible();
    await vp.goto('/profile');
    await expect(vp.getByText('Nothing shared with you yet')).toBeVisible();

    await viewerContext.close();
  });

  test('turning the link off invalidates it; rotating issues a different one', async ({
    browser,
    page,
    context,
    request,
  }) => {
    const owner = makeUser('owner');
    const late = makeUser('late');
    await loginAs(context, owner);
    const seeded = await seedRoadmap(request, owner);

    await page.goto(`/roadmaps/${seeded.roadmapId}`);
    await page.getByTestId('share-button').click();
    await page.getByTestId('invite-generate-viewer').click();
    const firstUrl = (await page.getByTestId('invite-link-viewer').textContent())!.trim();

    // rotate → different link
    await page.getByTestId('invite-rotate-viewer').click();
    await expect(page.getByTestId('invite-link-viewer')).not.toHaveText(firstUrl);

    // old link is dead for a new visitor
    const lateContext = await browser.newContext();
    await loginAs(lateContext, late);
    const lp = await lateContext.newPage();
    await lp.goto(firstUrl);
    await expect(lp.getByText('This invite link is no longer valid')).toBeVisible();

    // turn off → panel returns to generate state
    await page.getByTestId('invite-disable-viewer').click();
    await expect(page.getByTestId('invite-generate-viewer')).toBeVisible();

    await lateContext.close();
  });

  // Exercises the DEV_AUTH user switcher end-to-end in a single browser —
  // the same manual flow a developer uses to test sharing between two people
  // locally: create as Dev One, share, switch to Dev Two, join read-only.
  test('dev-user switcher: create as Dev One, join read-only as Dev Two', async ({
    page,
  }) => {
    const title = `Switcher demo ${Date.now()}`;

    // Start as the default user (Dev One) and create a roadmap via the UI.
    await page.goto('/profile');
    await expect(page.getByRole('button', { name: 'Dev One' })).toBeVisible();
    await page.getByTestId('new-roadmap').click();
    await page.getByTestId('roadmap-title-input').fill(title);
    await page.getByTestId('create-roadmap').click();
    await expect(page.getByTestId('roadmap-view')).toBeVisible();

    // Share it: generate a viewer invite link.
    await page.getByTestId('share-button').click();
    await page.getByTestId('invite-generate-viewer').click();
    const joinUrl = (await page.getByTestId('invite-link-viewer').textContent())!.trim();
    expect(joinUrl).toContain('/join/');

    // Close the drawer before touching the nav: while the modal drawer is
    // open, Radix aria-hides the page background, and role-based locators
    // (getByRole) exclude aria-hidden elements — the avatar click would
    // never resolve.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('share-panel')).toBeHidden();

    // Switch to Dev Two via the avatar popover.
    await page.getByRole('button', { name: 'Dev One' }).click();
    await expect(page.getByTestId('dev-user-switcher')).toBeVisible();
    await page.getByTestId('switch-dev-two').click();
    await expect(page.getByRole('button', { name: 'Dev Two' })).toBeVisible();

    // Open the invite link as Dev Two → read-only roadmap, no write surface.
    await page.goto(joinUrl);
    await expect(page.getByTestId('roadmap-view')).toBeVisible();
    await expect(page.getByTestId('viewer-badge')).toBeVisible();
    await expect(page.getByTestId('share-button')).toHaveCount(0);
    await expect(page.getByTestId('add-initiative')).toHaveCount(0);

    // Switch back to Dev One; the share panel now lists Dev Two as a viewer.
    await page.getByRole('button', { name: 'Dev Two' }).click();
    await page.getByTestId('switch-dev-owner').click();
    await expect(page.getByRole('button', { name: 'Dev One' })).toBeVisible();
    await page.goto(joinUrl.replace(/\/join\/.*/, ''));
    // Land back on the roadmap (last-visited redirect) and reopen sharing.
    await expect(page.getByTestId('roadmap-view')).toBeVisible();
    await page.getByTestId('share-button').click();
    await expect(page.getByTestId('share-row')).toContainText('Dev Two');
  });
});
