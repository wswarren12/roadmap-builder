import { expect, test } from '@playwright/test';
import { apiAs, loginAs, makeUser, seedItem, seedRoadmap, seedSprint } from './helpers';

test.describe('F-15a: move an item between initiatives from the edit modal', () => {
  test('drill-down edit offers every initiative and the move sticks', async ({
    page,
    context,
    request,
  }) => {
    const owner = makeUser('owner');
    await loginAs(context, owner);
    const seeded = await seedRoadmap(request, owner);
    const growth = await (
      await apiAs(request, owner, 'post', `/api/roadmaps/${seeded.roadmapId}/initiatives`, {
        name: 'Growth',
      })
    ).json();
    const itemId = await seedItem(request, owner, seeded, { title: 'Movable item' });

    await page.goto(`/roadmaps/${seeded.roadmapId}/items/${itemId}`);
    await page.getByTestId('edit-item').click();
    await page.getByTestId('item-initiative').selectOption(growth.initiative.id);
    await page.getByTestId('save-item').click();

    // header now names the new initiative; roadmap view shows the bar in its row
    await expect(page.getByText('Growth').first()).toBeVisible();
    await page.goto(`/roadmaps/${seeded.roadmapId}`);
    const growthRow = page.locator(`[data-row-initiative-id="${growth.initiative.id}"]`);
    await expect(growthRow.getByTestId('item-bar')).toHaveCount(1);
  });
});

test.describe('F-15b: import from other roadmap with permanent sync', () => {
  test('import copies item + sprints and edits propagate both ways', async ({
    page,
    context,
    request,
  }) => {
    const owner = makeUser('owner');
    await loginAs(context, owner);

    // roadmap A (source) with an item and a sprint; roadmap B (target)
    const a = await seedRoadmap(request, owner, { title: 'Source roadmap' });
    const itemId = await seedItem(request, owner, a, { title: 'Shared API work' });
    await seedSprint(request, owner, itemId, { name: 'Sprint zero' });
    const b = await seedRoadmap(request, owner, { title: 'Target roadmap' });

    // import via the modal's secondary button
    await page.goto(`/roadmaps/${b.roadmapId}`);
    await page.getByTestId('add-item').first().click(); // opens the new-item modal
    await page.getByTestId('open-import').click();
    await page.getByTestId('import-roadmap').selectOption({ label: 'Source roadmap' });
    await expect(page.getByTestId('import-item-row')).toContainText('Shared API work');
    await page.getByTestId('import-item').click();

    // the linked copy appears on B
    await expect(page.getByTestId('item-bar')).toHaveCount(1);
    await expect(page.getByTestId('item-bar')).toContainText('Shared API work');

    // edit the copy on B → the original on A follows (title + dates)
    const bItems = await (await apiAs(request, owner, 'get', `/api/roadmaps/${b.roadmapId}`)).json();
    const copyId = bItems.items[0].id;
    await apiAs(request, owner, 'patch', `/api/items/${copyId}`, {
      title: 'Shared API work v2',
      endDate: '2026-10-01',
    });
    const aItem = await (await apiAs(request, owner, 'get', `/api/items/${itemId}`)).json();
    expect(aItem.item.title).toBe('Shared API work v2');
    expect(aItem.item.endDate).toBe('2026-10-01');

    // sprint added on A appears on B's copy
    await apiAs(request, owner, 'post', `/api/items/${itemId}/sprints`, {
      name: 'Cross-roadmap sprint',
      startDate: '2026-08-03',
      endDate: '2026-08-14',
    });
    const copyDetail = await (await apiAs(request, owner, 'get', `/api/items/${copyId}`)).json();
    expect(copyDetail.sprints.map((s: { name: string }) => s.name)).toContain(
      'Cross-roadmap sprint',
    );

    // the sync is visible in the UI too
    await page.reload();
    await expect(page.getByTestId('item-bar')).toContainText('Shared API work v2');
  });
});
