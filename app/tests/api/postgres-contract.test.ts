import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { completedColor, itemColor } from '@/lib/colors';
import { PostgresStore } from '@/lib/store/postgres';

/**
 * PostgresStore contract test (db-migration, 2026-08-15). Runs only when
 * TEST_DATABASE_URL points at a migrated Postgres (the ephemeral docker
 * rehearsal database); skipped in normal CI where only the memory store
 * exists. Asserts the wire-shape parity that bit the last Supabase→pg port:
 * DATE columns must stay 'YYYY-MM-DD' strings, timestamps ISO strings.
 */
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('PostgresStore contract', () => {
  const store = () => new PostgresStore(url!);

  it('round-trips a roadmap with string-shaped dates', async () => {
    const s = store();
    const roadmap = await s.createRoadmap(
      { uid: 'pg-test', email: 'pg@test.local' },
      { title: 'PG contract', startMonth: '2026-07-01', endMonth: '2026-12-01' },
    );
    try {
      expect(roadmap.startMonth).toBe('2026-07-01'); // DATE stays a string
      expect(roadmap.endMonth).toBe('2026-12-01');
      expect(roadmap.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/); // ISO string

      const initiative = await s.createInitiative(roadmap.id, 'PG Init');
      expect(initiative.position).toBe(1);
      await s.updateInitiative(initiative.id, { description: 'theme' });
      expect((await s.getInitiative(initiative.id))!.description).toBe('theme');

      const item = await s.createItem(
        roadmap.id,
        {
          initiativeId: initiative.id,
          title: 'PG item',
          startDate: '2026-08-01',
          endDate: '2026-09-15',
          milestoneDate: '2026-09-01',
          responsibleTeam: 'Platform',
        },
        0,
      );
      expect(item.startDate).toBe('2026-08-01');
      expect(item.milestoneDate).toBe('2026-09-01');
      expect(item.responsibleTeam).toBe('Platform');
      expect(item.syncGroupId).toBeNull();

      const patched = await s.updateItem(item.id, { milestoneDate: null, status: 'red' });
      expect(patched.milestoneDate).toBeNull();
      expect(patched.status).toBe('red');

      const sprint = await s.createSprint(item.id, {
        name: 'PG sprint',
        startDate: '2026-08-03',
        endDate: '2026-08-14',
      });
      expect(sprint.startDate).toBe('2026-08-03');
      expect(await s.countSprints(item.id)).toBe(1);

      await s.setItemSyncGroup(item.id, '11111111-1111-4111-8111-111111111111');
      expect(await s.listItemsBySyncGroup('11111111-1111-4111-8111-111111111111')).toHaveLength(1);

      await s.setInviteToken(roadmap.id, 'editor', 'pg-tok-editor');
      const found = await s.findRoadmapByInviteToken('pg-tok-editor');
      expect(found!.role).toBe('editor');
      expect((await s.getInviteTokens(roadmap.id)).editor).toBe('pg-tok-editor');

      const share = await s.addUidShare(roadmap.id, 'pg-uid', 'PG User', 'editor');
      expect(share.role).toBe('editor');
      expect(await s.listRoadmapsSharedWithUid('pg-uid')).toHaveLength(1);

      const link = await s.createAgentLink(roadmap.id, 'PG bot', 'agent_suggester', 'pg-agent-tok');
      const suggestion = await s.createSuggestion({
        roadmapId: roadmap.id,
        agentLinkId: link.id,
        kind: 'update_item',
        targetId: item.id,
        payload: { endDate: '2026-10-01' },
        rationale: 'pg contract',
      });
      expect(suggestion.payload).toEqual({ endDate: '2026-10-01' }); // jsonb round-trip
      expect(await s.countPendingSuggestions(link.id)).toBe(1);
      const resolved = await s.resolveSuggestion(suggestion.id, 'accepted', 'pg-test');
      expect(resolved.resolvedAt).toMatch(/Z$/);

      await s.logAgentActivity({
        agentLinkId: link.id,
        roadmapId: roadmap.id,
        action: 'read',
        detail: { path: 'contract' },
      });
      const acts = await s.listAgentActivity(link.id, 5);
      expect(acts[0].detail).toEqual({ path: 'contract' });

      await s.setLastRoadmap('pg-test', roadmap.id);
      expect((await s.getUserState('pg-test'))!.lastRoadmapId).toBe(roadmap.id);
    } finally {
      await s.deleteRoadmap(roadmap.id); // cascades everything above
    }
  });

  it('migrates legacy roadmaps to PL colors and enables completion', async () => {
    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString: url });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const roadmap = await client.query(
        `INSERT INTO roadmaps
          (owner_uid, owner_email, title, start_month, end_month, palette)
         VALUES ('legacy-test', 'legacy@test.local', 'Legacy', '2026-07-01', '2026-12-01', 'sunset')
         RETURNING id`,
      );
      const initiative = await client.query(
        `INSERT INTO initiatives (roadmap_id, name, position)
         VALUES ($1, 'Legacy initiative', 1) RETURNING id`,
        [roadmap.rows[0].id],
      );
      await client.query(
        `INSERT INTO roadmap_items
          (roadmap_id, initiative_id, title, start_date, end_date, color_index)
         VALUES ($1, $2, 'Legacy teal', '2026-08-01', '2026-08-31', 1),
                ($1, $2, 'Legacy olive', '2026-09-01', '2026-09-30', 5)`,
        [roadmap.rows[0].id, initiative.rows[0].id],
      );

      const sql = readFileSync(
        new URL('../../db/migrations/010_legacy_palette_backfill.sql', import.meta.url),
        'utf8',
      );
      await client.query(sql);

      const migrated = await client.query(
        `SELECT r.palette, i.id, i.color_index, i.completed_at
         FROM roadmaps r JOIN roadmap_items i ON i.roadmap_id = r.id
         WHERE r.id = $1 ORDER BY i.start_date`,
        [roadmap.rows[0].id],
      );
      expect(migrated.rows.map((row) => row.palette)).toEqual(['pl', 'pl']);
      expect(migrated.rows.map((row) => row.color_index)).toEqual([2, 4]);
      expect(migrated.rows.map((row) => row.completed_at)).toEqual([null, null]);
      for (const row of migrated.rows) {
        expect(itemColor(row.color_index, 'pl')).not.toBe(completedColor('pl'));
      }

      await client.query(
        `UPDATE roadmap_items SET completed_at = '2026-09-30' WHERE id = $1`,
        [migrated.rows[0].id],
      );
      const completed = await client.query(
        'SELECT completed_at FROM roadmap_items WHERE id = $1',
        [migrated.rows[0].id],
      );
      expect(completed.rows[0].completed_at).toBe('2026-09-30');
    } finally {
      await client.query('ROLLBACK');
      client.release();
      await pool.end();
    }
  });

  it('copied production data reads back with correct shapes', async () => {
    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString: url });
    // any copied roadmap that has items — don't assume a particular owner
    const { rows } = await pool.query(
      `SELECT r.id, r.owner_uid FROM roadmaps r
       WHERE EXISTS (SELECT 1 FROM roadmap_items i WHERE i.roadmap_id = r.id)
       LIMIT 1`,
    );
    await pool.end();
    expect(rows.length).toBe(1);

    const s = store();
    const owned = await s.listRoadmapsOwned(rows[0].owner_uid);
    expect(owned.some((r) => r.id === rows[0].id)).toBe(true);
    const items = await s.listItems(rows[0].id);
    expect(items.length).toBeGreaterThan(0);
    for (const i of items.slice(0, 3)) {
      expect(i.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(i.updatedAt).toMatch(/Z$/);
    }
  });
});
