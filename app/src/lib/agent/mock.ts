import type Anthropic from '@anthropic-ai/sdk';
import { addDays } from '../dates';
import type { ModelCaller } from './loop';

/**
 * Deterministic stand-in for the Anthropic API (ANTHROPIC_MOCK=1) — used by
 * e2e tests and keyless local dev. It walks the real agent loop: reads the
 * roadmap via get_roadmap, then, if the user asked to add an item like
 *   add an item "Title"
 * creates it in the first initiative; otherwise it answers with a scoped
 * text reply. Exercises loop mechanics end-to-end without network access.
 */

let counter = 0;

function message(
  content: Anthropic.Messages.ContentBlock[],
  stopReason: 'tool_use' | 'end_turn',
): Anthropic.Messages.Message {
  return {
    id: `msg_mock_${counter++}`,
    type: 'message',
    role: 'assistant',
    model: 'mock',
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: 0 },
  } as unknown as Anthropic.Messages.Message;
}

function toolUse(name: string, input: Record<string, unknown>): Anthropic.Messages.ContentBlock {
  return {
    type: 'tool_use',
    id: `toolu_mock_${counter++}`,
    name,
    input,
  } as Anthropic.Messages.ContentBlock;
}

function text(value: string): Anthropic.Messages.ContentBlock {
  return { type: 'text', text: value, citations: null } as Anthropic.Messages.ContentBlock;
}

function lastUserText(messages: Anthropic.Messages.MessageParam[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === 'user' && typeof m.content === 'string') return m.content;
  }
  return '';
}

function lastToolResult(messages: Anthropic.Messages.MessageParam[]): string | null {
  const last = messages[messages.length - 1];
  if (last?.role !== 'user' || typeof last.content === 'string') return null;
  for (const block of last.content) {
    if (typeof block === 'object' && block.type === 'tool_result') {
      return typeof block.content === 'string' ? block.content : null;
    }
  }
  return null;
}

function countToolRounds(messages: Anthropic.Messages.MessageParam[]): number {
  return messages.filter(
    (m) =>
      m.role === 'user' &&
      typeof m.content !== 'string' &&
      m.content.some((b) => typeof b === 'object' && b.type === 'tool_result'),
  ).length;
}

export const mockModel: ModelCaller = async ({ messages }) => {
  const ask = lastUserText(messages);
  const wantsItem = /add .*item .*"([^"]+)"/i.exec(ask);
  const rounds = countToolRounds(messages);

  if (!wantsItem) {
    return message(
      [text('MOCK AGENT: I can only help with this roadmap — try: add an item "Title".')],
      'end_turn',
    );
  }

  if (rounds === 0) {
    return message([toolUse('get_roadmap', {})], 'tool_use');
  }

  if (rounds === 1) {
    const snapshot = JSON.parse(lastToolResult(messages) ?? '{}');
    const initiative = snapshot.initiatives?.[0];
    const start = snapshot.roadmap?.startMonth ?? '2026-07-01';
    return message(
      [
        toolUse('create_item', {
          initiativeId: initiative?.id ?? 'missing',
          title: wantsItem[1],
          startDate: start,
          endDate: addDays(start, 13),
        }),
      ],
      'tool_use',
    );
  }

  return message(
    [text(`MOCK AGENT: Added "${wantsItem[1]}" to the roadmap — a two-week starter slot at the top of the range. Say the word if you want it re-dated or resequenced.`)],
    'end_turn',
  );
};
