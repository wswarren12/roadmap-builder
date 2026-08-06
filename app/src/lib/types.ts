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
  createdAt: string;
  updatedAt: string;
}

export interface Initiative {
  id: string;
  roadmapId: string;
  name: string;
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
  status: ItemStatus;
  kpi: string;
  colorIndex: number;
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
  createdAt: string;
  updatedAt: string;
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
  status?: ItemStatus;
  kpi?: string;
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
}
