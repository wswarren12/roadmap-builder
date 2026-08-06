'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@pl/components/Button';
import { ApiError, api } from '@/lib/client/api';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  actions?: { tool: string; summary: string }[];
  error?: boolean;
}

const GREETING =
  "Hi! I'm your planning agent. Tell me what you're thinking of building and I'll help prioritize, sequence, and add it to the roadmap — or ask me to research similar products for feature gaps.";

/**
 * Floating planning-agent chat (F-14). Editors chat about what to add and
 * how to sequence it; the agent applies changes through the roadmap API and
 * the panel lists every action it took. Scope-limited server-side.
 */
export function AgentChat({
  roadmapId,
  onActionsApplied,
}: {
  roadmapId: string;
  onActionsApplied: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, busy, open]);

  async function send() {
    const content = input.trim();
    if (!content || busy) return;
    setInput('');
    const nextMessages: ChatMessage[] = [...messages, { role: 'user', content }];
    setMessages(nextMessages);
    setBusy(true);
    try {
      const res = await api<{ reply: string; actions: { tool: string; summary: string }[] }>(
        `/api/roadmaps/${roadmapId}/agent`,
        {
          method: 'POST',
          body: {
            messages: nextMessages.map(({ role, content: c }) => ({ role, content: c })),
          },
        },
      );
      setMessages((m) => [
        ...m,
        { role: 'assistant', content: res.reply, actions: res.actions },
      ]);
      if (res.actions.length) onActionsApplied();
    } catch (e) {
      setMessages((m) => [
        ...m,
        {
          role: 'assistant',
          content:
            e instanceof ApiError ? e.message : 'Something went wrong — please try again.',
          error: true,
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        className="agent-bubble"
        aria-label="Open planning agent"
        onClick={() => setOpen((o) => !o)}
        data-testid="agent-bubble"
      >
        ✦
      </button>

      {open && (
        <div className="agent-panel" data-testid="agent-panel">
          <div className="agent-panel-head">
            <span className="agent-panel-title">Planning agent</span>
            <button
              className="icon-btn"
              aria-label="Close planning agent"
              onClick={() => setOpen(false)}
              data-testid="agent-close"
            >
              ✕
            </button>
          </div>
          <div className="agent-messages" ref={scrollRef} data-testid="agent-messages">
            <div className="agent-msg agent-msg--assistant">{GREETING}</div>
            {messages.map((m, idx) => (
              <div
                key={idx}
                className={`agent-msg agent-msg--${m.role}${m.error ? ' agent-msg--error' : ''}`}
                data-testid={`agent-msg-${m.role}`}
              >
                {m.content}
                {m.actions && m.actions.length > 0 && (
                  <ul className="agent-actions">
                    {m.actions.map((a, i) => (
                      <li key={i} className="agent-action" data-testid="agent-action">
                        {a.summary}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
            {busy && (
              <div className="agent-msg agent-msg--assistant agent-msg--busy" data-testid="agent-busy">
                Thinking…
              </div>
            )}
          </div>
          <div className="agent-input-row">
            <textarea
              className="agent-input"
              value={input}
              rows={2}
              placeholder="What should we build next?"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              data-testid="agent-input"
            />
            <Button
              variant="primary"
              styleType="fill"
              size="sm"
              disabled={!input.trim() || busy}
              onClick={send}
              data-testid="agent-send"
            >
              Send
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
