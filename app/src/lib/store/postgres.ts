import { readFileSync, existsSync } from 'fs';
import { Pool, types as pgTypes } from 'pg';
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

/**
 * PLN-provisioned Postgres implementation (db-migration, 2026-08-15).
 * Mirrors SupabaseStore's semantics exactly — same camelCase shapes, same
 * ordering, same null handling — so the API layer can't tell them apart.
 *
 * Two wire-format traps engineered around (wiki: patterns/pln-ai-apps):
 * - PostgREST serialized SQL DATE as 'YYYY-MM-DD' strings; node-postgres
 *   would parse OID 1082 into a local-midnight Date (day-shift off UTC).
 *   The type parser below pins DATE to plain text.
 * - TIMESTAMPTZ arrives as a JS Date; mappers normalize with .toISOString()
 *   to match the REST string shapes the app was built on.
 */
pgTypes.setTypeParser(1082, (v) => v); // DATE → keep as 'YYYY-MM-DD' string

const iso = (v: Date | string | null): string =>
  v instanceof Date ? v.toISOString() : String(v ?? '');
const isoOrNull = (v: Date | string | null): string | null =>
  v === null || v === undefined ? null : iso(v);

function mapRoadmap(r: any): Roadmap {
  return {
    id: r.id,
    ownerUid: r.owner_uid,
    ownerEmail: r.owner_email,
    title: r.title,
    description: r.description ?? '',
    startMonth: r.start_month,
    endMonth: r.end_month,
    palette: r.palette ?? 'pl',
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

function mapInitiative(r: any): Initiative {
  return {
    id: r.id,
    roadmapId: r.roadmap_id,
    name: r.name,
    description: r.description ?? '',
    position: r.position,
    createdAt: iso(r.created_at),
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
    responsibleTeam: r.responsible_team ?? '',
    status: r.status,
    kpi: r.kpi ?? '',
    completedAt: r.completed_at ?? null,
    colorIndex: r.color_index,
    syncGroupId: r.sync_group_id ?? null,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
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
    completedAt: r.completed_at ?? null,
    syncGroupId: r.sync_group_id ?? null,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
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
    createdAt: iso(r.created_at),
  };
}

function mapTeamMember(r: any): TeamMember {
  return {
    id: r.id,
    roadmapId: r.roadmap_id,
    memberUid: r.member_uid,
    name: r.name,
    image: r.image,
    createdAt: iso(r.created_at),
  };
}

function mapAgentLink(r: any): AgentLink {
  return {
    id: r.id,
    roadmapId: r.roadmap_id,
    token: r.token,
    name: r.name,
    role: r.role,
    createdAt: iso(r.created_at),
    lastUsedAt: isoOrNull(r.last_used_at),
    revokedAt: isoOrNull(r.revoked_at),
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
    resolvedAt: isoOrNull(r.resolved_at),
    createdAt: iso(r.created_at),
  };
}

function mapAgentActivity(r: any): AgentActivityEntry {
  return {
    id: r.id,
    agentLinkId: r.agent_link_id,
    roadmapId: r.roadmap_id,
    action: r.action,
    detail: r.detail ?? {},
    createdAt: iso(r.created_at),
  };
}

/**
 * TLS for the PLN-managed RDS. `pg` ignores ?sslmode= in the URL, so the ssl
 * option is set explicitly (deploy skill contract). When a CA bundle is
 * provided via PGSSLROOTCERT the connection is strictly verified; without
 * one (the platform distributes none today) it is encrypted but unverified —
 * the kit-documented setting for this managed instance. `sslmode=disable`
 * in the URL opts out entirely for local/test Postgres. The mode is fixed at
 * boot by configuration — there is deliberately no runtime downgrade path.
 */
export function sslConfig(
  connectionString: string,
): { ca?: string; rejectUnauthorized: boolean } | undefined {
  if (connectionString.includes('sslmode=disable')) return undefined;
  const caPath = process.env.PGSSLROOTCERT;
  if (caPath && existsSync(caPath)) {
    return { ca: readFileSync(caPath, 'utf8'), rejectUnauthorized: true };
  }
  return { rejectUnauthorized: false };
}

const TOKEN_COLUMN: Record<ShareRole, string> = {
  viewer: 'invite_token',
  editor: 'editor_invite_token',
};

/** patch → [set-clauses, params] starting at $offset+1. */
function buildSet(
  columns: Record<string, unknown>,
  offset = 0,
): { clause: string; params: unknown[] } {
  const keys = Object.keys(columns);
  const clause = keys.map((k, i) => `"${k}" = $${offset + i + 1}`).join(', ');
  return { clause, params: keys.map((k) => columns[k]) };
}

function itemPatchColumns(patch: Partial<ItemInput>): Record<string, unknown> {
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
  if (patch.responsibleTeam !== undefined) row.responsible_team = patch.responsibleTeam;
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.kpi !== undefined) row.kpi = patch.kpi;
  if (patch.completedAt !== undefined) row.completed_at = patch.completedAt;
  if (patch.colorIndex !== undefined) row.color_index = patch.colorIndex;
  row.updated_at = new Date().toISOString();
  return row;
}

function sprintPatchColumns(patch: Partial<SprintInput>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (patch.name !== undefined) row.name = patch.name;
  if (patch.description !== undefined) row.description = patch.description;
  if (patch.startDate !== undefined) row.start_date = patch.startDate;
  if (patch.endDate !== undefined) row.end_date = patch.endDate;
  if (patch.milestoneText !== undefined) row.milestone_text = patch.milestoneText;
  if (patch.milestoneDate !== undefined) row.milestone_date = patch.milestoneDate;
  if (patch.kpi !== undefined) row.kpi = patch.kpi;
  if (patch.dri !== undefined) row.dri = patch.dri;
  if (patch.completedAt !== undefined) row.completed_at = patch.completedAt;
  row.updated_at = new Date().toISOString();
  return row;
}

export class PostgresStore implements Store {
  private pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString, ssl: sslConfig(connectionString) });
  }

  private async one<T>(sql: string, params: unknown[], map: (r: any) => T): Promise<T | null> {
    const { rows } = await this.pool.query(sql, params);
    return rows[0] ? map(rows[0]) : null;
  }

  private async many<T>(sql: string, params: unknown[], map: (r: any) => T): Promise<T[]> {
    const { rows } = await this.pool.query(sql, params);
    return rows.map(map);
  }

  private async oneOrThrow<T>(sql: string, params: unknown[], map: (r: any) => T): Promise<T> {
    const row = await this.one(sql, params, map);
    if (row === null) throw new Error('not found');
    return row;
  }

  // ── user state ─────────────────────────────────────────────────────────

  async getUserState(uid: string): Promise<UserState | null> {
    return this.one('SELECT * FROM user_state WHERE user_uid = $1', [uid], (r) => ({
      userUid: r.user_uid,
      lastRoadmapId: r.last_roadmap_id,
      lastVisitedAt: iso(r.last_visited_at),
    }));
  }

  async setLastRoadmap(uid: string, roadmapId: string | null) {
    await this.pool.query(
      `INSERT INTO user_state (user_uid, last_roadmap_id, last_visited_at)
       VALUES ($1, $2, now())
       ON CONFLICT (user_uid) DO UPDATE SET last_roadmap_id = $2, last_visited_at = now()`,
      [uid, roadmapId],
    );
  }

  // ── roadmaps ───────────────────────────────────────────────────────────

  async createRoadmap(owner: { uid: string; email: string | null }, input: RoadmapInput) {
    return this.oneOrThrow(
      `INSERT INTO roadmaps (owner_uid, owner_email, title, description, start_month, end_month, palette)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        owner.uid,
        (owner.email ?? '').toLowerCase(),
        input.title,
        input.description ?? '',
        input.startMonth,
        input.endMonth,
        input.palette ?? 'pl',
      ],
      mapRoadmap,
    );
  }

  async getRoadmap(id: string) {
    return this.one('SELECT * FROM roadmaps WHERE id = $1', [id], mapRoadmap);
  }

  async updateRoadmap(
    id: string,
    patch: Partial<Pick<Roadmap, 'title' | 'description' | 'startMonth' | 'endMonth'>>,
  ) {
    const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.title !== undefined) row.title = patch.title;
    if (patch.description !== undefined) row.description = patch.description;
    if (patch.startMonth !== undefined) row.start_month = patch.startMonth;
    if (patch.endMonth !== undefined) row.end_month = patch.endMonth;
    const { clause, params } = buildSet(row);
    return this.oneOrThrow(
      `UPDATE roadmaps SET ${clause} WHERE id = $${params.length + 1} RETURNING *`,
      [...params, id],
      mapRoadmap,
    );
  }

  async deleteRoadmap(id: string) {
    await this.pool.query('DELETE FROM roadmaps WHERE id = $1', [id]);
  }

  async listRoadmapsOwned(uid: string) {
    return this.many(
      'SELECT * FROM roadmaps WHERE owner_uid = $1 ORDER BY updated_at DESC',
      [uid],
      mapRoadmap,
    );
  }

  async listRoadmapsSharedWith(email: string) {
    return this.many(
      `SELECT r.* FROM roadmaps r JOIN roadmap_shares s ON s.roadmap_id = r.id
       WHERE s.email = $1 ORDER BY r.updated_at DESC`,
      [email.toLowerCase()],
      mapRoadmap,
    );
  }

  // ── initiatives ────────────────────────────────────────────────────────

  async listInitiatives(roadmapId: string) {
    return this.many(
      'SELECT * FROM initiatives WHERE roadmap_id = $1 ORDER BY position',
      [roadmapId],
      mapInitiative,
    );
  }

  async getInitiative(id: string) {
    return this.one('SELECT * FROM initiatives WHERE id = $1', [id], mapInitiative);
  }

  async createInitiative(roadmapId: string, name: string) {
    return this.oneOrThrow(
      `INSERT INTO initiatives (roadmap_id, name, position)
       VALUES ($1, $2, COALESCE((SELECT MAX(position) FROM initiatives WHERE roadmap_id = $1), 0) + 1)
       RETURNING *`,
      [roadmapId, name],
      mapInitiative,
    );
  }

  async updateInitiative(
    id: string,
    patch: Partial<Pick<Initiative, 'name' | 'description' | 'position'>>,
  ) {
    const row: Record<string, unknown> = {};
    if (patch.name !== undefined) row.name = patch.name;
    if (patch.description !== undefined) row.description = patch.description;
    if (patch.position !== undefined) row.position = patch.position;
    const { clause, params } = buildSet(row);
    return this.oneOrThrow(
      `UPDATE initiatives SET ${clause} WHERE id = $${params.length + 1} RETURNING *`,
      [...params, id],
      mapInitiative,
    );
  }

  async deleteInitiative(id: string) {
    await this.pool.query('DELETE FROM initiatives WHERE id = $1', [id]);
  }

  // ── roadmap items ──────────────────────────────────────────────────────

  async listItems(roadmapId: string) {
    return this.many(
      'SELECT * FROM roadmap_items WHERE roadmap_id = $1 ORDER BY created_at',
      [roadmapId],
      mapItem,
    );
  }

  async getItem(id: string) {
    return this.one('SELECT * FROM roadmap_items WHERE id = $1', [id], mapItem);
  }

  async countItems(roadmapId: string) {
    const { rows } = await this.pool.query(
      'SELECT count(*)::int AS n FROM roadmap_items WHERE roadmap_id = $1',
      [roadmapId],
    );
    return rows[0].n;
  }

  async countItemsInInitiative(initiativeId: string) {
    const { rows } = await this.pool.query(
      'SELECT count(*)::int AS n FROM roadmap_items WHERE initiative_id = $1',
      [initiativeId],
    );
    return rows[0].n;
  }

  async createItem(
    roadmapId: string,
    input: ItemInput,
    colorIndex: number,
    syncGroupId: string | null = null,
  ) {
    return this.oneOrThrow(
      `INSERT INTO roadmap_items
        (roadmap_id, initiative_id, title, description, start_date, end_date,
         milestone_text, milestone_date, okrs, dris, responsible_team, status,
         kpi, completed_at, color_index, sync_group_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
      [
        roadmapId,
        input.initiativeId,
        input.title,
        input.description ?? '',
        input.startDate,
        input.endDate,
        input.milestoneText ?? '',
        input.milestoneDate ?? null,
        input.okrs ?? '',
        input.dris ?? '',
        input.responsibleTeam ?? '',
        input.status ?? 'green',
        input.kpi ?? '',
        input.completedAt ?? null,
        colorIndex,
        syncGroupId,
      ],
      mapItem,
    );
  }

  async updateItem(id: string, patch: Partial<ItemInput>) {
    const { clause, params } = buildSet(itemPatchColumns(patch));
    return this.oneOrThrow(
      `UPDATE roadmap_items SET ${clause} WHERE id = $${params.length + 1} RETURNING *`,
      [...params, id],
      mapItem,
    );
  }

  async deleteItem(id: string) {
    await this.pool.query('DELETE FROM roadmap_items WHERE id = $1', [id]);
  }

  async setItemSyncGroup(id: string, syncGroupId: string) {
    await this.pool.query('UPDATE roadmap_items SET sync_group_id = $2 WHERE id = $1', [
      id,
      syncGroupId,
    ]);
  }

  async listItemsBySyncGroup(syncGroupId: string) {
    return this.many(
      'SELECT * FROM roadmap_items WHERE sync_group_id = $1 ORDER BY created_at',
      [syncGroupId],
      mapItem,
    );
  }

  // ── sprint items ───────────────────────────────────────────────────────

  async listSprints(roadmapItemId: string) {
    return this.many(
      'SELECT * FROM sprint_items WHERE roadmap_item_id = $1 ORDER BY created_at',
      [roadmapItemId],
      mapSprint,
    );
  }

  async getSprint(id: string) {
    return this.one('SELECT * FROM sprint_items WHERE id = $1', [id], mapSprint);
  }

  async countSprints(roadmapItemId: string) {
    const { rows } = await this.pool.query(
      'SELECT count(*)::int AS n FROM sprint_items WHERE roadmap_item_id = $1',
      [roadmapItemId],
    );
    return rows[0].n;
  }

  async countSprintsForItems(itemIds: string[]): Promise<Record<string, number>> {
    if (itemIds.length === 0) return {};
    const { rows } = await this.pool.query(
      `SELECT roadmap_item_id, count(*)::int AS n
       FROM sprint_items
       WHERE roadmap_item_id = ANY($1)
       GROUP BY roadmap_item_id`,
      [itemIds],
    );
    const counts: Record<string, number> = {};
    for (const id of itemIds) counts[id] = 0;
    for (const r of rows) counts[r.roadmap_item_id] = r.n;
    return counts;
  }

  async createSprint(
    roadmapItemId: string,
    input: SprintInput,
    syncGroupId: string | null = null,
  ) {
    return this.oneOrThrow(
      `INSERT INTO sprint_items
        (roadmap_item_id, name, description, start_date, end_date,
         milestone_text, milestone_date, kpi, dri, completed_at, sync_group_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [
        roadmapItemId,
        input.name,
        input.description ?? '',
        input.startDate,
        input.endDate,
        input.milestoneText ?? '',
        input.milestoneDate ?? null,
        input.kpi ?? '',
        input.dri ?? '',
        input.completedAt ?? null,
        syncGroupId,
      ],
      mapSprint,
    );
  }

  async updateSprint(id: string, patch: Partial<SprintInput>) {
    const { clause, params } = buildSet(sprintPatchColumns(patch));
    return this.oneOrThrow(
      `UPDATE sprint_items SET ${clause} WHERE id = $${params.length + 1} RETURNING *`,
      [...params, id],
      mapSprint,
    );
  }

  async deleteSprint(id: string) {
    await this.pool.query('DELETE FROM sprint_items WHERE id = $1', [id]);
  }

  async setSprintSyncGroup(id: string, syncGroupId: string) {
    await this.pool.query('UPDATE sprint_items SET sync_group_id = $2 WHERE id = $1', [
      id,
      syncGroupId,
    ]);
  }

  async listSprintsBySyncGroup(syncGroupId: string) {
    return this.many(
      'SELECT * FROM sprint_items WHERE sync_group_id = $1 ORDER BY created_at',
      [syncGroupId],
      mapSprint,
    );
  }

  // ── shares ─────────────────────────────────────────────────────────────

  async listShares(roadmapId: string) {
    return this.many(
      'SELECT * FROM roadmap_shares WHERE roadmap_id = $1 ORDER BY created_at',
      [roadmapId],
      mapShare,
    );
  }

  async getShare(id: string) {
    return this.one('SELECT * FROM roadmap_shares WHERE id = $1', [id], mapShare);
  }

  async addShare(roadmapId: string, email: string) {
    return this.oneOrThrow(
      'INSERT INTO roadmap_shares (roadmap_id, email) VALUES ($1, $2) RETURNING *',
      [roadmapId, email.toLowerCase()],
      mapShare,
    );
  }

  async addUidShare(roadmapId: string, memberUid: string, memberName: string, role: ShareRole) {
    return this.oneOrThrow(
      `INSERT INTO roadmap_shares (roadmap_id, member_uid, member_name, role)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [roadmapId, memberUid, memberName, role],
      mapShare,
    );
  }

  async setShareRole(id: string, role: ShareRole) {
    await this.pool.query('UPDATE roadmap_shares SET role = $2 WHERE id = $1', [id, role]);
  }

  async listRoadmapsSharedWithUid(memberUid: string) {
    return this.many(
      `SELECT r.* FROM roadmaps r JOIN roadmap_shares s ON s.roadmap_id = r.id
       WHERE s.member_uid = $1 ORDER BY r.updated_at DESC`,
      [memberUid],
      mapRoadmap,
    );
  }

  async removeShare(id: string) {
    await this.pool.query('DELETE FROM roadmap_shares WHERE id = $1', [id]);
  }

  // ── team roster ────────────────────────────────────────────────────────

  async listTeamMembers(roadmapId: string) {
    return this.many(
      'SELECT * FROM roadmap_team_members WHERE roadmap_id = $1 ORDER BY created_at',
      [roadmapId],
      mapTeamMember,
    );
  }

  async getTeamMember(id: string) {
    return this.one('SELECT * FROM roadmap_team_members WHERE id = $1', [id], mapTeamMember);
  }

  async addTeamMember(
    roadmapId: string,
    input: { name: string; memberUid?: string | null; image?: string | null },
  ) {
    return this.oneOrThrow(
      `INSERT INTO roadmap_team_members (roadmap_id, member_uid, name, image)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [roadmapId, input.memberUid ?? null, input.name, input.image ?? null],
      mapTeamMember,
    );
  }

  async updateTeamMember(id: string, patch: Partial<Pick<TeamMember, 'name' | 'image'>>) {
    const row: Record<string, unknown> = {};
    if (patch.name !== undefined) row.name = patch.name;
    if (patch.image !== undefined) row.image = patch.image;
    const { clause, params } = buildSet(row);
    return this.oneOrThrow(
      `UPDATE roadmap_team_members SET ${clause} WHERE id = $${params.length + 1} RETURNING *`,
      [...params, id],
      mapTeamMember,
    );
  }

  async removeTeamMember(id: string) {
    await this.pool.query('DELETE FROM roadmap_team_members WHERE id = $1', [id]);
  }

  // ── invite links ───────────────────────────────────────────────────────

  async getInviteTokens(roadmapId: string): Promise<InviteTokens> {
    const { rows } = await this.pool.query(
      'SELECT invite_token, editor_invite_token FROM roadmaps WHERE id = $1',
      [roadmapId],
    );
    return {
      editor: rows[0]?.editor_invite_token ?? null,
      viewer: rows[0]?.invite_token ?? null,
    };
  }

  async setInviteToken(roadmapId: string, role: ShareRole, token: string | null) {
    await this.pool.query(
      `UPDATE roadmaps SET "${TOKEN_COLUMN[role]}" = $2 WHERE id = $1`,
      [roadmapId, token],
    );
  }

  async findRoadmapByInviteToken(token: string) {
    for (const role of ['viewer', 'editor'] as ShareRole[]) {
      const row = await this.one(
        `SELECT * FROM roadmaps WHERE "${TOKEN_COLUMN[role]}" = $1`,
        [token],
        mapRoadmap,
      );
      if (row) return { roadmap: row, role };
    }
    return null;
  }

  // ── agent links ────────────────────────────────────────────────────────

  async createAgentLink(roadmapId: string, name: string, role: AgentRole, token: string) {
    return this.oneOrThrow(
      `INSERT INTO agent_links (roadmap_id, token, name, role)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [roadmapId, token, name, role],
      mapAgentLink,
    );
  }

  async listAgentLinks(roadmapId: string) {
    return this.many(
      'SELECT * FROM agent_links WHERE roadmap_id = $1 ORDER BY created_at',
      [roadmapId],
      mapAgentLink,
    );
  }

  async getAgentLink(id: string) {
    return this.one('SELECT * FROM agent_links WHERE id = $1', [id], mapAgentLink);
  }

  async findAgentLinkByToken(token: string) {
    return this.one('SELECT * FROM agent_links WHERE token = $1', [token], mapAgentLink);
  }

  async revokeAgentLink(id: string) {
    await this.pool.query('UPDATE agent_links SET revoked_at = now() WHERE id = $1', [id]);
  }

  async touchAgentLink(id: string) {
    await this.pool.query('UPDATE agent_links SET last_used_at = now() WHERE id = $1', [id]);
  }

  // ── suggestions ────────────────────────────────────────────────────────

  async createSuggestion(input: {
    roadmapId: string;
    agentLinkId: string;
    kind: SuggestionKind;
    targetId: string | null;
    payload: Record<string, unknown>;
    rationale: string;
  }) {
    return this.oneOrThrow(
      `INSERT INTO suggestions (roadmap_id, agent_link_id, kind, target_id, payload, rationale)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6) RETURNING *`,
      [
        input.roadmapId,
        input.agentLinkId,
        input.kind,
        input.targetId,
        JSON.stringify(input.payload),
        input.rationale,
      ],
      mapSuggestion,
    );
  }

  async listSuggestions(roadmapId: string) {
    return this.many(
      'SELECT * FROM suggestions WHERE roadmap_id = $1 ORDER BY created_at DESC',
      [roadmapId],
      mapSuggestion,
    );
  }

  async listSuggestionsByLink(agentLinkId: string) {
    return this.many(
      'SELECT * FROM suggestions WHERE agent_link_id = $1 ORDER BY created_at DESC',
      [agentLinkId],
      mapSuggestion,
    );
  }

  async getSuggestion(id: string) {
    return this.one('SELECT * FROM suggestions WHERE id = $1', [id], mapSuggestion);
  }

  async resolveSuggestion(id: string, status: 'accepted' | 'rejected', resolvedBy: string) {
    return this.oneOrThrow(
      `UPDATE suggestions SET status = $2, resolved_by = $3, resolved_at = now()
       WHERE id = $1 RETURNING *`,
      [id, status, resolvedBy],
      mapSuggestion,
    );
  }

  async countPendingSuggestions(agentLinkId: string) {
    const { rows } = await this.pool.query(
      `SELECT count(*)::int AS n FROM suggestions
       WHERE agent_link_id = $1 AND status = 'pending'`,
      [agentLinkId],
    );
    return rows[0].n;
  }

  // ── agent activity ─────────────────────────────────────────────────────

  async logAgentActivity(entry: {
    agentLinkId: string;
    roadmapId: string;
    action: string;
    detail: Record<string, unknown>;
  }) {
    await this.pool.query(
      `INSERT INTO agent_activity (agent_link_id, roadmap_id, action, detail)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [entry.agentLinkId, entry.roadmapId, entry.action, JSON.stringify(entry.detail)],
    );
  }

  async listAgentActivity(agentLinkId: string, limit: number) {
    return this.many(
      `SELECT * FROM agent_activity WHERE agent_link_id = $1
       ORDER BY created_at DESC LIMIT $2`,
      [agentLinkId, limit],
      mapAgentActivity,
    );
  }
}
