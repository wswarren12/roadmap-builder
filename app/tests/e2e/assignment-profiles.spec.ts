import { expect, test } from '@playwright/test';
import { apiAs, loginAs, makeUser, seedItem, seedRoadmap } from './helpers';

/**
 * BDD scenarios — DRI & responsible-team pickers link real LabOS profiles
 * (F-13b, UI layer).
 *
 * - Given a roadmap roster, When an editor picks a DRI and a responsible
 *   team, Then both persist across a reload and the displayed assignment
 *   links to the selected LabOS profile (AC-13b.1).
 * - Given two roster people with the same display name, When the editor picks
 *   the second one, Then the saved assignment links to THAT person's profile
 *   (AC-13b.2).
 * - Given a person with no LabOS profile, Then their assignment shows as
 *   plain text instead of a dead link (AC-13b.7).
 * - Given a viewer, Then the item form is not reachable and the assignment is
 *   unchanged (AC-13b.5).
 */

const PLATFORM = { uid: 't-platform', name: 'Platform' };

test.describe('F-13b assignment profiles', () => {
  test('picks a DRI and a team, persists both, and links to the LabOS profiles', async ({
    page,
    context,
    request,
  }) => {
    const owner = makeUser('owner', [PLATFORM]);
    await loginAs(context, owner);
    const seeded = await seedRoadmap(request, owner);
    const itemId = await seedItem(request, owner, seeded, { title: 'Signup revamp', dris: '' });

    await page.goto(`/roadmaps/${seeded.roadmapId}/items/${itemId}`);
    await page.getByTestId('edit-item').click();

    // The owner is on the roster with their LabOS profile.
    await page.getByTestId('item-dri').selectOption({ label: `${owner.name} · LabOS` });
    await page.getByTestId('item-responsible-team').selectOption({ label: 'Platform · LabOS' });
    await page.getByTestId('save-item').click();

    // Displayed assignment links to the selected identities.
    const dri = page.getByTestId('item-dri-value');
    await expect(dri).toHaveAttribute('href', `https://os.pl.xyz/members/${owner.uid}`);
    await expect(dri).toHaveAttribute('target', '_blank');
    await expect(dri).toContainText(owner.name);
    await expect(page.getByTestId('item-responsible-team-value')).toHaveAttribute(
      'href',
      'https://os.pl.xyz/teams/t-platform',
    );

    // Persists across a reload, and the API stored the identities.
    await page.reload();
    await expect(page.getByTestId('item-dri-value')).toHaveAttribute(
      'href',
      `https://os.pl.xyz/members/${owner.uid}`,
    );
    const stored = await (await apiAs(request, owner, 'get', `/api/items/${itemId}`)).json();
    expect(stored.item.dris).toBe(owner.name);
    expect(stored.item.driMemberId).toBeTruthy();
    expect(stored.item.responsibleTeam).toBe('Platform');
    expect(stored.item.responsibleTeamUid).toBe('t-platform');
  });

  test('two people with the same name resolve to different profiles', async ({
    page,
    context,
    request,
  }) => {
    const owner = makeUser('owner');
    await loginAs(context, owner);
    const seeded = await seedRoadmap(request, owner);
    const itemId = await seedItem(request, owner, seeded, { title: 'Ambiguous', dris: '' });

    // Two distinct LabOS members who share a display name join the roadmap
    // through the editor invite link (the supported uid-share path).
    await page.goto(`/roadmaps/${seeded.roadmapId}`);
    await page.getByTestId('share-button').click();
    await page.getByTestId('invite-generate-editor').click();
    const joinUrl = (await page.getByTestId('invite-link-editor').textContent())!.trim();

    for (const uid of ['u-alex-1', 'u-alex-2']) {
      const alex = { uid, name: 'Alex Smith', email: `${uid}@e2e.test` };
      const ctx = await page.context().browser()!.newContext();
      await loginAs(ctx, alex);
      const ap = await ctx.newPage();
      await ap.goto(joinUrl);
      await ap.waitForURL(/\/roadmaps\//);
      await ctx.close();
    }
    await apiAs(request, owner, 'post', `/api/roadmaps/${seeded.roadmapId}/team/import`, {});

    await page.goto(`/roadmaps/${seeded.roadmapId}/items/${itemId}`);
    await page.getByTestId('edit-item').click();
    const select = page.getByTestId('item-dri');
    // Duplicate names are disambiguated by uid in the picker.
    await expect(select.locator('option', { hasText: 'Alex Smith · LabOS u-alex-2' })).toHaveCount(1);
    await select.selectOption({ label: 'Alex Smith · LabOS u-alex-2' });
    await page.getByTestId('save-item').click();

    await expect(page.getByTestId('item-dri-value')).toHaveAttribute(
      'href',
      'https://os.pl.xyz/members/u-alex-2',
    );
  });

  test('a person with no LabOS profile renders as plain text, not a dead link', async ({
    page,
    context,
    request,
  }) => {
    const owner = makeUser('owner');
    await loginAs(context, owner);
    const seeded = await seedRoadmap(request, owner);
    const itemId = await seedItem(request, owner, seeded, { title: 'Manual DRI', dris: '' });
    await apiAs(request, owner, 'post', `/api/roadmaps/${seeded.roadmapId}/team`, {
      name: 'Contractor Kim',
    });

    await page.goto(`/roadmaps/${seeded.roadmapId}/items/${itemId}`);
    await page.getByTestId('edit-item').click();
    await page.getByTestId('item-dri').selectOption({ label: 'Contractor Kim · no LabOS profile' });
    await expect(page.getByTestId('item-dri-unlinked')).toBeVisible();
    await page.getByTestId('save-item').click();

    const value = page.getByTestId('item-dri-value');
    await expect(value).toHaveAttribute('data-linked', 'false');
    await expect(value).toContainText('Contractor Kim');
  });

  test('a viewer cannot change the assignment', async ({ page, context, request }) => {
    const owner = makeUser('owner', [PLATFORM]);
    const viewer = makeUser('viewer');
    const seeded = await seedRoadmap(request, owner);
    const itemId = await seedItem(request, owner, seeded, { title: 'Read only', dris: '' });
    await apiAs(request, owner, 'post', `/api/roadmaps/${seeded.roadmapId}/shares`, {
      memberUid: viewer.uid,
      memberName: viewer.name,
      role: 'viewer',
    });
    await apiAs(request, owner, 'post', `/api/roadmaps/${seeded.roadmapId}/team/import`, {});
    const roster = await (
      await apiAs(request, owner, 'get', `/api/roadmaps/${seeded.roadmapId}/team`)
    ).json();
    const ownerRow = roster.members.find((m: { memberUid: string }) => m.memberUid === owner.uid);
    await apiAs(request, owner, 'patch', `/api/items/${itemId}`, { driMemberId: ownerRow.id });

    await loginAs(context, viewer);
    await page.goto(`/roadmaps/${seeded.roadmapId}/items/${itemId}`);
    // Read-only: no edit affordance at all.
    await expect(page.getByTestId('edit-item')).toHaveCount(0);

    // A direct API attempt is refused and the saved assignment is preserved.
    const denied = await apiAs(request, viewer, 'patch', `/api/items/${itemId}`, {
      driMemberId: null,
    });
    expect(denied.status()).toBe(403);
    const stored = await (await apiAs(request, owner, 'get', `/api/items/${itemId}`)).json();
    expect(stored.item.driMemberId).toBe(ownerRow.id);
  });
});
