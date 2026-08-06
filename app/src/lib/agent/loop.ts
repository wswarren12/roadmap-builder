import type Anthropic from '@anthropic-ai/sdk';
import type { Roadmap } from '../types';
import { AGENT_TOOLS, executeAgentTool, type AgentAction } from './tools';

/**
 * The agentic loop (F-14): call the model, execute any roadmap tool calls it
 * makes, feed results back, repeat until it answers in text. The model caller
 * is injected so tests drive the loop with a scripted fake and the route
 * wires the real Anthropic SDK (or the deterministic mock in e2e).
 */

export interface AgentChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export type ModelCaller = (params: {
  system: Anthropic.Messages.TextBlockParam[];
  messages: Anthropic.Messages.MessageParam[];
  tools: Anthropic.Messages.ToolUnion[];
}) => Promise<Anthropic.Messages.Message>;

const MAX_ITERATIONS = 8;

export async function runAgentTurn(opts: {
  roadmap: Roadmap;
  system: Anthropic.Messages.TextBlockParam[];
  history: AgentChatMessage[];
  callModel: ModelCaller;
}): Promise<{ reply: string; actions: AgentAction[] }> {
  const messages: Anthropic.Messages.MessageParam[] = opts.history.map((m) => ({
    role: m.role,
    content: m.content,
  }));
  const actions: AgentAction[] = [];
  let lastText = '';

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await opts.callModel({
      system: opts.system,
      messages,
      tools: AGENT_TOOLS,
    });

    const textBlocks = response.content.filter(
      (b): b is Anthropic.Messages.TextBlock => b.type === 'text',
    );
    if (textBlocks.length) lastText = textBlocks.map((b) => b.text).join('\n');

    // Server-side tools (web search) hit their iteration cap — resend to
    // let the API resume where it left off.
    if (response.stop_reason === 'pause_turn') {
      messages.push({ role: 'assistant', content: response.content });
      continue;
    }

    const toolUses = response.content.filter(
      (b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use',
    );
    if (response.stop_reason !== 'tool_use' || toolUses.length === 0) {
      return { reply: lastText, actions };
    }

    // Echo the assistant turn (thinking blocks included) then execute tools.
    messages.push({ role: 'assistant', content: response.content });
    const results: Anthropic.Messages.ToolResultBlockParam[] = [];
    for (const toolUse of toolUses) {
      const outcome = await executeAgentTool(
        opts.roadmap,
        toolUse.name,
        (toolUse.input ?? {}) as Record<string, unknown>,
      );
      if (outcome.action) actions.push(outcome.action);
      results.push({
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: outcome.result,
        ...(outcome.isError ? { is_error: true } : {}),
      });
    }
    messages.push({ role: 'user', content: results });
  }

  return {
    reply:
      lastText ||
      'I ran out of steps before finishing — the changes made so far are listed below.',
    actions,
  };
}
