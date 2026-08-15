import { randomUUID } from 'crypto';
import { getStore } from './store';
import type { ItemInput, RoadmapItem, SprintInput, SprintItem } from './types';

/**
 * Cross-roadmap sync (F-15b). Items imported from another roadmap share a
 * sync_group_id; these wrappers perform the primary write and then propagate
 * it to every other row in the group. They sit between the API/agent layers
 * and the store so both Memory and Supabase get identical semantics:
 *
 * - item content edits propagate; per-roadmap placement (initiativeId,
 *   colorIndex) never does — each copy keeps its own row position.
 * - sprints of linked items are linked too (their own group): create,
 *   update, and delete all propagate. Sprints are item content.
 * - deleting an item copy is local (other roadmaps keep theirs).
 *
 * Dates propagate verbatim. Import validates the initial fit against the
 * target roadmap's range; later edits are validated against the roadmap the
 * edit was made on (same trust model as a human editor on that roadmap).
 *
 * AUTHORIZATION MODEL: these wrappers propagate without re-checking the
 * caller's role on sibling roadmaps. That is safe ONLY because creating a
 * link requires WRITE on both roadmaps (see the import route): every sync
 * group therefore spans roadmaps whose write-holders explicitly opted into
 * shared editing, like a co-owned document embedded in two workspaces. Any
 * new way of creating links MUST keep that invariant, or these wrappers
 * become a privilege-escalation channel (read-on-source → write-on-source).
 */

/** Content fields that mirror across copies — everything except placement. */
const SYNCED_ITEM_FIELDS = [
  'title',
  'description',
  'startDate',
  'endDate',
  'milestoneText',
  'milestoneDate',
  'okrs',
  'dris',
  'responsibleTeam',
  'status',
  'kpi',
] as const;

function syncedItemPatch(patch: Partial<ItemInput>): Partial<ItemInput> {
  const out: Partial<ItemInput> = {};
  for (const key of SYNCED_ITEM_FIELDS) {
    if (patch[key] !== undefined) (out as Record<string, unknown>)[key] = patch[key];
  }
  return out;
}

/** Update an item and mirror the content fields to its linked copies. */
export async function updateItemSynced(
  id: string,
  patch: Partial<ItemInput>,
): Promise<RoadmapItem> {
  const store = getStore();
  const updated = await store.updateItem(id, patch);
  if (updated.syncGroupId) {
    const mirror = syncedItemPatch(patch);
    if (Object.keys(mirror).length > 0) {
      const siblings = await store.listItemsBySyncGroup(updated.syncGroupId);
      for (const sib of siblings) {
        if (sib.id !== id) await store.updateItem(sib.id, mirror);
      }
    }
  }
  return updated;
}

/** Create a sprint; when the parent item is linked, create the same sprint
 *  under every copy, all sharing a fresh sprint sync group. */
export async function createSprintSynced(
  item: RoadmapItem,
  input: SprintInput,
): Promise<SprintItem> {
  const store = getStore();
  if (!item.syncGroupId) return store.createSprint(item.id, input);
  const sprintGroup = randomUUID();
  const created = await store.createSprint(item.id, input, sprintGroup);
  const siblings = await store.listItemsBySyncGroup(item.syncGroupId);
  for (const sib of siblings) {
    if (sib.id !== item.id) await store.createSprint(sib.id, input, sprintGroup);
  }
  return created;
}

/** Update a sprint and mirror it to its linked copies (all fields). */
export async function updateSprintSynced(
  id: string,
  patch: Partial<SprintInput>,
): Promise<SprintItem> {
  const store = getStore();
  const updated = await store.updateSprint(id, patch);
  if (updated.syncGroupId) {
    const siblings = await store.listSprintsBySyncGroup(updated.syncGroupId);
    for (const sib of siblings) {
      if (sib.id !== id) await store.updateSprint(sib.id, patch);
    }
  }
  return updated;
}

/** Delete a sprint from every linked copy — sprints are item content. */
export async function deleteSprintSynced(sprint: SprintItem): Promise<void> {
  const store = getStore();
  if (sprint.syncGroupId) {
    const siblings = await store.listSprintsBySyncGroup(sprint.syncGroupId);
    for (const sib of siblings) {
      if (sib.id !== sprint.id) await store.deleteSprint(sib.id);
    }
  }
  await store.deleteSprint(sprint.id);
}

/**
 * Import `source` (with its sprints) into `roadmapId`/`initiativeId` as a
 * linked copy. Ensures the source (and each of its sprints) carries a group
 * id first, then clones. Caller validates access and date fit.
 */
export async function importItemLinked(
  source: RoadmapItem,
  roadmapId: string,
  initiativeId: string,
  colorIndex: number,
): Promise<RoadmapItem> {
  const store = getStore();
  let groupId = source.syncGroupId;
  if (!groupId) {
    groupId = randomUUID();
    await store.setItemSyncGroup(source.id, groupId);
  }
  const copy = await store.createItem(
    roadmapId,
    {
      initiativeId,
      title: source.title,
      description: source.description,
      startDate: source.startDate,
      endDate: source.endDate,
      milestoneText: source.milestoneText,
      milestoneDate: source.milestoneDate,
      okrs: source.okrs,
      dris: source.dris,
      responsibleTeam: source.responsibleTeam,
      status: source.status,
      kpi: source.kpi,
    },
    colorIndex,
    groupId,
  );
  for (const sprint of await store.listSprints(source.id)) {
    let sprintGroup = sprint.syncGroupId;
    if (!sprintGroup) {
      sprintGroup = randomUUID();
      await store.setSprintSyncGroup(sprint.id, sprintGroup);
    }
    await store.createSprint(
      copy.id,
      {
        name: sprint.name,
        description: sprint.description,
        startDate: sprint.startDate,
        endDate: sprint.endDate,
        milestoneText: sprint.milestoneText,
        milestoneDate: sprint.milestoneDate,
        kpi: sprint.kpi,
        dri: sprint.dri,
      },
      sprintGroup,
    );
  }
  return copy;
}
