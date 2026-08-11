import { executeAgentTool } from '../agent/tools';
import { getStore } from '../store';
import type { Roadmap, RoadmapItem, SprintItem, Suggestion, SuggestionKind } from '../types';
import { roadmapSpan, validateDatesWithin, validateMilestoneDate } from '../validate';

/**
 * Suggestion engine (agent-links design): agents file proposed changes whose
 * payloads use the same shapes as the human PATCH/POST bodies —
 *
 *   create_item   → ItemInput fields incl. initiativeId  (targetId null)
 *   update_item   → partial ItemInput patch              (targetId = item id)
 *   delete_item   → {}                                   (targetId = item id)
 *   create_sprint → SprintInput fields + itemId          (targetId null; the
 *                   parent rides in the payload because the human route
 *                   carries it in the URL path)
 *   update_sprint → partial SprintInput patch            (targetId = sprint id)
 *   comment       → { text? } — the rationale carries the substance
 *
 * validateSuggestion enforces the same rules as the human routes but never
 * writes; applySuggestion replays an accepted payload through the store (via
 * executeAgentTool, which re-validates on its own).
 */

export const SUGGESTION_KINDS: SuggestionKind[] = [
  'create_item',
  'update_item',
  'delete_item',
  'create_sprint',
  'update_sprint',
  'comment',
];

async function targetItem(roadmap: Roadmap, id: string | null): Promise<RoadmapItem | null> {
  if (!id) return null;
  const item = await getStore().getItem(id);
  return item && item.roadmapId === roadmap.id ? item : null;
}

async function targetSprint(
  roadmap: Roadmap,
  id: string | null,
): Promise<{ sprint: SprintItem; item: RoadmapItem } | null> {
  if (!id) return null;
  const sprint = await getStore().getSprint(id);
  if (!sprint) return null;
  const item = await getStore().getItem(sprint.roadmapItemId);
  return item && item.roadmapId === roadmap.id ? { sprint, item } : null;
}

/** Validate a suggestion at filing time. null = valid, string = error message. */
export async function validateSuggestion(
  roadmap: Roadmap,
  kind: SuggestionKind,
  targetId: string | null,
  payload: Record<string, unknown>,
): Promise<string | null> {
  const span = roadmapSpan(roadmap);
  switch (kind) {
    case 'comment':
      return null;
    case 'create_item': {
      const initiative = await getStore().getInitiative(String(payload.initiativeId ?? ''));
      if (!initiative || initiative.roadmapId !== roadmap.id) {
        return 'initiativeId must be an initiative on this roadmap';
      }
      if (!String(payload.title ?? '').trim()) return 'title is required';
      const dateErr = validateDatesWithin(
        payload.startDate,
        payload.endDate,
        span.start,
        span.end,
        'the roadmap date range',
      );
      if (dateErr) return dateErr.message;
      const msErr = validateMilestoneDate(
        (payload.milestoneDate as string) ?? null,
        payload.startDate as string,
        payload.endDate as string,
      );
      return msErr ? msErr.message : null;
    }
    case 'update_item': {
      const item = await targetItem(roadmap, targetId);
      if (!item) return 'target item not found on this roadmap';
      if (payload.title !== undefined && !String(payload.title).trim()) {
        return 'title cannot be empty';
      }
      const startDate = (payload.startDate as string) ?? item.startDate;
      const endDate = (payload.endDate as string) ?? item.endDate;
      const dateErr = validateDatesWithin(
        startDate,
        endDate,
        span.start,
        span.end,
        'the roadmap date range',
      );
      if (dateErr) return dateErr.message;
      const milestoneDate =
        payload.milestoneDate === undefined
          ? item.milestoneDate
          : (payload.milestoneDate as string | null);
      const msErr = validateMilestoneDate(milestoneDate, startDate, endDate);
      return msErr ? msErr.message : null;
    }
    case 'delete_item':
      return (await targetItem(roadmap, targetId)) ? null : 'target item not found on this roadmap';
    case 'create_sprint': {
      const item = await targetItem(roadmap, String(payload.itemId ?? ''));
      if (!item) return 'itemId must be an item on this roadmap';
      if (!String(payload.name ?? '').trim()) return 'name is required';
      const dateErr = validateDatesWithin(
        payload.startDate,
        payload.endDate,
        item.startDate,
        item.endDate,
        `the parent item "${item.title}" (${item.startDate} → ${item.endDate})`,
      );
      return dateErr ? dateErr.message : null;
    }
    case 'update_sprint': {
      const t = await targetSprint(roadmap, targetId);
      if (!t) return 'target sprint not found on this roadmap';
      if (payload.name !== undefined && !String(payload.name).trim()) {
        return 'name cannot be empty';
      }
      const startDate = (payload.startDate as string) ?? t.sprint.startDate;
      const endDate = (payload.endDate as string) ?? t.sprint.endDate;
      const dateErr = validateDatesWithin(
        startDate,
        endDate,
        t.item.startDate,
        t.item.endDate,
        `the parent item "${t.item.title}" (${t.item.startDate} → ${t.item.endDate})`,
      );
      return dateErr ? dateErr.message : null;
    }
  }
}

/** Replay an accepted suggestion through the store. Re-validates first: the
 *  roadmap may have changed since filing (targets deleted, dates shifted). */
export async function applySuggestion(
  roadmap: Roadmap,
  s: Suggestion,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const invalid = await validateSuggestion(roadmap, s.kind, s.targetId, s.payload);
  if (invalid) return { ok: false, reason: invalid };
  switch (s.kind) {
    case 'comment':
      return { ok: true };
    case 'create_item': {
      const out = await executeAgentTool(roadmap, 'create_item', s.payload);
      return out.isError ? { ok: false, reason: out.result } : { ok: true };
    }
    case 'update_item': {
      const out = await executeAgentTool(roadmap, 'update_item', {
        ...s.payload,
        itemId: s.targetId,
      });
      return out.isError ? { ok: false, reason: out.result } : { ok: true };
    }
    case 'delete_item': {
      const item = await targetItem(roadmap, s.targetId);
      if (!item) return { ok: false, reason: 'target item not found' };
      await getStore().deleteItem(item.id);
      return { ok: true };
    }
    case 'create_sprint': {
      const out = await executeAgentTool(roadmap, 'create_sprint', s.payload);
      return out.isError ? { ok: false, reason: out.result } : { ok: true };
    }
    case 'update_sprint': {
      const out = await executeAgentTool(roadmap, 'update_sprint', {
        ...s.payload,
        sprintId: s.targetId,
      });
      return out.isError ? { ok: false, reason: out.result } : { ok: true };
    }
  }
}

/** Human-readable one-liner for the review panel,
 *  e.g. `Update "API beta": endDate 2026-09-15 → 2026-10-01`. */
export async function describeSuggestion(s: Suggestion): Promise<string> {
  const store = getStore();
  const fields = (payload: Record<string, unknown>, current?: Record<string, unknown>) =>
    Object.entries(payload)
      .filter(([k]) => !['itemId', 'initiativeId'].includes(k))
      .map(([k, v]) =>
        current && current[k] !== undefined ? `${k} ${current[k]} → ${v}` : `${k}: ${v}`,
      )
      .join(', ');
  switch (s.kind) {
    case 'create_item':
      return `Add item "${s.payload.title}" (${s.payload.startDate} → ${s.payload.endDate})`;
    case 'update_item': {
      const item = s.targetId ? await store.getItem(s.targetId) : null;
      return item
        ? `Update "${item.title}": ${fields(s.payload, item as unknown as Record<string, unknown>)}`
        : `Update deleted item: ${fields(s.payload)}`;
    }
    case 'delete_item': {
      const item = s.targetId ? await store.getItem(s.targetId) : null;
      return `Delete item "${item?.title ?? '(already deleted)'}"`;
    }
    case 'create_sprint': {
      const item = await store.getItem(String(s.payload.itemId ?? ''));
      return `Add sprint "${s.payload.name}" under "${item?.title ?? '?'}" (${s.payload.startDate} → ${s.payload.endDate})`;
    }
    case 'update_sprint': {
      const sprint = s.targetId ? await store.getSprint(s.targetId) : null;
      return sprint
        ? `Update sprint "${sprint.name}": ${fields(s.payload, sprint as unknown as Record<string, unknown>)}`
        : 'Update deleted sprint';
    }
    case 'comment':
      return String(s.payload.text ?? s.rationale);
  }
}
