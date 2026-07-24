import { randomUUID } from 'crypto';
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
  userState: Map<string, UserState>;
  inviteTokens: Map<string, string>; // roadmapId → token
}

function emptyDb(): Db {
  return {
    roadmaps: new Map(),
    initiatives: new Map(),
    items: new Map(),
    sprints: new Map(),
    shares: new Map(),
    userState: new Map(),
    inviteTokens: new Map(),
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
      position: existing.length ? existing[existing.length - 1].position + 1 : 1,
      createdAt: now(),
    };
    this.db.initiatives.set(initiative.id, initiative);
    return initiative;
  }

  async updateInitiative(id: string, patch: Partial<Pick<Initiative, 'name' | 'position'>>) {
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

  async createItem(roadmapId: string, input: ItemInput, colorIndex: number) {
    const item: RoadmapItem = {
      id: randomUUID(),
      roadmapId,
      initiativeId: input.initiativeId,
      title: input.title,
      description: input.description ?? '',
      startDate: input.startDate,
      endDate: input.endDate,
      milestoneText: input.milestoneText ?? '',
      milestoneDate: input.milestoneDate ?? null,
      okrs: input.okrs ?? '',
      dris: input.dris ?? '',
      status: input.status ?? 'green',
      kpi: input.kpi ?? '',
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

  async createSprint(roadmapItemId: string, input: SprintInput) {
    const sprint: SprintItem = {
      id: randomUUID(),
      roadmapItemId,
      name: input.name,
      description: input.description ?? '',
      startDate: input.startDate,
      endDate: input.endDate,
      milestoneText: input.milestoneText ?? '',
      milestoneDate: input.milestoneDate ?? null,
      kpi: input.kpi ?? '',
      dri: input.dri ?? '',
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
      updatedAt: now(),
    };
    this.db.sprints.set(id, updated);
    return updated;
  }

  async deleteSprint(id: string) {
    this.db.sprints.delete(id);
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
      createdAt: now(),
    };
    this.db.shares.set(share.id, share);
    return share;
  }

  async addUidShare(roadmapId: string, memberUid: string, memberName: string) {
    const share: RoadmapShare = {
      id: randomUUID(),
      roadmapId,
      email: null,
      memberUid,
      memberName,
      createdAt: now(),
    };
    this.db.shares.set(share.id, share);
    return share;
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

  async getInviteToken(roadmapId: string) {
    return this.db.inviteTokens.get(roadmapId) ?? null;
  }

  async setInviteToken(roadmapId: string, token: string | null) {
    if (token === null) this.db.inviteTokens.delete(roadmapId);
    else this.db.inviteTokens.set(roadmapId, token);
  }

  async findRoadmapByInviteToken(token: string) {
    for (const [roadmapId, t] of this.db.inviteTokens) {
      if (t === token) return this.db.roadmaps.get(roadmapId) ?? null;
    }
    return null;
  }
}
