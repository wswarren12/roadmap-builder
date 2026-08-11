import { expect, test } from '@playwright/test';
import { loginAs, makeUser, seedItem, seedRoadmap } from './helpers';

test.describe('Agent links: create → agent suggests → owner accepts', () => {
  test('full loop updates the bar', async ({ page, context, request }) => {
    const owner = makeUser('owner');
    await loginAs(context, owner);
    const seeded = await seedRoadmap(request, owner);
    await seedItem(request, owner, seeded, { title: 'API beta', endDate: '2026-09-15' });

    // owner creates a suggester link in the share panel
    await page.goto(`/roadmaps/${seeded.roadmapId}`);
    await page.getByTestId('share-button').click();
    await page.getByTestId('agent-link-name').fill('Hermes PM bot');
    await page.getByTestId('agent-link-create').click();
    await expect(page.getByTestId('agent-link-row')).toContainText('Hermes PM bot');

    const agentUrl = (await page.getByTestId('agent-link-url').textContent())!.trim();
    const token = agentUrl.split('/agent/')[1];
    expect(token).toBeTruthy();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('share-panel')).toBeHidden();

    // agent: JSON accept on the bare URL serves the manifest (middleware)
    const manifest = await request.get(`/agent/${token}`, {
      headers: { accept: 'application/json' },
    });
    expect(manifest.status()).toBe(200);
    const caps = (await manifest.json()).capabilities;
    expect(caps.create_suggestion).toBeTruthy();
    expect(caps.update_item).toBeFalsy(); // suggester, not editor

    // agent reads the roadmap and files a suggestion
    const roadmap = await (await request.get(`/agent/${token}/api/roadmap`)).json();
    const item = roadmap.items.find((i: { title: string }) => i.title === 'API beta');
    const filed = await request.post(`/agent/${token}/api/suggestions`, {
      data: {
        kind: 'update_item',
        target_id: item.id,
        payload: { endDate: '2026-10-01' },
        rationale: 'Backend slips a sprint',
      },
    });
    expect(filed.status()).toBe(201);

    // owner sees the badge and a ghost bar, reviews, accepts
    await page.reload();
    await expect(page.getByTestId('suggestions-badge')).toContainText('1 suggestion');
    await expect(page.getByTestId('ghost-bar')).toBeVisible();
    await page.getByTestId('suggestions-badge').click();
    await expect(page.getByTestId('suggestion-card')).toContainText('Hermes PM bot');
    await expect(page.getByTestId('suggestion-rationale')).toContainText('Backend slips a sprint');
    await page.getByTestId('suggestion-accept').click();
    await expect(page.getByTestId('suggestion-card')).toHaveCount(0);

    // the change landed; the ghost is gone; the agent sees the outcome
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('ghost-bar')).toHaveCount(0);
    const after = await (await request.get(`/agent/${token}/api/roadmap`)).json();
    expect(after.items.find((i: { id: string }) => i.id === item.id).endDate).toBe('2026-10-01');
    const mine = await (await request.get(`/agent/${token}/api/suggestions`)).json();
    expect(mine.suggestions[0].status).toBe('accepted');

    // browser view renders read-only with the banner (no login needed)
    const anonContext = await page.context().browser()!.newContext();
    const ap = await anonContext.newPage();
    await ap.goto(`/agent/${token}`);
    await expect(ap.getByTestId('agent-banner')).toContainText('Hermes PM bot');
    await expect(ap.getByTestId('agent-banner')).toContainText('suggest access');
    await expect(ap.getByTestId('agent-item-bar')).toHaveCount(1);
    await anonContext.close();

    // revoke → agent 404s
    await page.getByTestId('share-button').click();
    await page.getByTestId('agent-link-revoke').click();
    await expect(page.getByTestId('agent-link-row')).toHaveCount(0);
    expect((await request.get(`/agent/${token}/api`)).status()).toBe(404);
  });
});
