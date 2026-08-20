import { randomUUID } from 'crypto';
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
import type { Store } from './types';

function now(): string {
  return new Date().toISOString();
}

interface Db {
  roadmaps: Map<string, Roadmap>;
  initiatives: Map<string, Initiative>;
  items: Map<string, RoadmapItem>;
  sprints: Map<string, SprintItem>;
  shares: Map<string, RoadmapShare>;
  teamMembers: Map<string, TeamMember>;
  userState: Map<string, UserState>;
  inviteTokens: Map<string, InviteTokens>; // roadmapId → per-role tokens
  agentLinks: Map<string, AgentLink>;
  suggestions: Map<string, Suggestion>;
  // Array, not a Map sorted by timestamp: two logs can land in the same ms,
  // and insertion order is the ground truth for "newest first".
  agentActivity: AgentActivityEntry[];
}

function emptyDb(): Db {
  return {
    roadmaps: new Map(),
    initiatives: new Map(),
    items: new Map(),
    sprints: new Map(),
    shares: new Map(),
    teamMembers: new Map(),
    userState: new Map(),
    inviteTokens: new Map(),
    agentLinks: new Map(),
    suggestions: new Map(),
    agentActivity: [],
  };
}

export class MemoryStore implements Store {
  private db: Db;

  constructor(db?: Db) {
    this.db = db ?? emptyDb();
  }

  reset() {
    this.db = emptyDb();
  }

  async getUserState(uid: string) {
    return this.db.userState.get(uid) ?? null;
  }

  async setLastRoadmap(uid: string, roadmapId: string | null) {
    this.db.userState.set(uid, {
      userUid: uid,
      lastRoadmapId: roadmapId,
      lastVisitedAt: now(),
    });
  }

  async createRoadmap(
    owner: { uid: string; email: string | null },
    input: RoadmapInput,
  ): Promise<Roadmap> {
    const roadmap: Roadmap = {
      id: randomUUID(),
      ownerUid: owner.uid,
      ownerEmail: (owner.email ?? '').toLowerCase(),
      title: input.title,
      description: input.description ?? '',
      startMonth: input.startMonth,
      endMonth: input.endMonth,
      palette: input.palette ?? 'pl',
      createdAt: now(),
      updatedAt: now(),
    };
    this.db.roadmaps.set(roadmap.id, roadmap);
    return roadmap;
  }

  async getRoadmap(id: string) {
    return this.db.roadmaps.get(id) ?? null;
  }

  async updateRoadmap(
    id: string,
    patch: Partial<Pick<Roadmap, 'title' | 'description' | 'startMonth' | 'endMonth'>>,
  ) {
    const r = this.db.roadmaps.get(id);
    if (!r) throw new Error('roadmap not found');
    const updated = { ...r, ...patch, updatedAt: now() };
    this.db.roadmaps.set(id, updated);
    return updated;
  }

  async deleteRoadmap(id: string) {
    this.db.roadmaps.delete(id);
    for (const [iid, ini] of this.db.initiatives) {
      if (ini.roadmapId === id) this.db.initiatives.delete(iid);
    }
    for (const [itemId, item] of this.db.items) {
      if (item.roadmapId === id) {
        this.db.items.delete(itemId);
        for (const [sid, s] of this.db.sprints) {
          if (s.roadmapItemId === itemId) this.db.sprints.delete(sid);
        }
      }
    }
    for (const [shid, sh] of this.db.shares) {
      if (sh.roadmapId === id) this.db.shares.delete(shid);
    }
    for (const [tmid, tm] of this.db.teamMembers) {
      if (tm.roadmapId === id) this.db.teamMembers.delete(tmid);
    }
    for (const [alid, al] of this.db.agentLinks) {
      if (al.roadmapId === id) this.db.agentLinks.delete(alid);
    }
    for (const [sgid, sg] of this.db.suggestions) {
      if (sg.roadmapId === id) this.db.suggestions.delete(sgid);
    }
    this.db.agentActivity = this.db.agentActivity.filter((a) => a.roadmapId !== id);
    this.db.inviteTokens.delete(id);
    for (const [uid, st] of this.db.userState) {
      if (st.lastRoadmapId === id) {
        this.db.userState.set(uid, { ...st, lastRoadmapId: null });
      }
    }
  }

  async listRoadmapsOwned(uid: string) {
    return [...this.db.roadmaps.values()]
      .filter((r) => r.ownerUid === uid)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async listRoadmapsSharedWith(email: string) {
    const target = email.toLowerCase();
    const ids = new Set(
      [...this.db.shares.values()]
        .filter((s) => s.email === target)
        .map((s) => s.roadmapId),
    );
    return [...this.db.roadmaps.values()]
      .filter((r) => ids.has(r.id))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async listInitiatives(roadmapId: string) {
    return [...this.db.initiatives.values()]
      .filter((i) => i.roadmapId === roadmapId)
      .sort((a, b) => a.position - b.position);
  }

  async getInitiative(id: string) {
    return this.db.initiatives.get(id) ?? null;
  }

  async createInitiative(roadmapId: string, name: string) {
    const existing = await this.listInitiatives(roadmapId);
    const initiative: Initiative = {
      id: randomUUID(),
      roadmapId,
      name,
      description: '',
      position: existing.length ? existing[existing.length - 1].position + 1 : 1,
      createdAt: now(),
    };
    this.db.initiatives.set(initiative.id, initiative);
    return initiative;
  }

  async updateInitiative(
    id: string,
    patch: Partial<Pick<Initiative, 'name' | 'description' | 'position'>>,
  ) {
    const i = this.db.initiatives.get(id);
    if (!i) throw new Error('initiative not found');
    const updated = { ...i, ...patch };
    this.db.initiatives.set(id, updated);
    return updated;
  }

  async deleteInitiative(id: string) {
    this.db.initiatives.delete(id);
  }

  async listItems(roadmapId: string) {
    return [...this.db.items.values()]
      .filter((i) => i.roadmapId === roadmapId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async getItem(id: string) {
    return this.db.items.get(id) ?? null;
  }

  async countItems(roadmapId: string) {
    return (await this.listItems(roadmapId)).length;
  }

  async countItemsInInitiative(initiativeId: string) {
    return [...this.db.items.values()].filter((i) => i.initiativeId === initiativeId).length;
  }

  async createItem(
    roadmapId: string,
    input: ItemInput,
    colorIndex: number,
    syncGroupId: string | null = null,
  ) {
    const item: RoadmapItem = {
      id: randomUUID(),
      roadmapId,
      syncGroupId,
      initiativeId: input.initiativeId,
      title: input.title,
      description: input.description ?? '',
      startDate: input.startDate,
      endDate: input.endDate,
      milestoneText: input.milestoneText ?? '',
      milestoneDate: input.milestoneDate ?? null,
      okrs: input.okrs ?? '',
      dris: input.dris ?? '',
      responsibleTeam: input.responsibleTeam ?? '',
      status: input.status ?? 'green',
      kpi: input.kpi ?? '',
      completedAt: input.completedAt ?? null,
      colorIndex,
      createdAt: now(),
      updatedAt: now(),
    };
    this.db.items.set(item.id, item);
    return item;
  }

  async updateItem(id: string, patch: Partial<ItemInput>) {
    const i = this.db.items.get(id);
    if (!i) throw new Error('item not found');
    const updated: RoadmapItem = {
      ...i,
      ...patch,
      milestoneDate:
        patch.milestoneDate === undefined ? i.milestoneDate : patch.milestoneDate,
      completedAt:
        patch.completedAt === undefined ? i.completedAt : patch.completedAt,
      updatedAt: now(),
    };
    this.db.items.set(id, updated);
    return updated;
  }

  async deleteItem(id: string) {
    this.db.items.delete(id);
    for (const [sid, s] of this.db.sprints) {
      if (s.roadmapItemId === id) this.db.sprints.delete(sid);
    }
  }

  async setItemSyncGroup(id: string, syncGroupId: string) {
    const i = this.db.items.get(id);
    if (!i) throw new Error('item not found');
    this.db.items.set(id, { ...i, syncGroupId });
  }

  async listItemsBySyncGroup(syncGroupId: string) {
    return [...this.db.items.values()]
      .filter((i) => i.syncGroupId === syncGroupId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async listSprints(roadmapItemId: string) {
    return [...this.db.sprints.values()]
      .filter((s) => s.roadmapItemId === roadmapItemId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async getSprint(id: string) {
    return this.db.sprints.get(id) ?? null;
  }

  async countSprints(roadmapItemId: string) {
    return (await this.listSprints(roadmapItemId)).length;
  }

  async createSprint(
    roadmapItemId: string,
    input: SprintInput,
    syncGroupId: string | null = null,
  ) {
    const sprint: SprintItem = {
      id: randomUUID(),
      roadmapItemId,
      syncGroupId,
      name: input.name,
      description: input.description ?? '',
      startDate: input.startDate,
      endDate: input.endDate,
      milestoneText: input.milestoneText ?? '',
      milestoneDate: input.milestoneDate ?? null,
      kpi: input.kpi ?? '',
      dri: input.dri ?? '',
      completedAt: input.completedAt ?? null,
      createdAt: now(),
      updatedAt: now(),
    };
    this.db.sprints.set(sprint.id, sprint);
    return sprint;
  }

  async updateSprint(id: string, patch: Partial<SprintInput>) {
    const s = this.db.sprints.get(id);
    if (!s) throw new Error('sprint not found');
    const updated: SprintItem = {
      ...s,
      ...patch,
      milestoneDate:
        patch.milestoneDate === undefined ? s.milestoneDate : patch.milestoneDate,
      completedAt:
        patch.completedAt === undefined ? s.completedAt : patch.completedAt,
      updatedAt: now(),
    };
    this.db.sprints.set(id, updated);
    return updated;
  }

  async deleteSprint(id: string) {
    this.db.sprints.delete(id);
  }

  async setSprintSyncGroup(id: string, syncGroupId: string) {
    const s = this.db.sprints.get(id);
    if (!s) throw new Error('sprint not found');
    this.db.sprints.set(id, { ...s, syncGroupId });
  }

  async listSprintsBySyncGroup(syncGroupId: string) {
    return [...this.db.sprints.values()]
      .filter((s) => s.syncGroupId === syncGroupId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async listShares(roadmapId: string) {
    return [...this.db.shares.values()]
      .filter((s) => s.roadmapId === roadmapId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async getShare(id: string) {
    return this.db.shares.get(id) ?? null;
  }

  async addShare(roadmapId: string, email: string) {
    const share: RoadmapShare = {
      id: randomUUID(),
      roadmapId,
      email: email.toLowerCase(),
      memberUid: null,
      memberName: null,
      role: 'viewer',
      createdAt: now(),
    };
    this.db.shares.set(share.id, share);
    return share;
  }

  async addUidShare(roadmapId: string, memberUid: string, memberName: string, role: ShareRole) {
    const share: RoadmapShare = {
      id: randomUUID(),
      roadmapId,
      email: null,
      memberUid,
      memberName,
      role,
      createdAt: now(),
    };
    this.db.shares.set(share.id, share);
    return share;
  }

  async setShareRole(id: string, role: ShareRole) {
    const share = this.db.shares.get(id);
    if (!share) throw new Error('share not found');
    this.db.shares.set(id, { ...share, role });
  }

  async listRoadmapsSharedWithUid(memberUid: string) {
    const ids = new Set(
      [...this.db.shares.values()]
        .filter((s) => s.memberUid === memberUid)
        .map((s) => s.roadmapId),
    );
    return [...this.db.roadmaps.values()]
      .filter((r) => ids.has(r.id))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async removeShare(id: string) {
    this.db.shares.delete(id);
  }

  async listTeamMembers(roadmapId: string) {
    return [...this.db.teamMembers.values()]
      .filter((m) => m.roadmapId === roadmapId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.name.localeCompare(b.name));
  }

  async getTeamMember(id: string) {
    return this.db.teamMembers.get(id) ?? null;
  }

  async addTeamMember(
    roadmapId: string,
    input: { name: string; memberUid?: string | null; image?: string | null },
  ) {
    const member: TeamMember = {
      id: randomUUID(),
      roadmapId,
      memberUid: input.memberUid ?? null,
      name: input.name,
      image: input.image ?? null,
      createdAt: now(),
    };
    this.db.teamMembers.set(member.id, member);
    return member;
  }

  async updateTeamMember(id: string, patch: Partial<Pick<TeamMember, 'name' | 'image'>>) {
    const m = this.db.teamMembers.get(id);
    if (!m) throw new Error('team member not found');
    const updated = { ...m, ...patch };
    this.db.teamMembers.set(id, updated);
    return updated;
  }

  async removeTeamMember(id: string) {
    this.db.teamMembers.delete(id);
  }

  async getInviteTokens(roadmapId: string): Promise<InviteTokens> {
    const tokens = this.db.inviteTokens.get(roadmapId);
    return { editor: tokens?.editor ?? null, viewer: tokens?.viewer ?? null };
  }

  async setInviteToken(roadmapId: string, role: ShareRole, token: string | null) {
    const tokens = await this.getInviteTokens(roadmapId);
    this.db.inviteTokens.set(roadmapId, { ...tokens, [role]: token });
  }

  async findRoadmapByInviteToken(token: string) {
    for (const [roadmapId, tokens] of this.db.inviteTokens) {
      const role: ShareRole | null =
        tokens.editor === token ? 'editor' : tokens.viewer === token ? 'viewer' : null;
      if (role) {
        const roadmap = this.db.roadmaps.get(roadmapId);
        return roadmap ? { roadmap, role } : null;
      }
    }
    return null;
  }

  async createAgentLink(roadmapId: string, name: string, role: AgentRole, token: string) {
    const link: AgentLink = {
      id: randomUUID(),
      roadmapId,
      token,
      name,
      role,
      createdAt: now(),
      lastUsedAt: null,
      revokedAt: null,
    };
    this.db.agentLinks.set(link.id, link);
    return link;
  }

  async listAgentLinks(roadmapId: string) {
    return [...this.db.agentLinks.values()]
      .filter((l) => l.roadmapId === roadmapId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async getAgentLink(id: string) {
    return this.db.agentLinks.get(id) ?? null;
  }

  async findAgentLinkByToken(token: string) {
    return [...this.db.agentLinks.values()].find((l) => l.token === token) ?? null;
  }

  async revokeAgentLink(id: string) {
    const l = this.db.agentLinks.get(id);
    if (!l) throw new Error('agent link not found');
    this.db.agentLinks.set(id, { ...l, revokedAt: now() });
  }

  async touchAgentLink(id: string) {
    const l = this.db.agentLinks.get(id);
    if (!l) throw new Error('agent link not found');
    this.db.agentLinks.set(id, { ...l, lastUsedAt: now() });
  }

  async createSuggestion(input: {
    roadmapId: string;
    agentLinkId: string;
    kind: SuggestionKind;
    targetId: string | null;
    payload: Record<string, unknown>;
    rationale: string;
  }) {
    const s: Suggestion = {
      id: randomUUID(),
      ...input,
      status: 'pending',
      resolvedBy: null,
      resolvedAt: null,
      createdAt: now(),
    };
    this.db.suggestions.set(s.id, s);
    return s;
  }

  async listSuggestions(roadmapId: string) {
    return [...this.db.suggestions.values()]
      .filter((s) => s.roadmapId === roadmapId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async listSuggestionsByLink(agentLinkId: string) {
    return [...this.db.suggestions.values()]
      .filter((s) => s.agentLinkId === agentLinkId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getSuggestion(id: string) {
    return this.db.suggestions.get(id) ?? null;
  }

  async resolveSuggestion(id: string, status: 'accepted' | 'rejected', resolvedBy: string) {
    const s = this.db.suggestions.get(id);
    if (!s) throw new Error('suggestion not found');
    const resolved: Suggestion = { ...s, status, resolvedBy, resolvedAt: now() };
    this.db.suggestions.set(id, resolved);
    return resolved;
  }

  async countPendingSuggestions(agentLinkId: string) {
    return [...this.db.suggestions.values()].filter(
      (s) => s.agentLinkId === agentLinkId && s.status === 'pending',
    ).length;
  }

  async logAgentActivity(entry: {
    agentLinkId: string;
    roadmapId: string;
    action: string;
    detail: Record<string, unknown>;
  }) {
    this.db.agentActivity.push({ id: randomUUID(), ...entry, createdAt: now() });
  }

  async listAgentActivity(agentLinkId: string, limit: number) {
    return this.db.agentActivity
      .filter((a) => a.agentLinkId === agentLinkId)
      .slice(-limit)
      .reverse();
  }
}
