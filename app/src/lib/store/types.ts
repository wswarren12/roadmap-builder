import type {
  Initiative,
  InviteTokens,
  ItemInput,
  Roadmap,
  RoadmapInput,
  RoadmapItem,
  RoadmapShare,
  ShareRole,
  SprintInput,
  SprintItem,
  TeamMember,
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
  addUidShare(
    roadmapId: string,
    memberUid: string,
    memberName: string,
    role: ShareRole,
  ): Promise<RoadmapShare>;
  setShareRole(id: string, role: ShareRole): Promise<void>;
  listRoadmapsSharedWithUid(memberUid: string): Promise<Roadmap[]>;
  removeShare(id: string): Promise<void>;

  // team roster (F-13)
  listTeamMembers(roadmapId: string): Promise<TeamMember[]>;
  getTeamMember(id: string): Promise<TeamMember | null>;
  addTeamMember(
    roadmapId: string,
    input: { name: string; memberUid?: string | null; image?: string | null },
  ): Promise<TeamMember>;
  updateTeamMember(
    id: string,
    patch: Partial<Pick<TeamMember, 'name' | 'image'>>,
  ): Promise<TeamMember>;
  removeTeamMember(id: string): Promise<void>;

  // invite links (one active token per roadmap per role; null = disabled)
  getInviteTokens(roadmapId: string): Promise<InviteTokens>;
  setInviteToken(roadmapId: string, role: ShareRole, token: string | null): Promise<void>;
  findRoadmapByInviteToken(
    token: string,
  ): Promise<{ roadmap: Roadmap; role: ShareRole } | null>;
}
