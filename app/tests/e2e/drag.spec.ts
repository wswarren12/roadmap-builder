import { expect, test } from '@playwright/test';
import {
  apiAs,
  dragBy,
  dragOnto,
  loginAs,
  makeUser,
  seedItem,
  seedRoadmap,
  seedSprint,
} from './helpers';

/**
 * BDD scenarios — mouse drags across initiatives.
 *
 * AC-2.8: Given an item in initiative A, When its bar is dragged vertically
 * into initiative B's lanes, Then it renders in B's row and survives reload.
 *
 * F-10: Given initiative A with an item (that has a sprint), When A's drag
 * handle is dropped onto initiative B, Then a confirm dialog explains the
 * conversion; cancelling changes nothing (AC-10.5), confirming replaces A
 * with an item of B whose drill-down lists A's item and its former sprint
 * as sprint items (AC-10.1).
 */
test.describe('drag across initiatives', () => {
  test('item bar dragged into another initiative moves rows and persists (AC-2.8)', async ({
    page,
    context,
    request,
  }) => {
    const owner = makeUser('owner');
    await loginAs(context, owner);
    const seeded = await seedRoadmap(request, owner);
    await seedItem(request, owner, seeded);
    const res = await apiAs(request, owner, 'post', `/api/roadmaps/${seeded.roadmapId}/initiatives`, {
      name: 'Infra',
    });
    expect(res.status()).toBe(201);

    await page.goto(`/roadmaps/${seeded.roadmapId}`);
    const rows = page.getByTestId('initiative-row');
    await expect(rows).toHaveCount(2);
    const bar = page.getByTestId('item-bar').first();
    const startBefore = (await bar.getAttribute('data-start'))!;

    // straight-down drag: same dates, new initiative
    const barBox = (await bar.boundingBox())!;
    const targetLanes = rows.nth(1).getByTestId('lanes');
    const laneBox = (await targetLanes.boundingBox())!;
    await dragBy(page, bar, 0, laneBox.y + laneBox.height / 2 - (barBox.y + barBox.height / 2));

    await expect(rows.nth(1).getByTestId('item-bar')).toHaveCount(1);
    await expect(rows.nth(0).getByTestId('item-bar')).toHaveCount(0);
    await expect(page.getByTestId('item-bar').first()).toHaveAttribute(
      'data-start',
      startBefore,
    );

    await page.reload();
    await expect(
      page.getByTestId('initiative-row').nth(1).getByTestId('item-bar'),
    ).toHaveCount(1);
  });

  test('initiative dragged onto another converts to an item after confirm; cancel is a no-op (AC-10.1, AC-10.5)', async ({
    page,
    context,
    request,
  }) => {
    const owner = makeUser('owner');
    await loginAs(context, owner);
    const seeded = await seedRoadmap(request, owner);
    await apiAs(request, owner, 'patch', `/api/initiatives/${seeded.initiativeId}`, {
      name: 'Onboarding',
    });
    const itemId = await seedItem(request, owner, seeded);
    await seedSprint(request, owner, itemId);
    const res = await apiAs(request, owner, 'post', `/api/roadmaps/${seeded.roadmapId}/initiatives`, {
      name: 'Infra',
    });
    expect(res.status()).toBe(201);

    await page.goto(`/roadmaps/${seeded.roadmapId}`);
    const rows = page.getByTestId('initiative-row');
    await expect(rows).toHaveCount(2);

    // cancel path — nothing changes
    const handle = rows.nth(0).getByTestId('initiative-drag-handle');
    await dragOnto(page, handle, rows.nth(1).getByTestId('lanes'));
    await expect(page.locator('.confirm-message')).toContainText(
      /"Onboarding" will become a single item of "Infra"/,
    );
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0).getByTestId('item-bar')).toHaveCount(1);

    // confirm path — initiative becomes an item of "Infra"
    await dragOnto(page, handle, rows.nth(1).getByTestId('lanes'));
    await page.getByTestId('confirm-delete').click();
    await expect(rows).toHaveCount(1);
    const converted = page.getByTestId('item-bar');
    await expect(converted).toHaveCount(1);
    await expect(converted).toContainText('Onboarding');

    // drill-down: the old item and its sprint are now sprint items
    await converted.click();
    await expect(page.getByTestId('sprint-bar')).toHaveCount(2);
    await expect(page.getByTestId('sprint-bar').filter({ hasText: 'Signup revamp' })).toHaveCount(1);
    await expect(page.getByTestId('sprint-bar').filter({ hasText: 'Sprint 1' })).toHaveCount(1);
  });
});
