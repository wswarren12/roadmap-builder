import type {
  AgentActivityEntry,
  AgentLink,
  AgentRole,
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
  Suggestion,
  SuggestionKind,
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
    patch: Partial<Pick<Initiative, 'name' | 'description' | 'position'>>,
  ): Promise<Initiative>;
  deleteInitiative(id: string): Promise<void>;

  // roadmap items
  listItems(roadmapId: string): Promise<RoadmapItem[]>;
  getItem(id: string): Promise<RoadmapItem | null>;
  countItems(roadmapId: string): Promise<number>;
  countItemsInInitiative(initiativeId: string): Promise<number>;
  createItem(
    roadmapId: string,
    input: ItemInput,
    colorIndex: number,
    syncGroupId?: string | null,
  ): Promise<RoadmapItem>;
  updateItem(id: string, patch: Partial<ItemInput>): Promise<RoadmapItem>;
  deleteItem(id: string): Promise<void>;
  // cross-roadmap sync groups (F-15b)
  setItemSyncGroup(id: string, syncGroupId: string): Promise<void>;
  listItemsBySyncGroup(syncGroupId: string): Promise<RoadmapItem[]>;

  // sprint items
  listSprints(roadmapItemId: string): Promise<SprintItem[]>;
  getSprint(id: string): Promise<SprintItem | null>;
  countSprints(roadmapItemId: string): Promise<number>;
  /** Batch count sprints for multiple items in one query. */
  countSprintsForItems(itemIds: string[]): Promise<Record<string, number>>;
  createSprint(
    roadmapItemId: string,
    input: SprintInput,
    syncGroupId?: string | null,
  ): Promise<SprintItem>;
  updateSprint(id: string, patch: Partial<SprintInput>): Promise<SprintItem>;
  deleteSprint(id: string): Promise<void>;
  setSprintSyncGroup(id: string, syncGroupId: string): Promise<void>;
  listSprintsBySyncGroup(syncGroupId: string): Promise<SprintItem[]>;

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

  // agent links (agent-links design 2026-08-05)
  createAgentLink(
    roadmapId: string,
    name: string,
    role: AgentRole,
    token: string,
  ): Promise<AgentLink>;
  listAgentLinks(roadmapId: string): Promise<AgentLink[]>;
  getAgentLink(id: string): Promise<AgentLink | null>;
  /** Returns revoked rows too — the caller checks revokedAt (404 either way). */
  findAgentLinkByToken(token: string): Promise<AgentLink | null>;
  revokeAgentLink(id: string): Promise<void>;
  touchAgentLink(id: string): Promise<void>;

  // suggestions (agent-proposed changes; newest first from the list methods)
  createSuggestion(input: {
    roadmapId: string;
    agentLinkId: string;
    kind: SuggestionKind;
    targetId: string | null;
    payload: Record<string, unknown>;
    rationale: string;
  }): Promise<Suggestion>;
  listSuggestions(roadmapId: string): Promise<Suggestion[]>;
  listSuggestionsByLink(agentLinkId: string): Promise<Suggestion[]>;
  getSuggestion(id: string): Promise<Suggestion | null>;
  resolveSuggestion(
    id: string,
    status: 'accepted' | 'rejected',
    resolvedBy: string,
  ): Promise<Suggestion>;
  countPendingSuggestions(agentLinkId: string): Promise<number>;

  // agent activity (append-only; newest first, never contains tokens)
  logAgentActivity(entry: {
    agentLinkId: string;
    roadmapId: string;
    action: string;
    detail: Record<string, unknown>;
  }): Promise<void>;
  listAgentActivity(agentLinkId: string, limit: number): Promise<AgentActivityEntry[]>;
}
