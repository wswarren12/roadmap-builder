'use client';

import { useEffect, useState } from 'react';
import { EmptyState } from '@pl/components/EmptyState';
import { itemColor } from '@/lib/colors';
import {
  dayOffsetInSpan,
  daysBetween,
  formatRange,
  monthColumns,
  rangeEndDate,
  rangeTotalDays,
} from '@/lib/dates';
import { assignLanes } from '@/lib/stacking';
import type {
  AgentRole,
  Initiative,
  Roadmap,
  RoadmapItem,
  SprintItem,
} from '@/lib/types';

/**
 * The browser face of an agent link (agent-links design): a read-only
 * roadmap render with a banner naming the link. No login, no edit surface —
 * viewers of this page hold only the bearer token in the URL. Deliberately
 * much simpler than RoadmapView: no drags, forms, panels, or role logic.
 */

const ROLE_LABEL: Record<AgentRole, string> = {
  agent_viewer: 'viewer',
  agent_suggester: 'suggest',
  agent_editor: 'edit',
};

interface AgentRoadmapData {
  roadmap: Roadmap;
  initiatives: Initiative[];
  items: Array<RoadmapItem & { sprints: SprintItem[] }>;
}

interface AgentManifest {
  agent: { name: string; role: AgentRole };
}

type LoadState = 'loading' | 'ok' | 'gone' | 'error';

export function AgentLinkView({ token }: { token: string }) {
  const [state, setState] = useState<LoadState>('loading');
  const [manifest, setManifest] = useState<AgentManifest | null>(null);
  const [data, setData] = useState<AgentRoadmapData | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [mRes, rRes] = await Promise.all([
          fetch(`/agent/${token}/api`, { cache: 'no-store' }),
          fetch(`/agent/${token}/api/roadmap`, { cache: 'no-store' }),
        ]);
        if (cancelled) return;
        if (mRes.status === 404 || rRes.status === 404) return setState('gone');
        if (!mRes.ok || !rRes.ok) return setState('error');
        setManifest(await mRes.json());
        setData(await rRes.json());
        setState('ok');
      } catch {
        if (!cancelled) setState('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (state === 'loading') {
    return <div className="skeleton" style={{ height: 320, margin: 24 }} />;
  }
  if (state === 'gone') {
    return (
      <EmptyState
        title="This link is no longer active"
        description="The roadmap owner revoked this agent link, or it never existed."
      />
    );
  }
  if (state === 'error' || !data || !manifest) {
    return (
      <EmptyState
        title="Something went wrong"
        description="Could not load this roadmap right now — try again shortly."
      />
    );
  }

  const { roadmap, initiatives, items } = data;
  const span = { start: roadmap.startMonth, end: rangeEndDate(roadmap.endMonth) };
  const totalDays = rangeTotalDays(roadmap.startMonth, roadmap.endMonth);
  const months = monthColumns(roadmap.startMonth, roadmap.endMonth);

  return (
    <div className="agent-view">
      <div className="agent-banner" data-testid="agent-banner">
        <span>
          Shared with <strong>&quot;{manifest.agent.name}&quot;</strong> —{' '}
          {ROLE_LABEL[manifest.agent.role]} access · read-only view
        </span>
      </div>
      <div className="agent-view-header">
        <h1>{roadmap.title}</h1>
        {roadmap.description ? <p>{roadmap.description}</p> : null}
      </div>
      <div className="agent-grid">
        <div className="agent-grid-months">
          <span className="agent-grid-label" />
          {months.map((m) => (
            <span
              key={m.monthISO}
              className="agent-grid-month"
              style={{ width: `${(m.days / totalDays) * 100}%` }}
            >
              {m.label}
            </span>
          ))}
        </div>
        {initiatives.map((initiative) => {
          const rows = items.filter((i) => i.initiativeId === initiative.id);
          const { lanes, laneCount } = assignLanes(rows);
          return (
            <div key={initiative.id} className="agent-grid-row" data-testid="agent-initiative-row">
              <span className="agent-grid-label">{initiative.name}</span>
              <div
                className="agent-grid-lanes"
                style={{ height: Math.max(laneCount, 1) * 40 }}
              >
                {rows.map((item) => {
                  const off = dayOffsetInSpan(span.start, span.end, item.startDate) ?? 0;
                  const len = daysBetween(item.startDate, item.endDate) + 1;
                  return (
                    <div
                      key={item.id}
                      className="agent-bar"
                      data-testid="agent-item-bar"
                      title={`${item.title} · ${formatRange(item.startDate, item.endDate)}`}
                      style={{
                        left: `${(off / totalDays) * 100}%`,
                        width: `${(len / totalDays) * 100}%`,
                        top: (lanes.get(item.id) ?? 0) * 40 + 4,
                        background: itemColor(item.colorIndex),
                      }}
                    >
                      <span className="agent-bar-title">{item.title}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
