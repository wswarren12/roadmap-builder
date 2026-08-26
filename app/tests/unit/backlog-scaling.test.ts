import { describe, expect, it } from 'vitest';
import { backlogToRoadmapInputs, itemToBacklogPayload, parseBacklogPayload } from '@/lib/backlog';
import type { BacklogItem, RoadmapItem, SprintItem } from '@/lib/types';

const item: RoadmapItem = {
  id: 'item', roadmapId: 'roadmap', initiativeId: 'initiative', title: 'Launch', description: 'Ship it',
  startDate: '2026-01-01', endDate: '2026-01-11', milestoneText: 'Beta', milestoneDate: '2026-01-06',
  okrs: 'KR', dris: 'Dana', responsibleTeam: 'Core', status: 'yellow', kpi: 'Users', completedAt: '2026-01-10',
  colorIndex: 2, syncGroupId: 'linked', createdAt: 'x', updatedAt: 'x',
};
const sprint: SprintItem = {
  id: 'sprint', roadmapItemId: item.id, name: 'Build', description: 'Build it', startDate: '2026-01-03',
  endDate: '2026-01-07', milestoneText: 'Review', milestoneDate: '2026-01-05', kpi: 'PRs', dri: 'Dev',
  completedAt: '2026-01-07', syncGroupId: 's-linked', createdAt: 'x', updatedAt: 'x',
};

function backlog(payload = itemToBacklogPayload(item, [sprint])): BacklogItem {
  return { id: 'b', ownerUid: 'u', ...payload, createdAt: 'x', updatedAt: 'x' };
}

describe('backlog normalized date geometry', () => {
  it('scrubs absolute dates, completion and sync data while retaining fractions', () => {
    const payload = itemToBacklogPayload(item, [sprint]);
    expect(payload.milestonePosition).toBe(0.5);
    expect(payload.sprints[0]).toMatchObject({ startPosition: 0.2, endPosition: 0.6, milestonePosition: 0.4 });
    expect(JSON.stringify(payload)).not.toMatch(/2026-|completed|syncGroup|roadmapId|initiativeId/);
  });

  it('scales fractions proportionally into a shorter range and clears completion/sync', () => {
    const result = backlogToRoadmapInputs(backlog(), {
      roadmapId: 'new', initiativeId: 'new-i', startDate: '2026-03-01', endDate: '2026-03-06', colorIndex: 0,
    });
    expect(result.item).toMatchObject({ startDate: '2026-03-01', endDate: '2026-03-06', milestoneDate: '2026-03-04', completedAt: null });
    expect(result.sprints[0]).toMatchObject({ startDate: '2026-03-02', endDate: '2026-03-04', milestoneDate: '2026-03-03', completedAt: null });
  });

  it('maps zero-day spans to the new start and clamps corrupt persisted positions', () => {
    const zero = { ...item, endDate: item.startDate, milestoneDate: item.startDate };
    const parsed = parseBacklogPayload({ ...itemToBacklogPayload(zero, [{ ...sprint, startDate: item.startDate, endDate: item.startDate }]), milestonePosition: 3, sprints: [{ name: 'S', startPosition: -1, endPosition: 4 }] });
    expect(parsed.milestonePosition).toBe(1);
    expect(parsed.sprints[0]).toMatchObject({ startPosition: 0, endPosition: 1 });
    const result = backlogToRoadmapInputs(backlog(parsed), { roadmapId: 'r', initiativeId: 'i', startDate: '2026-04-01', endDate: '2026-04-01', colorIndex: 0 });
    expect(result.sprints[0].startDate).toBe('2026-04-01');
    expect(result.sprints[0].endDate).toBe('2026-04-01');
  });
});
