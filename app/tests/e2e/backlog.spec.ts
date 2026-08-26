import { expect, test } from '@playwright/test';

const OWNER = { uid: 'e2e-backlog-owner', name: 'Backlog Owner', email: 'backlog-owner@pl.network' };

async function signIn(page: import('@playwright/test').Page) {
  await page.context().addCookies([{ name: 'dev_user', value: encodeURIComponent(JSON.stringify(OWNER)), domain: '127.0.0.1', path: '/' }]);
}

test.describe('personal backlog', () => {
  test.beforeEach(async ({ page }) => { await signIn(page); });

  test('creates and edits an unscheduled backlog item', async ({ page }, testInfo) => {
    const title = `E2E unscheduled idea ${testInfo.retry}`;
    const updatedTitle = `E2E refined idea ${testInfo.retry}`;
    await page.goto('/backlog');
    await page.getByTestId('new-backlog-item').click();
    await page.getByTestId('backlog-title').fill(title);
    await page.getByTestId('save-backlog-item').click();
    const row = page.getByTestId('backlog-row').filter({ hasText: title }).last();
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: 'Inspect / edit' }).click();
    await page.getByTestId('backlog-title').fill(updatedTitle);
    await page.getByTestId('save-backlog-item').click();
    await expect(page.getByTestId('backlog-row').filter({ hasText: updatedTitle }).last()).toBeVisible();
  });

  test('moves a scheduled item then imports it with new dates', async ({ page }, testInfo) => {
    const itemTitle = `Move me in E2E ${testInfo.retry}`;
    const roadmapResponse = await page.request.post('/api/roadmaps', { data: { title: `Backlog E2E roadmap ${testInfo.retry}`, startMonth: '2026-07-01', endMonth: '2026-12-01' } });
    expect(roadmapResponse.ok()).toBeTruthy();
    const { roadmap, initiatives } = await roadmapResponse.json();
    const itemResponse = await page.request.post(`/api/roadmaps/${roadmap.id}/items`, { data: { initiativeId: initiatives[0].id, title: itemTitle, startDate: '2026-08-01', endDate: '2026-09-01' } });
    expect(itemResponse.ok()).toBeTruthy();
    const { item } = await itemResponse.json();

    await page.goto(`/roadmaps/${roadmap.id}/items/${item.id}`);
    await page.getByTestId('move-to-backlog').click();
    await expect(page.getByText('Move item to your backlog?')).toBeVisible();
    await page.getByTestId('confirm-delete').click();
    await expect(page).toHaveURL(/\/backlog$/);
    const row = page.getByTestId('backlog-row').filter({ hasText: itemTitle }).last();
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: 'Add to roadmap' }).click();
    await page.getByTestId('backlog-roadmap').click();
    await page.getByRole('menuitem', { name: roadmap.title }).click();
    await page.getByTestId('backlog-initiative').click();
    await page.getByRole('menuitem', { name: initiatives[0].name }).click();
    await page.getByLabel('Start date').fill('2026-10-01');
    await page.getByLabel('End date').fill('2026-11-01');
    await page.getByTestId('confirm-backlog-import').click();
    await expect(page).toHaveURL(new RegExp(`/roadmaps/${roadmap.id}`));
  });
});
