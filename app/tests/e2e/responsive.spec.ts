import { expect, test, type Page } from '@playwright/test';
import { apiAs, loginAs, makeUser, seedItem, seedRoadmap } from './helpers';

/** Widest option text vs rendered width, for every native select on the page. */
async function selectFit(page: Page) {
  return page.evaluate(() => {
    const ctx = document.createElement('canvas').getContext('2d')!;
    return [...document.querySelectorAll('select')].map((s) => {
      const cs = getComputedStyle(s);
      ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const widest = Math.max(0, ...[...s.options].map((o) => ctx.measureText(o.textContent ?? '').width));
      return { id: s.dataset.testid ?? s.getAttribute('aria-label'), width: s.clientWidth, widest };
    });
  });
}

test.describe('backlog button, dropdown sizing, mobile layout', () => {
  test('Backlog button next to Team opens that roadmap\'s backlog (owner and viewer)', async ({ page, context, request }) => {
    const owner = makeUser('owner');
    const viewer = makeUser('viewer');
    const seeded = await seedRoadmap(request, owner, { title: 'Alpha' });
    await apiAs(request, owner, 'post', `/api/roadmaps/${seeded.roadmapId}/backlog`, { title: 'Parked' });
    const invite = await (await apiAs(request, owner, 'post', `/api/roadmaps/${seeded.roadmapId}/invite`, { role: 'viewer' })).json();
    await apiAs(request, viewer, 'post', `/api/join/${invite.token}`);

    await loginAs(context, owner);
    await page.goto(`/roadmaps/${seeded.roadmapId}`);
    const backlogBtn = page.getByTestId('backlog-button');
    await expect(backlogBtn).toHaveText('Backlog (1)');
    const btnBox = (await backlogBtn.boundingBox())!;
    const teamBox = (await page.getByTestId('team-button').boundingBox())!;
    expect(Math.abs(btnBox.y - teamBox.y)).toBeLessThan(2); // same row, next to Team
    expect(btnBox.x).toBeLessThan(teamBox.x);
    await backlogBtn.click();
    await expect(page).toHaveURL(new RegExp(`/backlog\\?roadmap=${seeded.roadmapId}`));
    await expect(page.getByTestId('backlog-row')).toHaveCount(1);

    const vc = await page.context().browser()!.newContext();
    await loginAs(vc, viewer);
    const vp = await vc.newPage();
    await vp.goto(`/roadmaps/${seeded.roadmapId}`);
    await expect(vp.getByTestId('team-button')).toHaveCount(0);
    await vp.getByTestId('backlog-button').click();
    await expect(vp.getByTestId('backlog-readonly')).toBeVisible();
    await vc.close();
  });

  test('every dropdown renders wider than its longest option, with long names, on desktop and mobile', async ({ page, context, request }) => {
    const owner = makeUser('owner');
    await loginAs(context, owner);
    const seeded = await seedRoadmap(request, owner);
    await apiAs(request, owner, 'post', `/api/roadmaps/${seeded.roadmapId}/initiatives`, { name: 'Enterprise onboarding & compliance programme' });
    await apiAs(request, owner, 'post', `/api/roadmaps/${seeded.roadmapId}/team`, { name: 'Maximiliana Featherstonehaugh-Smythe' });
    await seedItem(request, owner, seeded, { dris: 'Maximiliana Featherstonehaugh-Smythe' });
    await apiAs(request, owner, 'post', `/api/roadmaps/${seeded.roadmapId}/backlog`, { title: 'Parked' });

    for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      await page.goto(`/roadmaps/${seeded.roadmapId}`);
      await expect(page.getByTestId('filter-swimlane')).toBeVisible();
      for (const s of await selectFit(page)) expect(s.width, `${s.id} @${viewport.width}`).toBeGreaterThan(s.widest);
      await page.getByTestId('view-board').click();
      await expect(page.getByTestId('board-card-move').first()).toBeVisible();
      for (const s of await selectFit(page)) expect(s.width, `${s.id} board @${viewport.width}`).toBeGreaterThan(s.widest);
      // No horizontal page overflow at either size (board/timeline scroll inside their own boxes).
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
  });

  test('mobile: header stacks, nav collapses to a working hamburger, board columns stack', async ({ page, context, request }) => {
    const owner = makeUser('owner');
    await loginAs(context, owner);
    const seeded = await seedRoadmap(request, owner, { title: 'Alpha' });
    await seedItem(request, owner, seeded, { title: 'One' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/roadmaps/${seeded.roadmapId}`);

    // Desktop nav links hidden, hamburger visible; primary action lives in the drawer.
    await expect(page.getByRole('button', { name: 'Open menu' })).toBeVisible();
    await expect(page.getByTestId('new-roadmap')).toBeHidden();
    await page.getByRole('button', { name: 'Open menu' }).click();
    const menu = page.getByTestId('mobile-menu');
    await expect(menu.getByRole('link', { name: 'Home' })).toBeVisible();
    await expect(menu.getByRole('link', { name: 'Backlog' })).toHaveAttribute('href', `/backlog?roadmap=${seeded.roadmapId}`);
    await expect(page.getByTestId('mobile-new-roadmap')).toBeVisible();
    await page.keyboard.press('Escape');

    // Header actions wrap under the title; view controls stack full-width.
    const title = (await page.getByTestId('roadmap-title').boundingBox())!;
    const backlogBtn = (await page.getByTestId('backlog-button').boundingBox())!;
    expect(backlogBtn.y).toBeGreaterThan(title.y + title.height - 1);
    const swim = (await page.getByTestId('filter-swimlane').boundingBox())!;
    const person = (await page.getByTestId('filter-person').boundingBox())!;
    expect(person.y).toBeGreaterThan(swim.y + swim.height - 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    // Board: columns stack vertically instead of a 6-wide grid.
    await page.getByTestId('view-board').click();
    const col1 = (await page.getByTestId('board-col-backlog').boundingBox())!;
    const col2 = (await page.getByTestId('board-col-green').boundingBox())!;
    expect(Math.abs(col1.x - col2.x)).toBeLessThan(2);
    expect(col2.y).toBeGreaterThan(col1.y + col1.height - 1);

    // Navigate via the drawer.
    await page.getByRole('button', { name: 'Open menu' }).click();
    await menu.getByRole('link', { name: 'Backlog' }).click();
    await expect(page).toHaveURL(new RegExp(`/backlog\\?roadmap=${seeded.roadmapId}`));
    await expect(page.getByTestId('backlog-roadmap-picker')).toBeVisible();
  });
});
