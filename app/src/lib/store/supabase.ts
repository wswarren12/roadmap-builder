import { createClient, type SupabaseClient } from '@supabase/supabase-js';
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

// Row mappers: Postgres snake_case → app camelCase.

function mapRoadmap(r: any): Roadmap {
  return {
    id: r.id,
    ownerUid: r.owner_uid,
    ownerEmail: r.owner_email,
    title: r.title,
    description: r.description ?? '',
    startMonth: r.start_month,
    endMonth: r.end_month,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapInitiative(r: any): Initiative {
  return {
    id: r.id,
    roadmapId: r.roadmap_id,
    name: r.name,
    position: r.position,
    createdAt: r.created_at,
  };
}

function mapItem(r: any): RoadmapItem {
  return {
    id: r.id,
    roadmapId: r.roadmap_id,
    initiativeId: r.initiative_id,
    title: r.title,
    description: r.description ?? '',
    startDate: r.start_date,
    endDate: r.end_date,
    milestoneText: r.milestone_text ?? '',
    milestoneDate: r.milestone_date,
    okrs: r.okrs ?? '',
    dris: r.dris ?? '',
    status: r.status,
    kpi: r.kpi ?? '',
    colorIndex: r.color_index,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapSprint(r: any): SprintItem {
  return {
    id: r.id,
    roadmapItemId: r.roadmap_item_id,
    name: r.name,
    description: r.description ?? '',
    startDate: r.start_date,
    endDate: r.end_date,
    milestoneText: r.milestone_text ?? '',
    milestoneDate: r.milestone_date,
    kpi: r.kpi ?? '',
    dri: r.dri ?? '',
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapTeamMember(r: any): TeamMember {
  return {
    id: r.id,
    roadmapId: r.roadmap_id,
    memberUid: r.member_uid,
    name: r.name,
    image: r.image,
    createdAt: r.created_at,
  };
}

function mapAgentLink(r: any): AgentLink {
  return {
    id: r.id,
    roadmapId: r.roadmap_id,
    token: r.token,
    name: r.name,
    role: r.role,
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at,
    revokedAt: r.revoked_at,
  };
}

function mapSuggestion(r: any): Suggestion {
  return {
    id: r.id,
    roadmapId: r.roadmap_id,
    agentLinkId: r.agent_link_id,
    kind: r.kind,
    targetId: r.target_id,
    payload: r.payload ?? {},
    rationale: r.rationale ?? '',
    status: r.status,
    resolvedBy: r.resolved_by,
    resolvedAt: r.resolved_at,
    createdAt: r.created_at,
  };
}

function mapAgentActivity(r: any): AgentActivityEntry {
  return {
    id: r.id,
    agentLinkId: r.agent_link_id,
    roadmapId: r.roadmap_id,
    action: r.action,
    detail: r.detail ?? {},
    createdAt: r.created_at,
  };
}

function mapShare(r: any): RoadmapShare {
  return {
    id: r.id,
    roadmapId: r.roadmap_id,
    email: r.email,
    memberUid: r.member_uid,
    memberName: r.member_name,
    role: r.role === 'editor' ? 'editor' : 'viewer',
    createdAt: r.created_at,
  };
}

// Which roadmaps column stores each role's invite token (004_editor_invites).
const TOKEN_COLUMN: Record<ShareRole, string> = {
  viewer: 'invite_token',
  editor: 'editor_invite_token',
};

function itemPatch(patch: Partial<ItemInput>) {
  const row: Record<string, unknown> = {};
  if (patch.initiativeId !== undefined) row.initiative_id = patch.initiativeId;
  if (patch.title !== undefined) row.title = patch.title;
  if (patch.description !== undefined) row.description = patch.description;
  if (patch.startDate !== undefined) row.start_date = patch.startDate;
  if (patch.endDate !== undefined) row.end_date = patch.endDate;
  if (patch.milestoneText !== undefined) row.milestone_text = patch.milestoneText;
  if (patch.milestoneDate !== undefined) row.milestone_date = patch.milestoneDate;
  if (patch.okrs !== undefined) row.okrs = patch.okrs;
  if (patch.dris !== undefined) row.dris = patch.dris;
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.kpi !== undefined) row.kpi = patch.kpi;
  row.updated_at = new Date().toISOString();
  return row;
}

function sprintPatch(patch: Partial<SprintInput>) {
  const row: Record<string, unknown> = {};
  if (patch.name !== undefined) row.name = patch.name;
  if (patch.description !== undefined) row.description = patch.description;
  if (patch.startDate !== undefined) row.start_date = patch.startDate;
  if (patch.endDate !== undefined) row.end_date = patch.endDate;
  if (patch.milestoneText !== undefined) row.milestone_text = patch.milestoneText;
  if (patch.milestoneDate !== undefined) row.milestone_date = patch.milestoneDate;
  if (patch.kpi !== undefined) row.kpi = patch.kpi;
  if (patch.dri !== undefined) row.dri = patch.dri;
  row.updated_at = new Date().toISOString();
  return row;
}

function unwrap<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  if (res.data === null) throw new Error('not found');
  return res.data;
}

export class SupabaseStore implements Store {
  private sb: SupabaseClient;

  constructor(url: string, serviceRoleKey: string) {
    // Service-role key: server-side only, bypasses RLS by design (PRD §9).
    this.sb = createClient(url, serviceRoleKey, {
      auth: { persistSession: false },
    });
  }

  async getUserState(uid: string): Promise<UserState | null> {
    const { data, error } = await this.sb
      .from('user_state')
      .select('*')
      .eq('user_uid', uid)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    return {
      userUid: data.user_uid,
      lastRoadmapId: data.last_roadmap_id,
      lastVisitedAt: data.last_visited_at,
    };
  }

  async setLastRoadmap(uid: string, roadmapId: string | null) {
    const { error } = await this.sb.from('user_state').upsert({
      user_uid: uid,
      last_roadmap_id: roadmapId,
      last_visited_at: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);
  }

  async createRoadmap(owner: { uid: string; email: string | null }, input: RoadmapInput) {
    const res = await this.sb
      .from('roadmaps')
      .insert({
        owner_uid: owner.uid,
        owner_email: (owner.email ?? '').toLowerCase(),
        title: input.title,
        description: input.description ?? '',
        start_month: input.startMonth,
        end_month: input.endMonth,
      })
      .select()
      .single();
    return mapRoadmap(unwrap(res));
  }

  async getRoadmap(id: string) {
    const { data, error } = await this.sb.from('roadmaps').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? mapRoadmap(data) : null;
  }

  async updateRoadmap(id: string, patch: Partial<Pick<Roadmap, 'title' | 'description' | 'startMonth' | 'endMonth'>>) {
    const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.title !== undefined) row.title = patch.title;
    if (patch.description !== undefined) row.description = patch.description;
    if (patch.startMonth !== undefined) row.start_month = patch.startMonth;
    if (patch.endMonth !== undefined) row.end_month = patch.endMonth;
    const res = await this.sb.from('roadmaps').update(row).eq('id', id).select().single();
    return mapRoadmap(unwrap(res));
  }

  async deleteRoadmap(id: string) {
    const { error } = await this.sb.from('roadmaps').delete().eq('id', id);
    if (error) throw new Error(error.message);
  }

  async listRoadmapsOwned(uid: string) {
    const { data, error } = await this.sb
      .from('roadmaps')
      .select('*')
      .eq('owner_uid', uid)
      .order('updated_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map(mapRoadmap);
  }

  async listRoadmapsSharedWith(email: string) {
    const { data, error } = await this.sb
      .from('roadmap_shares')
      .select('roadmaps(*)')
      .eq('email', email.toLowerCase());
    if (error) throw new Error(error.message);
    return (data ?? [])
      .map((row: any) => row.roadmaps)
      .filter(Boolean)
      .map(mapRoadmap);
  }

  async listInitiatives(roadmapId: string) {
    const { data, error } = await this.sb
      .from('initiatives')
      .select('*')
      .eq('roadmap_id', roadmapId)
      .order('position');
    if (error) throw new Error(error.message);
    return (data ?? []).map(mapInitiative);
  }

  async getInitiative(id: string) {
    const { data, error } = await this.sb.from('initiatives').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? mapInitiative(data) : null;
  }

  async createInitiative(roadmapId: string, name: string) {
    const existing = await this.listInitiatives(roadmapId);
    const position = existing.length ? existing[existing.length - 1].position + 1 : 1;
    const res = await this.sb
      .from('initiatives')
      .insert({ roadmap_id: roadmapId, name, position })
      .select()
      .single();
    return mapInitiative(unwrap(res));
  }

  async updateInitiative(id: string, patch: Partial<Pick<Initiative, 'name' | 'position'>>) {
    const res = await this.sb.from('initiatives').update(patch).eq('id', id).select().single();
    return mapInitiative(unwrap(res));
  }

  async deleteInitiative(id: string) {
    const { error } = await this.sb.from('initiatives').delete().eq('id', id);
    if (error) throw new Error(error.message);
  }

  async listItems(roadmapId: string) {
    const { data, error } = await this.sb
      .from('roadmap_items')
      .select('*')
      .eq('roadmap_id', roadmapId)
      .order('created_at');
    if (error) throw new Error(error.message);
    return (data ?? []).map(mapItem);
  }

  async getItem(id: string) {
    const { data, error } = await this.sb.from('roadmap_items').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? mapItem(data) : null;
  }

  async countItems(roadmapId: string) {
    const { count, error } = await this.sb
      .from('roadmap_items')
      .select('*', { count: 'exact', head: true })
      .eq('roadmap_id', roadmapId);
    if (error) throw new Error(error.message);
    return count ?? 0;
  }

  async countItemsInInitiative(initiativeId: string) {
    const { count, error } = await this.sb
      .from('roadmap_items')
      .select('*', { count: 'exact', head: true })
      .eq('initiative_id', initiativeId);
    if (error) throw new Error(error.message);
    return count ?? 0;
  }

  async createItem(roadmapId: string, input: ItemInput, colorIndex: number) {
    const res = await this.sb
      .from('roadmap_items')
      .insert({
        roadmap_id: roadmapId,
        initiative_id: input.initiativeId,
        title: input.title,
        description: input.description ?? '',
        start_date: input.startDate,
        end_date: input.endDate,
        milestone_text: input.milestoneText ?? '',
        milestone_date: input.milestoneDate ?? null,
        okrs: input.okrs ?? '',
        dris: input.dris ?? '',
        status: input.status ?? 'green',
        kpi: input.kpi ?? '',
        color_index: colorIndex,
      })
      .select()
      .single();
    return mapItem(unwrap(res));
  }

  async updateItem(id: string, patch: Partial<ItemInput>) {
    const res = await this.sb
      .from('roadmap_items')
      .update(itemPatch(patch))
      .eq('id', id)
      .select()
      .single();
    return mapItem(unwrap(res));
  }

  async deleteItem(id: string) {
    const { error } = await this.sb.from('roadmap_items').delete().eq('id', id);
    if (error) throw new Error(error.message);
  }

  async listSprints(roadmapItemId: string) {
    const { data, error } = await this.sb
      .from('sprint_items')
      .select('*')
      .eq('roadmap_item_id', roadmapItemId)
      .order('created_at');
    if (error) throw new Error(error.message);
    return (data ?? []).map(mapSprint);
  }

  async getSprint(id: string) {
    const { data, error } = await this.sb.from('sprint_items').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? mapSprint(data) : null;
  }

  async countSprints(roadmapItemId: string) {
    const { count, error } = await this.sb
      .from('sprint_items')
      .select('*', { count: 'exact', head: true })
      .eq('roadmap_item_id', roadmapItemId);
    if (error) throw new Error(error.message);
    return count ?? 0;
  }

  async createSprint(roadmapItemId: string, input: SprintInput) {
    const res = await this.sb
      .from('sprint_items')
      .insert({
        roadmap_item_id: roadmapItemId,
        name: input.name,
        description: input.description ?? '',
        start_date: input.startDate,
        end_date: input.endDate,
        milestone_text: input.milestoneText ?? '',
        milestone_date: input.milestoneDate ?? null,
        kpi: input.kpi ?? '',
        dri: input.dri ?? '',
      })
      .select()
      .single();
    return mapSprint(unwrap(res));
  }

  async updateSprint(id: string, patch: Partial<SprintInput>) {
    const res = await this.sb
      .from('sprint_items')
      .update(sprintPatch(patch))
      .eq('id', id)
      .select()
      .single();
    return mapSprint(unwrap(res));
  }

  async deleteSprint(id: string) {
    const { error } = await this.sb.from('sprint_items').delete().eq('id', id);
    if (error) throw new Error(error.message);
  }

  async listShares(roadmapId: string) {
    const { data, error } = await this.sb
      .from('roadmap_shares')
      .select('*')
      .eq('roadmap_id', roadmapId)
      .order('created_at');
    if (error) throw new Error(error.message);
    return (data ?? []).map(mapShare);
  }

  async getShare(id: string) {
    const { data, error } = await this.sb.from('roadmap_shares').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? mapShare(data) : null;
  }

  async addShare(roadmapId: string, email: string) {
    const res = await this.sb
      .from('roadmap_shares')
      .insert({ roadmap_id: roadmapId, email: email.toLowerCase() })
      .select()
      .single();
    return mapShare(unwrap(res));
  }

  async addUidShare(roadmapId: string, memberUid: string, memberName: string, role: ShareRole) {
    const res = await this.sb
      .from('roadmap_shares')
      .insert({ roadmap_id: roadmapId, member_uid: memberUid, member_name: memberName, role })
      .select()
      .single();
    return mapShare(unwrap(res));
  }

  async setShareRole(id: string, role: ShareRole) {
    const { error } = await this.sb.from('roadmap_shares').update({ role }).eq('id', id);
    if (error) throw new Error(error.message);
  }

  async listRoadmapsSharedWithUid(memberUid: string) {
    const { data, error } = await this.sb
      .from('roadmap_shares')
      .select('roadmaps(*)')
      .eq('member_uid', memberUid);
    if (error) throw new Error(error.message);
    return (data ?? [])
      .map((row: any) => row.roadmaps)
      .filter(Boolean)
      .map(mapRoadmap);
  }

  async removeShare(id: string) {
    const { error } = await this.sb.from('roadmap_shares').delete().eq('id', id);
    if (error) throw new Error(error.message);
  }

  async listTeamMembers(roadmapId: string) {
    const { data, error } = await this.sb
      .from('roadmap_team_members')
      .select('*')
      .eq('roadmap_id', roadmapId)
      .order('created_at');
    if (error) throw new Error(error.message);
    return (data ?? []).map(mapTeamMember);
  }

  async getTeamMember(id: string) {
    const { data, error } = await this.sb
      .from('roadmap_team_members')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? mapTeamMember(data) : null;
  }

  async addTeamMember(
    roadmapId: string,
    input: { name: string; memberUid?: string | null; image?: string | null },
  ) {
    const res = await this.sb
      .from('roadmap_team_members')
      .insert({
        roadmap_id: roadmapId,
        member_uid: input.memberUid ?? null,
        name: input.name,
        image: input.image ?? null,
      })
      .select()
      .single();
    return mapTeamMember(unwrap(res));
  }

  async updateTeamMember(id: string, patch: Partial<Pick<TeamMember, 'name' | 'image'>>) {
    const row: Record<string, unknown> = {};
    if (patch.name !== undefined) row.name = patch.name;
    if (patch.image !== undefined) row.image = patch.image;
    const res = await this.sb
      .from('roadmap_team_members')
      .update(row)
      .eq('id', id)
      .select()
      .single();
    return mapTeamMember(unwrap(res));
  }

  async removeTeamMember(id: string) {
    const { error } = await this.sb.from('roadmap_team_members').delete().eq('id', id);
    if (error) throw new Error(error.message);
  }

  async getInviteTokens(roadmapId: string): Promise<InviteTokens> {
    const { data, error } = await this.sb
      .from('roadmaps')
      .select('invite_token, editor_invite_token')
      .eq('id', roadmapId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return {
      editor: data?.editor_invite_token ?? null,
      viewer: data?.invite_token ?? null,
    };
  }

  async setInviteToken(roadmapId: string, role: ShareRole, token: string | null) {
    const { error } = await this.sb
      .from('roadmaps')
      .update({ [TOKEN_COLUMN[role]]: token })
      .eq('id', roadmapId);
    if (error) throw new Error(error.message);
  }

  async findRoadmapByInviteToken(token: string) {
    for (const role of ['viewer', 'editor'] as ShareRole[]) {
      const { data, error } = await this.sb
        .from('roadmaps')
        .select('*')
        .eq(TOKEN_COLUMN[role], token)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (data) return { roadmap: mapRoadmap(data), role };
    }
    return null;
  }

  async createAgentLink(roadmapId: string, name: string, role: AgentRole, token: string) {
    const res = await this.sb
      .from('agent_links')
      .insert({ roadmap_id: roadmapId, token, name, role })
      .select()
      .single();
    return mapAgentLink(unwrap(res));
  }

  async listAgentLinks(roadmapId: string) {
    const { data, error } = await this.sb
      .from('agent_links')
      .select('*')
      .eq('roadmap_id', roadmapId)
      .order('created_at');
    if (error) throw new Error(error.message);
    return (data ?? []).map(mapAgentLink);
  }

  async getAgentLink(id: string) {
    const { data, error } = await this.sb.from('agent_links').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? mapAgentLink(data) : null;
  }

  async findAgentLinkByToken(token: string) {
    const { data, error } = await this.sb
      .from('agent_links')
      .select('*')
      .eq('token', token)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? mapAgentLink(data) : null;
  }

  async revokeAgentLink(id: string) {
    const { error } = await this.sb
      .from('agent_links')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw new Error(error.message);
  }

  async touchAgentLink(id: string) {
    const { error } = await this.sb
      .from('agent_links')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw new Error(error.message);
  }

  async createSuggestion(input: {
    roadmapId: string;
    agentLinkId: string;
    kind: SuggestionKind;
    targetId: string | null;
    payload: Record<string, unknown>;
    rationale: string;
  }) {
    const res = await this.sb
      .from('suggestions')
      .insert({
        roadmap_id: input.roadmapId,
        agent_link_id: input.agentLinkId,
        kind: input.kind,
        target_id: input.targetId,
        payload: input.payload,
        rationale: input.rationale,
      })
      .select()
      .single();
    return mapSuggestion(unwrap(res));
  }

  async listSuggestions(roadmapId: string) {
    const { data, error } = await this.sb
      .from('suggestions')
      .select('*')
      .eq('roadmap_id', roadmapId)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map(mapSuggestion);
  }

  async listSuggestionsByLink(agentLinkId: string) {
    const { data, error } = await this.sb
      .from('suggestions')
      .select('*')
      .eq('agent_link_id', agentLinkId)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map(mapSuggestion);
  }

  async getSuggestion(id: string) {
    const { data, error } = await this.sb.from('suggestions').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? mapSuggestion(data) : null;
  }

  async resolveSuggestion(id: string, status: 'accepted' | 'rejected', resolvedBy: string) {
    const res = await this.sb
      .from('suggestions')
      .update({ status, resolved_by: resolvedBy, resolved_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    return mapSuggestion(unwrap(res));
  }

  async countPendingSuggestions(agentLinkId: string) {
    const { count, error } = await this.sb
      .from('suggestions')
      .select('*', { count: 'exact', head: true })
      .eq('agent_link_id', agentLinkId)
      .eq('status', 'pending');
    if (error) throw new Error(error.message);
    return count ?? 0;
  }

  async logAgentActivity(entry: {
    agentLinkId: string;
    roadmapId: string;
    action: string;
    detail: Record<string, unknown>;
  }) {
    const { error } = await this.sb.from('agent_activity').insert({
      agent_link_id: entry.agentLinkId,
      roadmap_id: entry.roadmapId,
      action: entry.action,
      detail: entry.detail,
    });
    if (error) throw new Error(error.message);
  }

  async listAgentActivity(agentLinkId: string, limit: number) {
    const { data, error } = await this.sb
      .from('agent_activity')
      .select('*')
      .eq('agent_link_id', agentLinkId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw new Error(error.message);
    return (data ?? []).map(mapAgentActivity);
  }
}
