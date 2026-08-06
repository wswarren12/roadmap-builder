import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { authorizeRoadmap, jsonError, readJson } from '@/lib/api-helpers';
import AGENT_PROMPT from '@/lib/agent/agent.md';
import { runAgentTurn, type AgentChatMessage, type ModelCaller } from '@/lib/agent/loop';
import { mockModel } from '@/lib/agent/mock';
import { roadmapSnapshot } from '@/lib/agent/tools';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

interface Params {
  params: { id: string };
}

const MAX_HISTORY = 40;
const MAX_MESSAGE_CHARS = 4000;

/**
 * Planning-agent chat turn (F-14). The client sends the visible chat history
 * (text only, newest user message last); the server grounds the model with
 * agent.md + a live roadmap snapshot, runs the tool loop, and returns the
 * reply plus a list of the changes it made.
 */
export async function POST(req: Request, { params }: Params) {
  const auth = await authorizeRoadmap(req, params.id, 'write');
  if (auth instanceof NextResponse) return auth;
  const { roadmap } = auth;

  const mock = process.env.ANTHROPIC_MOCK === '1';
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey && !mock) {
    return jsonError(
      503,
      "The planning assistant isn't set up yet — the app needs an Anthropic API key.",
    );
  }

  const body = await readJson(req);
  if (!body || !Array.isArray(body.messages)) {
    return jsonError(400, 'Invalid JSON body — expected { messages: [...] }');
  }
  const history: AgentChatMessage[] = [];
  for (const raw of body.messages.slice(-MAX_HISTORY)) {
    const m = raw as { role?: unknown; content?: unknown };
    if (
      (m.role !== 'user' && m.role !== 'assistant') ||
      typeof m.content !== 'string' ||
      !m.content.trim()
    ) {
      return jsonError(400, 'Each message needs a role (user/assistant) and text content');
    }
    history.push({ role: m.role, content: m.content.slice(0, MAX_MESSAGE_CHARS) });
  }
  if (!history.length || history[history.length - 1].role !== 'user') {
    return jsonError(400, 'The last message must be from the user');
  }

  // Stable prompt first (cached), volatile roadmap snapshot after it.
  const system: Anthropic.Messages.TextBlockParam[] = [
    { type: 'text', text: AGENT_PROMPT, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: `Current roadmap state (JSON):\n${await roadmapSnapshot(roadmap)}` },
  ];

  let callModel: ModelCaller;
  if (mock) {
    callModel = mockModel;
  } else {
    const client = new Anthropic({ apiKey });
    callModel = (p) =>
      client.messages.create({
        model: 'claude-opus-4-8',
        // Interactive chat behind a gateway with a hard timeout — keep each
        // hop bounded rather than risking a mid-loop 504.
        max_tokens: 4096,
        thinking: { type: 'adaptive' },
        system: p.system,
        messages: p.messages,
        tools: p.tools,
      });
  }

  try {
    const { reply, actions } = await runAgentTurn({
      roadmap,
      system,
      history,
      callModel,
    });
    return NextResponse.json({ reply, actions });
  } catch (e) {
    if (e instanceof Anthropic.APIError) {
      const friendly =
        e instanceof Anthropic.AuthenticationError
          ? 'The Anthropic API key is invalid — ask the app owner to update it.'
          : e instanceof Anthropic.RateLimitError
            ? 'The assistant is rate-limited right now — try again in a minute.'
            : 'The assistant hit an API error — please try again.';
      return jsonError(502, friendly);
    }
    throw e;
  }
}
