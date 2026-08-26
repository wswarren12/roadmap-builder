// All dates are ISO strings: months as 'YYYY-MM-01', days as 'YYYY-MM-DD'.

export type ItemStatus = 'green' | 'yellow' | 'red';

export interface Identity {
  uid: string;
  name: string;
  /** LabOS-verified email, lowercase. May be null — the v1.4 member-context
   *  API does not expose email; sharing falls back gracefully (see README). */
  email: string | null;
  /** LabOS profile image URL, when the member context provides one (F-13). */
  image?: string | null;
}

export interface Roadmap {
  id: string;
  ownerUid: string;
  ownerEmail: string;
  title: string;
  description: string;
  startMonth: string;
  endMonth: string;
  /** Color palette id (see lib/colors PALETTES). Chosen at creation. */
  palette: string;
  createdAt: string;
  updatedAt: string;
}

export interface Initiative {
  id: string;
  roadmapId: string;
  name: string;
  /** Short theme blurb shown under the name in the row label. */
  description: string;
  position: number;
  createdAt: string;
}

export interface RoadmapItem {
  id: string;
  roadmapId: string;
  initiativeId: string;
  title: string;
  description: string;
  startDate: string;
  endDate: string;
  milestoneText: string;
  milestoneDate: string | null;
  okrs: string;
  dris: string;
  responsibleTeam: string;
  status: ItemStatus;
  kpi: string;
  /** Completion date (YYYY-MM-DD); non-null renders the bar in the
   *  palette's green "completed" color. */
  completedAt: string | null;
  colorIndex: number;
  /** Cross-roadmap link (F-15b): rows sharing a group are the same item
   *  imported into several roadmaps; content edits propagate group-wide. */
  syncGroupId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SprintItem {
  id: string;
  roadmapItemId: string;
  name: string;
  description: string;
  startDate: string;
  endDate: string;
  milestoneText: string;
  milestoneDate: string | null;
  kpi: string;
  dri: string;
  /** Completion date (YYYY-MM-DD); non-null renders the bar green. */
  completedAt: string | null;
  /** Linked-sprint group across imported item copies (F-15b). */
  syncGroupId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A sprint snapshot with normalized positions and no absolute dates. */
export interface BacklogSprint {
  name: string;
  description: string;
  startPosition: number;
  endPosition: number;
  milestoneText: string;
  milestonePosition: number | null;
  kpi: string;
  dri: string;
}

/** Private, roadmap-agnostic work owned by one authenticated LabOS UID. */
export interface BacklogItem {
  id: string;
  ownerUid: string;
  title: string;
  description: string;
  milestoneText: string;
  milestonePosition: number | null;
  okrs: string;
  dris: string;
  responsibleTeam: string;
  status: ItemStatus;
  kpi: string;
  colorIndex: number;
  sprints: BacklogSprint[];
  createdAt: string;
  updatedAt: string;
}

export type BacklogItemInput = Pick<
  BacklogItem,
  | 'title'
  | 'description'
  | 'milestoneText'
  | 'okrs'
  | 'dris'
  | 'responsibleTeam'
  | 'status'
  | 'kpi'
  | 'colorIndex'
>;

export interface BacklogImportTarget {
  roadmapId: string;
  initiativeId: string;
  startDate: string;
  endDate: string;
  colorIndex: number;
}

/** The role an invite link (and the share it creates) grants. */
export type ShareRole = 'editor' | 'viewer';

/** Per-roadmap invite tokens, one independent link per grantable role. */
export interface InviteTokens {
  editor: string | null;
  viewer: string | null;
}

/**
 * An access grant. Exactly one identity field set is populated:
 * - memberUid/memberName — claimed via invite link (primary mechanism; the
 *   v1.4 member context has no email, so uid is the reliable identifier)
 * - email — legacy whitelist path, dormant until LabOS exposes member email
 * `role` is what the grant allows: viewers read, editors also change content.
 */
export interface RoadmapShare {
  id: string;
  roadmapId: string;
  email: string | null;
  memberUid: string | null;
  memberName: string | null;
  role: ShareRole;
  createdAt: string;
}

/**
 * A person on the roadmap's team roster (F-13). LabOS members carry their
 * member uid (and profile image once captured from their own member context);
 * manually added people have neither and render an initials avatar.
 */
export interface TeamMember {
  id: string;
  roadmapId: string;
  memberUid: string | null;
  name: string;
  image: string | null;
  createdAt: string;
}

/** The power an agent link grants (agent-links design, 2026-08-05). */
export type AgentRole = 'agent_viewer' | 'agent_suggester' | 'agent_editor';

/**
 * A named, revocable bearer capability: the token in /agent/<token> is the
 * whole credential. `revokedAt` null = active (soft revoke keeps history).
 */
export interface AgentLink {
  id: string;
  roadmapId: string;
  token: string;
  name: string;
  role: AgentRole;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export type SuggestionKind =
  | 'create_item'
  | 'update_item'
  | 'delete_item'
  | 'create_sprint'
  | 'update_sprint'
  | 'comment';

export type SuggestionStatus = 'pending' | 'accepted' | 'rejected';

/**
 * An agent-proposed change awaiting human review. `payload` uses the same
 * shapes as the human PATCH/POST request bodies, so "accept" replays a
 * validated body through the existing store functions. `targetId` is the
 * item/sprint being modified (null for creates/comments).
 */
export interface Suggestion {
  id: string;
  roadmapId: string;
  agentLinkId: string;
  kind: SuggestionKind;
  targetId: string | null;
  payload: Record<string, unknown>;
  rationale: string;
  status: SuggestionStatus;
  resolvedBy: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

/** Append-only audit log row for agent-link API calls. Never holds tokens. */
export interface AgentActivityEntry {
  id: string;
  agentLinkId: string;
  roadmapId: string;
  action: string;
  detail: Record<string, unknown>;
  createdAt: string;
}

export interface UserState {
  userUid: string;
  lastRoadmapId: string | null;
  lastVisitedAt: string;
}

export type Role = 'owner' | 'editor' | 'viewer' | 'none';

/** Payload shapes accepted by the API. */
export interface RoadmapInput {
  title: string;
  description?: string;
  startMonth: string;
  endMonth: string;
  palette?: string;
}

export interface ItemInput {
  initiativeId: string;
  title: string;
  description?: string;
  startDate: string;
  endDate: string;
  milestoneText?: string;
  milestoneDate?: string | null;
  okrs?: string;
  dris?: string;
  responsibleTeam?: string;
  status?: ItemStatus;
  kpi?: string;
  completedAt?: string | null;
  /** Palette hue index chosen by the user (0..palette length-1). */
  colorIndex?: number;
}

export interface SprintInput {
  name: string;
  description?: string;
  startDate: string;
  endDate: string;
  milestoneText?: string;
  milestoneDate?: string | null;
  kpi?: string;
  dri?: string;
  completedAt?: string | null;
}
