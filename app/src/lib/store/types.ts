import type {
  Initiative,
  ItemInput,
  Roadmap,
  RoadmapInput,
  RoadmapItem,
  RoadmapShare,
  SprintInput,
  SprintItem,
  UserState,
} from '../types';

/**
 * Repository interface. Two implementations: SupabaseStore (production —
 * service-role key, server-side only) and MemoryStore (local dev + tests).
 * Authorization is NOT enforced here; the API layer owns it (PRD §9).
 */
export interface Store {
  // user state
  getUserState(uid: string): Promise<UserState | null>;
  setLastRoadmap(uid: string, roadmapId: string | null): Promise<void>;

  // roadmaps
  createRoadmap(
    owner: { uid: string; email: string | null },
    input: RoadmapInput,
  ): Promise<Roadmap>;
  getRoadmap(id: string): Promise<Roadmap | null>;
  updateRoadmap(
    id: string,
    patch: Partial<Pick<Roadmap, 'title' | 'description' | 'startMonth' | 'endMonth'>>,
  ): Promise<Roadmap>;
  deleteRoadmap(id: string): Promise<void>;
  listRoadmapsOwned(uid: string): Promise<Roadmap[]>;
  listRoadmapsSharedWith(email: string): Promise<Roadmap[]>;

  // initiatives
  listInitiatives(roadmapId: string): Promise<Initiative[]>;
  getInitiative(id: string): Promise<Initiative | null>;
  createInitiative(roadmapId: string, name: string): Promise<Initiative>;
  updateInitiative(
    id: string,
    patch: Partial<Pick<Initiative, 'name' | 'position'>>,
  ): Promise<Initiative>;
  deleteInitiative(id: string): Promise<void>;

  // roadmap items
  listItems(roadmapId: string): Promise<RoadmapItem[]>;
  getItem(id: string): Promise<RoadmapItem | null>;
  countItems(roadmapId: string): Promise<number>;
  countItemsInInitiative(initiativeId: string): Promise<number>;
  createItem(roadmapId: string, input: ItemInput, colorIndex: number): Promise<RoadmapItem>;
  updateItem(id: string, patch: Partial<ItemInput>): Promise<RoadmapItem>;
  deleteItem(id: string): Promise<void>;

  // sprint items
  listSprints(roadmapItemId: string): Promise<SprintItem[]>;
  getSprint(id: string): Promise<SprintItem | null>;
  countSprints(roadmapItemId: string): Promise<number>;
  createSprint(roadmapItemId: string, input: SprintInput): Promise<SprintItem>;
  updateSprint(id: string, patch: Partial<SprintInput>): Promise<SprintItem>;
  deleteSprint(id: string): Promise<void>;

  // shares
  listShares(roadmapId: string): Promise<RoadmapShare[]>;
  getShare(id: string): Promise<RoadmapShare | null>;
  addShare(roadmapId: string, email: string): Promise<RoadmapShare>;
  addUidShare(roadmapId: string, memberUid: string, memberName: string): Promise<RoadmapShare>;
  listRoadmapsSharedWithUid(memberUid: string): Promise<Roadmap[]>;
  removeShare(id: string): Promise<void>;

  // invite links (one active token per roadmap; null = disabled)
  getInviteToken(roadmapId: string): Promise<string | null>;
  setInviteToken(roadmapId: string, token: string | null): Promise<void>;
  findRoadmapByInviteToken(token: string): Promise<Roadmap | null>;
}
