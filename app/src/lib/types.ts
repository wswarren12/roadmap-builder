// All dates are ISO strings: months as 'YYYY-MM-01', days as 'YYYY-MM-DD'.

export type ItemStatus = 'green' | 'yellow' | 'red';

export interface Identity {
  uid: string;
  name: string;
  /** LabOS-verified email, lowercase. May be null — the v1.4 member-context
   *  API does not expose email; sharing falls back gracefully (see README). */
  email: string | null;
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

/**
 * A viewer grant. Exactly one identity field set is populated:
 * - memberUid/memberName — claimed via invite link (primary mechanism; the
 *   v1.4 member context has no email, so uid is the reliable identifier)
 * - email — legacy whitelist path, dormant until LabOS exposes member email
 */
export interface RoadmapShare {
  id: string;
  roadmapId: string;
  email: string | null;
  memberUid: string | null;
  memberName: string | null;
  createdAt: string;
}

export interface UserState {
  userUid: string;
  lastRoadmapId: string | null;
  lastVisitedAt: string;
}

export type Role = 'owner' | 'viewer' | 'none';

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
