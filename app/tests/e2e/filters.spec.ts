import { expect, test } from '@playwright/test';
import { apiAs, loginAs, makeUser, seedItem, seedRoadmap } from './helpers';

const bars = (page: import('@playwright/test').Page) => page.getByTestId('item-bar');
const rows = (page: import('@playwright/test').Page) => page.getByTestId('initiative-row');

async function seed(request: import('@playwright/test').APIRequestContext, owner: ReturnType<typeof makeUser>) {
  const seeded = await seedRoadmap(request, owner);
  const second = await (
    await apiAs(request, owner, 'post', `/api/roadmaps/${seeded.roadmapId}/initiatives`, { name: 'Growth' })
  ).json();
  await apiAs(request, owner, 'post', `/api/roadmaps/${seeded.roadmapId}/team`, { name: 'Ada' });
  // Onboarding: Ada is DRI; Platform team owns another; a third has neither.
  await seedItem(request, owner, seeded, { title: 'Ada leads', dris: 'Ada', startDate: '2026-07-01', endDate: '2026-07-20' });
  const teamItem = await (
    await apiAs(request, owner, 'post', `/api/roadmaps/${seeded.roadmapId}/items`, {
      initiativeId: seeded.initiativeId, title: 'Platform owns', dris: '', responsibleTeam: 'Platform',
      startDate: '2026-08-01', endDate: '2026-08-20',
    })
  ).json();
  await seedItem(request, owner, seeded, { title: 'Nobody yet', dris: '', startDate: '2026-09-01', endDate: '2026-09-20' });
  // Growth: legacy value with Ada's name typed into the team field.
  await apiAs(request, owner, 'post', `/api/roadmaps/${seeded.roadmapId}/items`, {
    initiativeId: second.initiative.id, title: 'Growth push', dris: 'Grace', responsibleTeam: 'Ada',
    startDate: '2026-10-01', endDate: '2026-10-20',
  });
  return { ...seeded, secondId: second.initiative.id as string, teamItemId: teamItem.item.id as string };
}

test.describe('swimlane focus & person filter', () => {
  test('swimlane focus alone shows one row and restores all', async ({ page, context, request }) => {
    const owner = makeUser('owner');
    await loginAs(context, owner);
    const s = await seed(request, owner);
    await page.goto(`/roadmaps/${s.roadmapId}`);
    await expect(rows(page)).toHaveCount(2);
    await expect(bars(page)).toHaveCount(4);

    await page.getByTestId('filter-swimlane').selectOption(s.secondId);
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText('Growth');
    await expect(bars(page)).toHaveCount(1);
    await expect(page.locator('.roadmap-meta')).toContainText('1 of 4 items');

    await page.getByTestId('filter-clear').click();
    await expect(rows(page)).toHaveCount(2);
    await expect(bars(page)).toHaveCount(4);
    await expect(page.getByTestId('filter-clear')).toHaveCount(0);
  });

  test('person filter alone labels DRI vs team matches, on the timeline and the board', async ({ page, context, request }) => {
    const owner = makeUser('owner');
    await loginAs(context, owner);
    const s = await seed(request, owner);
    await page.goto(`/roadmaps/${s.roadmapId}`);

    await page.getByTestId('filter-person').selectOption('Ada');
    await expect(bars(page)).toHaveCount(2);
    await expect(bars(page).filter({ hasText: 'Ada leads' }).getByTestId('item-bar-tag')).toHaveText('DRI');
    await expect(bars(page).filter({ hasText: 'Growth push' }).getByTestId('item-bar-tag')).toHaveText('Team');

    // A responsible team is selectable from the same control and matches by the team field only.
    await page.getByTestId('filter-person').selectOption('Platform');
    await expect(bars(page)).toHaveCount(1);
    await expect(bars(page).first()).toContainText('Platform owns');
    await expect(bars(page).first().getByTestId('item-bar-tag')).toHaveText('Team');

    await page.getByTestId('view-board').click();
    await expect(page.getByTestId('board-card')).toHaveCount(1);
    await expect(page.getByTestId('board-card-match')).toHaveText('Responsible team');
    await page.getByTestId('filter-person').selectOption('Ada');
    await expect(page.getByTestId('board-card')).toHaveCount(2);
    await expect(page.getByTestId('board-card').filter({ hasText: 'Ada leads' }).getByTestId('board-card-match')).toHaveText('DRI');
  });

  test('filters combine, show a clear empty state, and never change records', async ({ page, context, request }) => {
    const owner = makeUser('owner');
    await loginAs(context, owner);
    const s = await seed(request, owner);
    const before = await (await apiAs(request, owner, 'get', `/api/roadmaps/${s.roadmapId}`)).json();

    await page.goto(`/roadmaps/${s.roadmapId}`);
    await page.getByTestId('filter-swimlane').selectOption(s.initiativeId);
    await page.getByTestId('filter-person').selectOption('Ada');
    await expect(rows(page)).toHaveCount(1);
    await expect(bars(page)).toHaveCount(1);
    await expect(bars(page).first()).toContainText('Ada leads');

    // Ada has nothing in Growth as DRI... but does as legacy team; Grace has nothing in the first initiative.
    await page.getByTestId('filter-person').selectOption('Grace');
    await expect(bars(page)).toHaveCount(0);
    await expect(page.getByTestId('filter-empty')).toContainText('No items match');
    await expect(page.getByTestId('filter-empty')).toContainText('Grace has nothing in "Initiative 1"');
    await page.getByRole('button', { name: 'Show all swimlanes and people' }).click();
    await expect(page.getByTestId('filter-empty')).toHaveCount(0);
    await expect(rows(page)).toHaveCount(2);
    await expect(bars(page)).toHaveCount(4);

    // Underlying records untouched: DRI and team fields exactly as seeded.
    const after = await (await apiAs(request, owner, 'get', `/api/roadmaps/${s.roadmapId}`)).json();
    expect(after.items.map((i: any) => [i.id, i.dris, i.responsibleTeam, i.initiativeId, i.startDate]))
      .toEqual(before.items.map((i: any) => [i.id, i.dris, i.responsibleTeam, i.initiativeId, i.startDate]));
    const teamItem = after.items.find((i: any) => i.id === s.teamItemId);
    expect(teamItem).toMatchObject({ dris: '', responsibleTeam: 'Platform' });
  });

  test('filters are per open roadmap: another roadmap is unaffected and offers its own people', async ({ page, context, request }) => {
    const owner = makeUser('owner');
    await loginAs(context, owner);
    const s = await seed(request, owner);
    const other = await seedRoadmap(request, owner, { title: 'Other' });
    await seedItem(request, owner, other, { title: 'Elsewhere', dris: 'Zed' });

    await page.goto(`/roadmaps/${s.roadmapId}`);
    await page.getByTestId('filter-person').selectOption('Ada');
    await expect(bars(page)).toHaveCount(2);

    await page.goto(`/roadmaps/${other.roadmapId}`);
    await expect(bars(page)).toHaveCount(1);
    await expect(page.getByTestId('filter-clear')).toHaveCount(0);
    const options = await page.getByTestId('filter-person').locator('option').allTextContents();
    expect(options).toContain('Zed');
    expect(options).not.toContain('Ada');
  });

  test('DRI and responsible team stay separate fields in the item form and persist independently', async ({ page, context, request }) => {
    const owner = makeUser('owner');
    await loginAs(context, owner);
    const s = await seed(request, owner);
    await page.goto(`/roadmaps/${s.roadmapId}/items/${s.teamItemId}`);
    await page.getByTestId('edit-item').click();
    await expect(
      page.getByTestId('item-responsible-team').locator('option:checked'),
    ).toHaveText('Platform (no linked profile)');
    await expect(page.getByTestId('item-dri')).toHaveValue('');
    await page.getByTestId('item-dri').selectOption({ label: 'Ada · no LabOS profile' });
    await page.getByTestId('save-item').click();
    const stored = await (await apiAs(request, owner, 'get', `/api/items/${s.teamItemId}`)).json();
    expect(stored.item).toMatchObject({ dris: 'Ada', responsibleTeam: 'Platform' });
  });
});
