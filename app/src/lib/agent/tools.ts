import type Anthropic from '@anthropic-ai/sdk';
import { ITEM_PALETTE } from '../colors';
import { getStore } from '../store';
import type { ItemStatus, Roadmap } from '../types';
import {
  MAX_INITIATIVES,
  roadmapSpan,
  validateDatesWithin,
  validateMilestoneDate,
} from '../validate';

/**
 * The agent's write surface (F-14). Deliberately narrower than the REST API:
 * create/update only — no deletes — and every input is re-validated with the
 * same rules the API routes enforce, so the model can never write invalid
 * state no matter what it sends.
 */

const DATE = { type: 'string' as const, description: 'ISO date YYYY-MM-DD' };

export const AGENT_TOOLS: Anthropic.Messages.ToolUnion[] = [
  {
    name: 'get_roadmap',
    description:
      'Read the current roadmap state: initiatives, items (with dates, status, DRIs), sprint items, and the team roster. Call this before creating or moving anything, and again after your changes if you need to verify.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'create_initiative',
    description:
      'Add a new initiative (swimlane row) to the roadmap. Use only when the work fits no existing initiative.',
    input_schema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'Short initiative name' } },
      required: ['name'],
      additionalProperties: false,
    },
  },
  {
    name: 'create_item',
    description:
      'Add a roadmap item (multi-week bar) to an initiative. Dates must fall inside the roadmap range.',
    input_schema: {
      type: 'object',
      properties: {
        initiativeId: { type: 'string' },
        title: { type: 'string' },
        startDate: DATE,
        endDate: DATE,
        description: { type: 'string' },
        dris: { type: 'string', description: 'Comma-separated DRI names' },
        status: { type: 'string', enum: ['green', 'yellow', 'red'] },
        okrs: { type: 'string' },
        kpi: { type: 'string' },
        milestoneText: { type: 'string' },
        milestoneDate: { ...DATE, description: 'Optional milestone date within the item dates' },
      },
      required: ['initiativeId', 'title', 'startDate', 'endDate'],
      additionalProperties: false,
    },
  },
  {
    name: 'update_item',
    description:
      'Update an existing roadmap item: re-date it (sequencing), move it to another initiative, retitle it, or change status/DRIs. Only pass the fields you are changing.',
    input_schema: {
      type: 'object',
      properties: {
        itemId: { type: 'string' },
        initiativeId: { type: 'string' },
        title: { type: 'string' },
        startDate: DATE,
        endDate: DATE,
        description: { type: 'string' },
        dris: { type: 'string' },
        status: { type: 'string', enum: ['green', 'yellow', 'red'] },
        okrs: { type: 'string' },
        kpi: { type: 'string' },
        milestoneText: { type: 'string' },
        milestoneDate: DATE,
      },
      required: ['itemId'],
      additionalProperties: false,
    },
  },
  {
    name: 'create_sprint',
    description:
      'Add a sprint item (1–2 week execution slice) under a roadmap item. Dates must fall inside the parent item dates.',
    input_schema: {
      type: 'object',
      properties: {
        itemId: { type: 'string' },
        name: { type: 'string' },
        startDate: DATE,
        endDate: DATE,
        description: { type: 'string' },
        dri: { type: 'string' },
        kpi: { type: 'string' },
        milestoneText: { type: 'string' },
        milestoneDate: DATE,
      },
      required: ['itemId', 'name', 'startDate', 'endDate'],
      additionalProperties: false,
    },
  },
  {
    name: 'update_sprint',
    description:
      'Update an existing sprint item (re-date, rename, change DRI). Only pass the fields you are changing.',
    input_schema: {
      type: 'object',
      properties: {
        sprintId: { type: 'string' },
        name: { type: 'string' },
        startDate: DATE,
        endDate: DATE,
        description: { type: 'string' },
        dri: { type: 'string' },
        kpi: { type: 'string' },
        milestoneText: { type: 'string' },
        milestoneDate: DATE,
      },
      required: ['sprintId'],
      additionalProperties: false,
    },
  },
  // Anthropic server-side web search — competitive feature-gap research.
  { type: 'web_search_20260209', name: 'web_search' },
];

export interface AgentAction {
  tool: string;
  summary: string;
}

/** Compact JSON snapshot of the roadmap, fed to the model as context. */
export async function roadmapSnapshot(roadmap: Roadmap): Promise<string> {
  const store = getStore();
  const [initiatives, items, team] = await Promise.all([
    store.listInitiatives(roadmap.id),
    store.listItems(roadmap.id),
    store.listTeamMembers(roadmap.id),
  ]);
  const itemsWithSprints = await Promise.all(
    items.map(async (i) => ({
      id: i.id,
      initiativeId: i.initiativeId,
      title: i.title,
      startDate: i.startDate,
      endDate: i.endDate,
      status: i.status,
      dris: i.dris,
      sprints: (await store.listSprints(i.id)).map((s) => ({
        id: s.id,
        name: s.name,
        startDate: s.startDate,
        endDate: s.endDate,
        dri: s.dri,
      })),
    })),
  );
  return JSON.stringify({
    roadmap: {
      title: roadmap.title,
      description: roadmap.description,
      startMonth: roadmap.startMonth,
      endMonth: roadmap.endMonth,
    },
    initiatives: initiatives.map((i) => ({ id: i.id, name: i.name, position: i.position })),
    items: itemsWithSprints,
    team: team.map((m) => m.name),
  });
}

const STATUSES: ItemStatus[] = ['green', 'yellow', 'red'];

function err(message: string): ToolOutcome {
  return { result: `Error: ${message}`, isError: true };
}

export interface ToolOutcome {
  result: string;
  isError?: boolean;
  action?: AgentAction;
}

/** Execute one agent tool call against the store, with full validation. */
export async function executeAgentTool(
  roadmap: Roadmap,
  name: string,
  input: Record<string, unknown>,
): Promise<ToolOutcome> {
  const store = getStore();
  const span = roadmapSpan(roadmap);

  switch (name) {
    case 'get_roadmap': {
      return { result: await roadmapSnapshot(roadmap) };
    }

    case 'create_initiative': {
      const initiativeName = String(input.name ?? '').trim();
      if (!initiativeName) return err('name is required');
      const existing = await store.listInitiatives(roadmap.id);
      if (existing.length >= MAX_INITIATIVES) {
        return err(`This roadmap already has the maximum of ${MAX_INITIATIVES} initiatives`);
      }
      const initiative = await store.createInitiative(roadmap.id, initiativeName);
      return {
        result: JSON.stringify({ id: initiative.id, name: initiative.name }),
        action: { tool: name, summary: `Added initiative "${initiative.name}"` },
      };
    }

    case 'create_item': {
      const initiative = await store.getInitiative(String(input.initiativeId ?? ''));
      if (!initiative || initiative.roadmapId !== roadmap.id) {
        return err('initiativeId must be an initiative on this roadmap');
      }
      const title = String(input.title ?? '').trim();
      if (!title) return err('title is required');
      const dateErr = validateDatesWithin(
        input.startDate,
        input.endDate,
        span.start,
        span.end,
        'the roadmap date range',
      );
      if (dateErr) return err(dateErr.message);
      const msErr = validateMilestoneDate(
        (input.milestoneDate as string) ?? null,
        input.startDate as string,
        input.endDate as string,
      );
      if (msErr) return err(msErr.message);
      const colorIndex = (await store.countItems(roadmap.id)) % ITEM_PALETTE.length;
      const item = await store.createItem(
        roadmap.id,
        {
          initiativeId: initiative.id,
          title,
          description: String(input.description ?? ''),
          startDate: input.startDate as string,
          endDate: input.endDate as string,
          milestoneText: String(input.milestoneText ?? ''),
          milestoneDate: (input.milestoneDate as string) || null,
          okrs: String(input.okrs ?? ''),
          dris: String(input.dris ?? ''),
          status: STATUSES.includes(input.status as ItemStatus)
            ? (input.status as ItemStatus)
            : 'green',
          kpi: String(input.kpi ?? ''),
        },
        colorIndex,
      );
      return {
        result: JSON.stringify({ id: item.id, title: item.title }),
        action: {
          tool: name,
          summary: `Added item "${item.title}" (${item.startDate} → ${item.endDate}) to "${initiative.name}"`,
        },
      };
    }

    case 'update_item': {
      const item = await store.getItem(String(input.itemId ?? ''));
      if (!item || item.roadmapId !== roadmap.id) {
        return err('itemId must be an item on this roadmap');
      }
      const patch: Record<string, unknown> = {};
      if (input.initiativeId !== undefined) {
        const initiative = await store.getInitiative(String(input.initiativeId));
        if (!initiative || initiative.roadmapId !== roadmap.id) {
          return err('initiativeId must be an initiative on this roadmap');
        }
        patch.initiativeId = initiative.id;
      }
      if (input.title !== undefined) {
        const title = String(input.title).trim();
        if (!title) return err('title cannot be empty');
        patch.title = title;
      }
      const startDate = (input.startDate as string) ?? item.startDate;
      const endDate = (input.endDate as string) ?? item.endDate;
      const dateErr = validateDatesWithin(
        startDate,
        endDate,
        span.start,
        span.end,
        'the roadmap date range',
      );
      if (dateErr) return err(dateErr.message);
      if (input.startDate !== undefined) patch.startDate = startDate;
      if (input.endDate !== undefined) patch.endDate = endDate;
      const milestoneDate =
        input.milestoneDate === undefined ? item.milestoneDate : (input.milestoneDate as string);
      const msErr = validateMilestoneDate(milestoneDate, startDate, endDate);
      if (msErr) return err(msErr.message);
      if (input.milestoneDate !== undefined) patch.milestoneDate = milestoneDate || null;
      if (input.status !== undefined) {
        if (!STATUSES.includes(input.status as ItemStatus)) {
          return err('status must be green, yellow, or red');
        }
        patch.status = input.status;
      }
      for (const key of ['description', 'dris', 'okrs', 'kpi', 'milestoneText'] as const) {
        if (input[key] !== undefined) patch[key] = String(input[key] ?? '');
      }
      const updated = await store.updateItem(item.id, patch);
      return {
        result: JSON.stringify({ id: updated.id, title: updated.title }),
        action: { tool: name, summary: `Updated item "${updated.title}"` },
      };
    }

    case 'create_sprint': {
      const item = await store.getItem(String(input.itemId ?? ''));
      if (!item || item.roadmapId !== roadmap.id) {
        return err('itemId must be an item on this roadmap');
      }
      const sprintName = String(input.name ?? '').trim();
      if (!sprintName) return err('name is required');
      const dateErr = validateDatesWithin(
        input.startDate,
        input.endDate,
        item.startDate,
        item.endDate,
        `the parent item "${item.title}" (${item.startDate} → ${item.endDate})`,
      );
      if (dateErr) return err(dateErr.message);
      const msErr = validateMilestoneDate(
        (input.milestoneDate as string) ?? null,
        input.startDate as string,
        input.endDate as string,
      );
      if (msErr) return err(msErr.message);
      const sprint = await store.createSprint(item.id, {
        name: sprintName,
        description: String(input.description ?? ''),
        startDate: input.startDate as string,
        endDate: input.endDate as string,
        milestoneText: String(input.milestoneText ?? ''),
        milestoneDate: (input.milestoneDate as string) || null,
        kpi: String(input.kpi ?? ''),
        dri: String(input.dri ?? ''),
      });
      return {
        result: JSON.stringify({ id: sprint.id, name: sprint.name }),
        action: {
          tool: name,
          summary: `Added sprint "${sprint.name}" under "${item.title}"`,
        },
      };
    }

    case 'update_sprint': {
      const sprint = await store.getSprint(String(input.sprintId ?? ''));
      if (!sprint) return err('sprintId not found');
      const item = await store.getItem(sprint.roadmapItemId);
      if (!item || item.roadmapId !== roadmap.id) {
        return err('sprintId must be a sprint on this roadmap');
      }
      const patch: Record<string, unknown> = {};
      if (input.name !== undefined) {
        const sprintName = String(input.name).trim();
        if (!sprintName) return err('name cannot be empty');
        patch.name = sprintName;
      }
      const startDate = (input.startDate as string) ?? sprint.startDate;
      const endDate = (input.endDate as string) ?? sprint.endDate;
      const dateErr = validateDatesWithin(
        startDate,
        endDate,
        item.startDate,
        item.endDate,
        `the parent item "${item.title}" (${item.startDate} → ${item.endDate})`,
      );
      if (dateErr) return err(dateErr.message);
      if (input.startDate !== undefined) patch.startDate = startDate;
      if (input.endDate !== undefined) patch.endDate = endDate;
      for (const key of ['description', 'dri', 'kpi', 'milestoneText'] as const) {
        if (input[key] !== undefined) patch[key] = String(input[key] ?? '');
      }
      const updated = await store.updateSprint(sprint.id, patch);
      return {
        result: JSON.stringify({ id: updated.id, name: updated.name }),
        action: { tool: name, summary: `Updated sprint "${updated.name}"` },
      };
    }

    default:
      return err(`Unknown tool: ${name}`);
  }
}
