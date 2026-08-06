import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { POST as agentChat } from '@/app/api/roadmaps/[id]/agent/route';
import AGENT_PROMPT from '@/lib/agent/agent.md';
import { runAgentTurn, type ModelCaller } from '@/lib/agent/loop';
import type { MemoryStore } from '@/lib/store';
import { OWNER, VIEWER, freshStore, reqAs, seedRoadmap } from './harness';

/**
 * BDD scenarios — roadmap planning agent (F-14).
 *
 * - Given a user asks the agent to add work, When the model calls the
 *   roadmap tools, Then the loop executes them against the store, feeds
 *   results back, and returns the final reply plus a list of the actions
 *   taken (AC-14.1).
 * - Given a tool call with invalid input (dates outside the roadmap range,
 *   foreign initiative), Then the tool result reports the error, nothing is
 *   written, and the loop continues so the model can correct itself
 *   (AC-14.2).
 * - Given the agent re-sequences existing work, Then update tools re-date
 *   items in place (AC-14.3).
 * - Given no ANTHROPIC_API_KEY and no mock mode, Then the endpoint returns
 *   a friendly 503 (AC-14.4).
 * - Given a viewer, Then the agent endpoint is 403 — it mutates the roadmap
 *   (AC-14.5).
 * - Given mock mode (ANTHROPIC_MOCK=1), Then a full chat turn walks
 *   get_roadmap → create_item → reply end-to-end (AC-14.6).
 * - The agent.md prompt encodes the scope guardrail and the researched
 *   practices (ICE/RICE, dependencies-first sequencing, gap-analysis
 *   discipline) (AC-14.7).
 */

let store: MemoryStore;
const OLD_ENV = { ...process.env };

beforeEach(() => {
  store = freshStore();
});

afterEach(() => {
  process.env.ANTHROPIC_MOCK = OLD_ENV.ANTHROPIC_MOCK;
  process.env.ANTHROPIC_API_KEY = OLD_ENV.ANTHROPIC_API_KEY;
});

function textMsg(text: string): Anthropic.Messages.ContentBlock {
  return { type: 'text', text, citations: null } as Anthropic.Messages.ContentBlock;
}

function toolUse(
  id: string,
  name: string,
  input: Record<string, unknown>,
): Anthropic.Messages.ContentBlock {
  return { type: 'tool_use', id, name, input } as Anthropic.Messages.ContentBlock;
}

function scripted(turns: Anthropic.Messages.ContentBlock[][]): ModelCaller {
  let call = 0;
  return async () => {
    const content = turns[Math.min(call, turns.length - 1)];
    call++;
    const hasTool = content.some((b) => b.type === 'tool_use');
    return {
      id: `msg_${call}`,
      type: 'message',
      role: 'assistant',
      model: 'scripted',
      content,
      stop_reason: hasTool ? 'tool_use' : 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    } as unknown as Anthropic.Messages.Message;
  };
}

const SYSTEM = [{ type: 'text' as const, text: 'test' }];

describe('agent loop (F-14)', () => {
  it('executes tool calls, feeds results back, and reports actions (AC-14.1)', async () => {
    const { roadmap, initiative } = await seedRoadmap(store);

    const { reply, actions } = await runAgentTurn({
      roadmap,
      system: SYSTEM,
      history: [{ role: 'user', content: 'Plan a payments push' }],
      callModel: scripted([
        [
          toolUse('t1', 'create_item', {
            initiativeId: initiative.id,
            title: 'Payments v2',
            startDate: '2026-10-01',
            endDate: '2026-10-28',
            dris: 'Ada',
          }),
        ],
        [textMsg('Planned the payments push.')],
      ]),
    });

    expect(reply).toBe('Planned the payments push.');
    expect(actions).toHaveLength(1);
    expect(actions[0].summary).toContain('Payments v2');
    const items = await store.listItems(roadmap.id);
    expect(items.map((i) => i.title)).toContain('Payments v2');
    const created = items.find((i) => i.title === 'Payments v2')!;
    expect(created.dris).toBe('Ada');
  });

  it('rejects invalid tool input without writing, and the loop continues (AC-14.2)', async () => {
    const { roadmap, initiative } = await seedRoadmap(store);

    const { reply, actions } = await runAgentTurn({
      roadmap,
      system: SYSTEM,
      history: [{ role: 'user', content: 'Add something out of range' }],
      callModel: scripted([
        [
          toolUse('t1', 'create_item', {
            initiativeId: initiative.id,
            title: 'Too early',
            startDate: '2026-01-01', // roadmap starts 2026-07-01
            endDate: '2026-02-01',
          }),
        ],
        [textMsg('That did not fit the roadmap range.')],
      ]),
    });

    expect(reply).toContain('did not fit');
    expect(actions).toHaveLength(0);
    const items = await store.listItems(roadmap.id);
    expect(items.map((i) => i.title)).not.toContain('Too early');
  });

  it('re-sequences existing items and adds sprints via update/create tools (AC-14.3)', async () => {
    const { roadmap, item } = await seedRoadmap(store);

    const { actions } = await runAgentTurn({
      roadmap,
      system: SYSTEM,
      history: [{ role: 'user', content: 'Push signup later and add a sprint' }],
      callModel: scripted([
        [
          toolUse('t1', 'update_item', {
            itemId: item.id,
            startDate: '2026-09-01',
            endDate: '2026-10-15',
          }),
          toolUse('t2', 'create_sprint', {
            itemId: item.id,
            name: 'Kickoff sprint',
            startDate: '2026-09-01',
            endDate: '2026-09-11',
            dri: 'Grace',
          }),
        ],
        [textMsg('Re-sequenced.')],
      ]),
    });

    expect(actions).toHaveLength(2);
    const updated = (await store.getItem(item.id))!;
    expect(updated.startDate).toBe('2026-09-01');
    const sprints = await store.listSprints(item.id);
    expect(sprints.map((s) => s.name)).toContain('Kickoff sprint');
  });

  it('never exposes delete tools by design', async () => {
    const { AGENT_TOOLS } = await import('@/lib/agent/tools');
    const names = AGENT_TOOLS.map((t) => ('name' in t ? t.name : '')).join(',');
    expect(names).not.toMatch(/delete|remove/i);
  });
});

describe('agent endpoint (F-14)', () => {
  it('runs a full mock chat turn: get_roadmap → create_item → reply (AC-14.6)', async () => {
    process.env.ANTHROPIC_MOCK = '1';
    const { roadmap } = await seedRoadmap(store);

    const res = await agentChat(
      reqAs(OWNER, 'POST', {
        messages: [{ role: 'user', content: 'Please add an item "Payments revamp"' }],
      }),
      { params: { id: roadmap.id } },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reply).toContain('Payments revamp');
    expect(body.actions).toHaveLength(1);
    const items = await store.listItems(roadmap.id);
    expect(items.map((i) => i.title)).toContain('Payments revamp');
  });

  it('503s with a friendly message when no key is configured (AC-14.4)', async () => {
    delete process.env.ANTHROPIC_MOCK;
    delete process.env.ANTHROPIC_API_KEY;
    const { roadmap } = await seedRoadmap(store);

    const res = await agentChat(
      reqAs(OWNER, 'POST', { messages: [{ role: 'user', content: 'hi' }] }),
      { params: { id: roadmap.id } },
    );
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/API key/i);
  });

  it('viewers cannot use the agent (AC-14.5)', async () => {
    process.env.ANTHROPIC_MOCK = '1';
    const { roadmap } = await seedRoadmap(store);

    const res = await agentChat(
      reqAs(VIEWER, 'POST', { messages: [{ role: 'user', content: 'hi' }] }),
      { params: { id: roadmap.id } },
    );
    expect(res.status).toBe(403);
  });

  it('validates the chat payload shape', async () => {
    process.env.ANTHROPIC_MOCK = '1';
    const { roadmap } = await seedRoadmap(store);

    const noMessages = await agentChat(reqAs(OWNER, 'POST', {}), {
      params: { id: roadmap.id },
    });
    expect(noMessages.status).toBe(400);

    const wrongTail = await agentChat(
      reqAs(OWNER, 'POST', { messages: [{ role: 'assistant', content: 'hello' }] }),
      { params: { id: roadmap.id } },
    );
    expect(wrongTail.status).toBe(400);
  });
});

describe('agent.md prompt (F-14, AC-14.7)', () => {
  it('encodes the scope guardrail and researched roadmapping practices', () => {
    expect(AGENT_PROMPT).toMatch(/ONLY discuss and act on this roadmap/i);
    expect(AGENT_PROMPT).toMatch(/RICE/);
    expect(AGENT_PROMPT).toMatch(/ICE/);
    expect(AGENT_PROMPT).toMatch(/Now \/ Next \/ Later/i);
    expect(AGENT_PROMPT).toMatch(/dependencies/i);
    expect(AGENT_PROMPT).toMatch(/does \*\*not\*\* make its absence a gap/i);
    expect(AGENT_PROMPT).toMatch(/sprint level/i);
    expect(AGENT_PROMPT).toMatch(/Never delete/i);
  });
});
