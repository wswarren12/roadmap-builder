import { expect, test, type Locator } from '@playwright/test';
import { apiAs, dragBy, loginAs, makeUser, seedItem, seedRoadmap, seedSprint } from './helpers';

/**
 * BDD scenarios — the month/timeline header stays visible while reading lower
 * swimlanes (F-9b).
 *
 * The sticky behaviour itself already ships (`.timeline-head` is sticky inside
 * `.timeline-scroll`); board.spec covers the basic pinned+aligned case. These
 * scenarios cover what that one does not: long roadmaps, narrow/wide
 * viewports, resizing, combined scrolling, jitter, the item (sprint) level,
 * that the header never covers a bar or a control, and that the home screen is
 * untouched.
 */

/** Reads the geometry the acceptance criteria are stated in. */
async function metrics(scroll: Locator) {
  return scroll.evaluate((el: HTMLElement) => {
    const head = el.querySelector('.timeline-head') as HTMLElement;
    const headRect = head.getBoundingClientRect();
    const boxRect = el.getBoundingClientRect();
    const cols = [...el.querySelectorAll('.time-col')].map((c) => {
      const r = c.getBoundingClientRect();
      return { left: r.left, width: r.width };
    });
    // Grid lines repeat per row; one row's set matches the heading columns.
    const firstLanes = el.querySelector('.lanes');
    const lines = firstLanes
      ? [...firstLanes.querySelectorAll('.lane-grid-line')].map(
          (l) => l.getBoundingClientRect().left,
        )
      : [];
    return {
      scrollTop: el.scrollTop,
      scrollLeft: el.scrollLeft,
      headTop: headRect.top,
      headBottom: headRect.bottom,
      headHeight: headRect.height,
      boxTop: boxRect.top,
      boxLeft: boxRect.left,
      boxRight: boxRect.right,
      cols,
      lines,
    };
  });
}

async function scrollTo(scroll: Locator, top: number, left: number) {
  await scroll.evaluate(
    (el: HTMLElement, p: { top: number; left: number }) => {
      el.scrollTop = p.top;
      el.scrollLeft = p.left;
    },
    { top, left },
  );
}

/** A roadmap filled to the 8-initiative cap and 12 months wide, so it
 *  overflows both ways inside the short viewports used below. */
async function seedTall(
  request: Parameters<typeof seedRoadmap>[0],
  owner: Parameters<typeof seedRoadmap>[1],
  rows = 7,
) {
  const seeded = await seedRoadmap(request, owner, {
    startMonth: '2026-01-01',
    endMonth: '2026-12-01',
  });
  // One initiative ships with the roadmap; MAX_INITIATIVES (8) is the cap.
  for (let i = 0; i < rows; i++) {
    const res = await apiAs(request, owner, 'post', `/api/roadmaps/${seeded.roadmapId}/initiatives`, {
      name: `Row ${i}`,
    });
    if (res.status() !== 201) throw new Error(`seed initiative failed: ${res.status()}`);
  }
  // A bar in the first row (for the at-rest checks) and one in the last row
  // (reachable once scrolled to the bottom, well clear of the header).
  await seedItem(request, owner, seeded, {
    title: 'Early work',
    startDate: '2026-01-05',
    endDate: '2026-03-20',
  });
  const rowsNow = await (
    await apiAs(request, owner, 'get', `/api/roadmaps/${seeded.roadmapId}`)
  ).json();
  const lastInitiative = rowsNow.initiatives[rowsNow.initiatives.length - 1];
  await apiAs(request, owner, 'post', `/api/roadmaps/${seeded.roadmapId}/items`, {
    initiativeId: lastInitiative.id,
    title: 'Late work',
    startDate: '2026-02-02',
    endDate: '2026-04-10',
  });
  return seeded;
}

test.describe('F-9b sticky month header', () => {
  test('stays pinned through a long vertical scroll and never drifts (no jitter)', async ({
    page,
    context,
    request,
  }) => {
    const owner = makeUser('owner');
    await loginAs(context, owner);
    const seeded = await seedTall(request, owner);
    await page.setViewportSize({ width: 1100, height: 420 });
    await page.goto(`/roadmaps/${seeded.roadmapId}`);
    const scroll = page.getByTestId('timeline-scroll');
    await expect(page.getByTestId('initiative-row')).toHaveCount(8);

    const tops: number[] = [];
    // Genuinely overflowing: there is somewhere to scroll to.
    expect(
      await scroll.evaluate((el: HTMLElement) => el.scrollHeight - el.clientHeight),
    ).toBeGreaterThan(50);

    for (const top of [0, 60, 120, 240, 400, 10_000]) {
      await scrollTo(scroll, top, 0);
      const m = await metrics(scroll);
      // Pinned to the top edge of the scrolling box at every depth.
      expect(Math.abs(m.headTop - m.boxTop)).toBeLessThan(1);
      tops.push(m.headTop);
    }
    // No jitter: the header's viewport position is identical at every depth.
    expect(new Set(tops.map((t) => Math.round(t))).size).toBe(1);
  });

  test('keeps labels aligned with columns under combined and horizontal scrolling', async ({
    page,
    context,
    request,
  }) => {
    const owner = makeUser('owner');
    await loginAs(context, owner);
    const seeded = await seedTall(request, owner);
    await page.setViewportSize({ width: 900, height: 420 });
    await page.goto(`/roadmaps/${seeded.roadmapId}`);
    const scroll = page.getByTestId('timeline-scroll');
    await expect(page.getByTestId('initiative-row')).toHaveCount(8);

    for (const [top, left] of [
      [0, 0],
      [0, 250],
      [200, 250],
      [400, 700],
      [300, 1400],
    ]) {
      await scrollTo(scroll, top, left);
      const m = await metrics(scroll);
      expect(Math.abs(m.headTop - m.boxTop)).toBeLessThan(1);
      // Every month boundary line sits under the matching heading edge.
      expect(m.lines.length).toBeGreaterThan(0);
      m.lines.forEach((line, i) =>
        expect(Math.abs(line - m.cols[i + 1].left)).toBeLessThan(1),
      );
    }
  });

  test('re-aligns after a viewport resize, narrow and wide', async ({
    page,
    context,
    request,
  }) => {
    const owner = makeUser('owner');
    await loginAs(context, owner);
    const seeded = await seedTall(request, owner);
    await page.goto(`/roadmaps/${seeded.roadmapId}`);
    const scroll = page.getByTestId('timeline-scroll');
    await expect(page.getByTestId('initiative-row')).toHaveCount(8);

    for (const size of [
      { width: 640, height: 720 },
      { width: 1440, height: 900 },
      { width: 820, height: 560 },
    ]) {
      await page.setViewportSize(size);
      await scrollTo(scroll, 300, 200);
      const m = await metrics(scroll);
      expect(Math.abs(m.headTop - m.boxTop)).toBeLessThan(1);
      m.lines.forEach((line, i) =>
        expect(Math.abs(line - m.cols[i + 1].left)).toBeLessThan(1),
      );
      // The header never grows past a sane strip of the scroll box.
      expect(m.headHeight).toBeLessThan(80);
    }
  });

  test('does not cover content at rest, stays opaque, and leaves the strip below it interactive', async ({
    page,
    context,
    request,
  }) => {
    const owner = makeUser('owner');
    await loginAs(context, owner);
    const seeded = await seedTall(request, owner);
    await page.setViewportSize({ width: 1100, height: 520 });
    await page.goto(`/roadmaps/${seeded.roadmapId}`);
    const scroll = page.getByTestId('timeline-scroll');
    await expect(page.getByTestId('item-bar').first()).toBeVisible();

    // At rest the header occupies its own strip: no bar sits behind it.
    await scrollTo(scroll, 0, 0);
    const rest = await metrics(scroll);
    const coveredAtRest = await page.evaluate((headBottom: number) => {
      return [...document.querySelectorAll('.bar')]
        .map((b) => b.getBoundingClientRect())
        .filter((r) => r.height > 0 && r.top < headBottom - 1).length;
    }, rest.headBottom);
    expect(coveredAtRest).toBe(0);

    // Opaque: rows passing underneath while scrolled must not bleed through.
    const opaque = await page.evaluate(() => {
      const head = document.querySelector('.timeline-head') as HTMLElement;
      const bg = getComputedStyle(head).backgroundColor;
      const alpha = bg.startsWith('rgba') ? Number(bg.split(',')[3]) : 1;
      return { bg, alpha };
    });
    expect(opaque.bg).not.toBe('rgba(0, 0, 0, 0)');
    expect(opaque.alpha).toBe(1);

    // Scrolled: the row immediately under the header is still hit-testable
    // (the header is not an invisible blocker over the content below it).
    await scrollTo(scroll, 250, 0);
    const scrolled = await metrics(scroll);
    const underHeaderIsContent = await page.evaluate((y: number) => {
      const el = document.elementFromPoint(400, y + 6);
      return { onHeader: !!el?.closest('.timeline-head'), inScroller: !!el?.closest('.timeline-scroll') };
    }, scrolled.headBottom);
    expect(underHeaderIsContent.onHeader).toBe(false);
    expect(underHeaderIsContent.inScroller).toBe(true);

    // Row controls (the label column) remain clickable while scrolled.
    await expect(page.getByTestId('add-item').first()).toBeVisible();
  });

  test('sprint (item) level header is sticky and aligned too', async ({
    page,
    context,
    request,
  }) => {
    const owner = makeUser('owner');
    await loginAs(context, owner);
    const seeded = await seedRoadmap(request, owner);
    const itemId = await seedItem(request, owner, seeded, {
      title: 'Signup revamp',
      startDate: '2026-07-01',
      endDate: '2026-12-15',
    });
    for (let i = 0; i < 8; i++) {
      await seedSprint(request, owner, itemId, {
        name: `Sprint ${i}`,
        startDate: '2026-07-06',
        endDate: '2026-07-17',
      });
    }
    await page.setViewportSize({ width: 900, height: 560 });
    await page.goto(`/roadmaps/${seeded.roadmapId}/items/${itemId}`);
    const scroll = page.getByTestId('item-timeline-scroll');
    await expect(scroll).toBeVisible();

    await scrollTo(scroll, 400, 200);
    const m = await metrics(scroll);
    expect(Math.abs(m.headTop - m.boxTop)).toBeLessThan(1);
    expect(m.cols.length).toBeGreaterThan(0);
  });

  test('the home screen has no timeline header', async ({ page, context, request }) => {
    const owner = makeUser('owner');
    await loginAs(context, owner);
    await seedRoadmap(request, owner);
    await page.goto('/');
    await expect(page.getByTestId('timeline-scroll')).toHaveCount(0);
    await expect(page.locator('.timeline-head')).toHaveCount(0);
  });

  test('dragging and editing still work while the header is pinned', async ({
    page,
    context,
    request,
  }) => {
    const owner = makeUser('owner');
    await loginAs(context, owner);
    const seeded = await seedTall(request, owner);
    await page.setViewportSize({ width: 1200, height: 520 });
    await page.goto(`/roadmaps/${seeded.roadmapId}`);
    const scroll = page.getByTestId('timeline-scroll');
    // Scroll to the bottom: the header stays pinned and the last row's bar is
    // fully below it (a bar scrolled UNDER the header is, correctly, covered).
    await scrollTo(scroll, 10_000, 0);
    const rows = page.getByTestId('initiative-row');
    const bar = rows.last().getByTestId('item-bar').first();
    await expect(bar).toBeVisible();
    // The view auto-scrolls horizontally to today, so bring the bar into the
    // viewport before pointing at it (its dates are early in the year).
    await bar.scrollIntoViewIfNeeded();
    await scrollTo(scroll, 10_000, (await scroll.evaluate((el: HTMLElement) => el.scrollLeft)));
    const head = await metrics(scroll);
    const box = (await bar.boundingBox())!;
    expect(box.y).toBeGreaterThan(head.headBottom);
    expect(box.x).toBeGreaterThan(head.boxLeft);
    const startBefore = (await bar.getAttribute('data-start'))!;

    // Drag the bar sideways by ~14 days; dates must change, header must stay put.
    // width = (days + 1) * pxPerDay for the seeded 2026-02-02..2026-04-10 span.
    const pxPerDay = box.width / 68;
    await dragBy(page, bar, 14 * pxPerDay);
    await expect(rows.last().getByTestId('item-bar').first()).not.toHaveAttribute(
      'data-start',
      startBefore,
    );

    const after = await metrics(scroll);
    expect(Math.abs(after.headTop - after.boxTop)).toBeLessThan(1);

    // The edit surface still opens from a scrolled position.
    await page.getByTestId('add-item').first().click();
    await expect(page.getByTestId('save-item')).toBeVisible();
  });
});
