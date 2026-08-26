import { addDays, daysBetween } from './dates';
import type {
  BacklogImportTarget,
  BacklogItem,
  BacklogItemInput,
  BacklogSprint,
  ItemInput,
  RoadmapItem,
  SprintInput,
  SprintItem,
} from './types';

export type BacklogPayload = Omit<BacklogItem, 'id' | 'ownerUid' | 'createdAt' | 'updatedAt'>;

const clamp = (value: number) => Math.max(0, Math.min(1, value));

function position(start: string, end: string, date: string | null): number | null {
  if (date === null) return null;
  const span = daysBetween(start, end);
  return span <= 0 ? 0 : clamp(daysBetween(start, date) / span);
}

function dateAt(start: string, end: string, value: number | null): string | null {
  if (value === null) return null;
  return addDays(start, Math.round(clamp(value) * Math.max(0, daysBetween(start, end))));
}

export function directBacklogPayload(input: BacklogItemInput): BacklogPayload {
  return {
    title: input.title,
    description: input.description,
    milestoneText: input.milestoneText,
    milestonePosition: null,
    okrs: input.okrs,
    dris: input.dris,
    responsibleTeam: input.responsibleTeam,
    status: input.status,
    kpi: input.kpi,
    colorIndex: input.colorIndex,
    sprints: [],
  };
}

/** Strip every absolute date/sync/completion field and retain only normalized geometry. */
export function itemToBacklogPayload(item: RoadmapItem, sprints: SprintItem[]): BacklogPayload {
  return {
    title: item.title,
    description: item.description,
    milestoneText: item.milestoneText,
    milestonePosition: position(item.startDate, item.endDate, item.milestoneDate),
    okrs: item.okrs,
    dris: item.dris,
    responsibleTeam: item.responsibleTeam,
    status: item.status,
    kpi: item.kpi,
    colorIndex: item.colorIndex,
    sprints: sprints.map((sprint) => ({
      name: sprint.name,
      description: sprint.description,
      startPosition: position(item.startDate, item.endDate, sprint.startDate) ?? 0,
      endPosition: position(item.startDate, item.endDate, sprint.endDate) ?? 0,
      milestoneText: sprint.milestoneText,
      milestonePosition: position(item.startDate, item.endDate, sprint.milestoneDate),
      kpi: sprint.kpi,
      dri: sprint.dri,
    })),
  };
}

export function backlogToRoadmapInputs(
  item: BacklogItem,
  target: BacklogImportTarget,
): { item: ItemInput; sprints: SprintInput[] } {
  const itemInput: ItemInput = {
    initiativeId: target.initiativeId,
    title: item.title,
    description: item.description,
    startDate: target.startDate,
    endDate: target.endDate,
    milestoneText: item.milestoneText,
    milestoneDate: dateAt(target.startDate, target.endDate, item.milestonePosition),
    okrs: item.okrs,
    dris: item.dris,
    responsibleTeam: item.responsibleTeam,
    status: item.status,
    kpi: item.kpi,
    completedAt: null,
  };
  const sprints = item.sprints.map((sprint) => ({
    name: sprint.name,
    description: sprint.description,
    startDate: dateAt(target.startDate, target.endDate, sprint.startPosition)!,
    endDate: dateAt(target.startDate, target.endDate, sprint.endPosition)!,
    milestoneText: sprint.milestoneText,
    milestoneDate: dateAt(target.startDate, target.endDate, sprint.milestonePosition),
    kpi: sprint.kpi,
    dri: sprint.dri,
    completedAt: null,
  }));
  return { item: itemInput, sprints };
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function normalized(value: unknown): number {
  return clamp(typeof value === 'number' && Number.isFinite(value) ? value : 0);
}

/** Validate untrusted JSONB while tolerating forward-compatible missing text fields. */
export function parseBacklogPayload(value: unknown): BacklogPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('invalid backlog payload');
  }
  const row = value as Record<string, unknown>;
  if (typeof row.title !== 'string' || !row.title.trim()) {
    throw new Error('invalid backlog payload');
  }
  const rawSprints = Array.isArray(row.sprints) ? row.sprints : [];
  const sprints: BacklogSprint[] = rawSprints.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error('invalid backlog payload');
    }
    const sprint = entry as Record<string, unknown>;
    if (typeof sprint.name !== 'string' || !sprint.name.trim()) {
      throw new Error('invalid backlog payload');
    }
    const startPosition = normalized(sprint.startPosition);
    const endPosition = Math.max(startPosition, normalized(sprint.endPosition));
    return {
      name: sprint.name,
      description: text(sprint.description),
      startPosition,
      endPosition,
      milestoneText: text(sprint.milestoneText),
      milestonePosition:
        sprint.milestonePosition === null || sprint.milestonePosition === undefined
          ? null
          : normalized(sprint.milestonePosition),
      kpi: text(sprint.kpi),
      dri: text(sprint.dri),
    };
  });
  return {
    title: row.title,
    description: text(row.description),
    milestoneText: text(row.milestoneText),
    milestonePosition:
      row.milestonePosition === null || row.milestonePosition === undefined
        ? null
        : normalized(row.milestonePosition),
    okrs: text(row.okrs),
    dris: text(row.dris),
    responsibleTeam: text(row.responsibleTeam),
    status: row.status === 'yellow' || row.status === 'red' ? row.status : 'green',
    kpi: text(row.kpi),
    colorIndex: Number.isInteger(row.colorIndex) ? Math.max(0, Number(row.colorIndex)) : 0,
    sprints,
  };
}
