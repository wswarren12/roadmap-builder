import { expect, test } from '@playwright/test';
import {
  apiAs,
  loginAs,
  makeUser,
  seedItem,
  seedRoadmap,
  seedSprint,
} from './helpers';

test.describe('F-8 PDF export', () => {
  test('roadmap-level export downloads a non-empty slugified PDF (AC-8.1)', async ({
    page,
    context,
    request,
  }) => {
    const owner = makeUser('owner');
    await loginAs(context, owner);
    const seeded = await seedRoadmap(request, owner, { title: 'H2 2026 Platform Roadmap' });
    await seedItem(request, owner, seeded);

    await page.goto(`/roadmaps/${seeded.roadmapId}`);
    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('export-pdf').click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toBe('h2-2026-platform-roadmap.pdf');
    const path = await download.path();
    const fs = await import('fs');
    expect(fs.statSync(path!).size).toBeGreaterThan(1000);
  });

  test('item-level export contains both slugs and succeeds for viewers (AC-8.2, AC-8.3)', async ({
    browser,
    context,
    request,
  }) => {
    const owner = makeUser('owner');
    const viewer = makeUser('viewer');
    await loginAs(context, owner);
    const seeded = await seedRoadmap(request, owner, { title: 'H2 2026 Platform Roadmap' });
    const itemId = await seedItem(request, owner, seeded, { title: 'Signup Revamp' });
    await seedSprint(request, owner, itemId);
    await apiAs(request, owner, 'post', `/api/roadmaps/${seeded.roadmapId}/shares`, {
      email: viewer.email,
    });

    const viewerContext = await browser.newContext();
    await loginAs(viewerContext, viewer);
    const vp = await viewerContext.newPage();
    await vp.goto(`/roadmaps/${seeded.roadmapId}/items/${itemId}`);

    const downloadPromise = vp.waitForEvent('download');
    await vp.getByTestId('export-item-pdf').click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toBe('h2-2026-platform-roadmap—signup-revamp.pdf');
    const path = await download.path();
    const fs = await import('fs');
    expect(fs.statSync(path!).size).toBeGreaterThan(1000);
    await viewerContext.close();
  });
});

test.describe('F-9 today line & auto-scroll', () => {
  test('today line renders on both levels when today is in range (AC-9.1)', async ({
    page,
    context,
    request,
  }) => {
    const owner = makeUser('owner');
    await loginAs(context, owner);

    // Seed relative to the real clock so the test never rots: the item
    // spans today ±14 days, inside a 5-month range around this month.
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1));
    const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 2, 1));
    const seeded = await seedRoadmap(request, owner, {
      startMonth: iso(monthStart),
      endMonth: iso(monthEnd),
    });
    const itemId = await seedItem(request, owner, seeded, {
      startDate: iso(new Date(now.getTime() - 14 * 86400_000)),
      endDate: iso(new Date(now.getTime() + 14 * 86400_000)),
      milestoneText: '',
      milestoneDate: undefined,
    });

    await page.goto(`/roadmaps/${seeded.roadmapId}`);
    await expect(page.getByTestId('today-line').first()).toBeVisible();

    await page.goto(`/roadmaps/${seeded.roadmapId}/items/${itemId}`);
    await expect(page.getByTestId('today-line')).toBeVisible();
  });

  test('no today line when today is outside the range (AC-9.1)', async ({
    page,
    context,
    request,
  }) => {
    const owner = makeUser('owner');
    await loginAs(context, owner);
    const seeded = await seedRoadmap(request, owner, {
      startMonth: '2027-01-01',
      endMonth: '2027-06-01',
    });

    await page.goto(`/roadmaps/${seeded.roadmapId}`);
    await expect(page.getByTestId('roadmap-view')).toBeVisible();
    await expect(page.getByTestId('today-line')).toHaveCount(0);
  });

  test('opening a wide roadmap auto-scrolls the current month into view (AC-9.2)', async ({
    page,
    context,
    request,
  }) => {
    const owner = makeUser('owner');
    await loginAs(context, owner);
    // 12 months starting well before today (today = 2026-07-22).
    const seeded = await seedRoadmap(request, owner, {
      startMonth: '2025-09-01',
      endMonth: '2026-08-01',
    });

    await page.setViewportSize({ width: 900, height: 800 });
    await page.goto(`/roadmaps/${seeded.roadmapId}`);
    const scroller = page.getByTestId('timeline-scroll');
    await expect
      .poll(async () => scroller.evaluate((el) => el.scrollLeft))
      .toBeGreaterThan(100);
  });
});
