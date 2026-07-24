'use client';

import { useCallback, useRef, useState } from 'react';
import { addDays, daysBetween, toUTC } from '@/lib/dates';

export type DragMode = 'move' | 'resize-left' | 'resize-right';

const CLICK_THRESHOLD_PX = 4;

interface DragOptions {
  enabled: boolean;
  pxPerDay: number;
  startDate: string;
  endDate: string;
  clampStart: string;
  clampEnd: string;
  /** Called on drop with changed dates; resolve false to revert. */
  onCommit: (startDate: string, endDate: string) => Promise<boolean>;
  /** Clean click (movement under threshold) — drill-down etc. (AC-3.3). */
  onClick: () => void;
}

interface Preview {
  startDate: string;
  endDate: string;
}

/**
 * Pointer-based drag-to-move / drag-to-resize with day snapping (F-2/F-4).
 * Distinguishes click from drag by a ~4px movement threshold (PRD §9), clamps
 * previews to the allowed span, and snaps deltas to whole days.
 */
export function useBarDrag(options: DragOptions) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [dragging, setDragging] = useState(false);
  const state = useRef<{
    mode: DragMode;
    originX: number;
    moved: boolean;
    start: string;
    end: string;
    latest: Preview | null;
  } | null>(null);

  const optionsRef = useRef(options);
  optionsRef.current = options;

  const onPointerDown = useCallback(
    (mode: DragMode) => (e: React.PointerEvent) => {
      const opts = optionsRef.current;
      if (e.button !== 0) return;
      if (!opts.enabled && mode !== 'move') return;
      e.stopPropagation();

      state.current = {
        mode,
        originX: e.clientX,
        moved: false,
        start: opts.startDate,
        end: opts.endDate,
        latest: null,
      };

      const onMove = (ev: PointerEvent) => {
        const st = state.current;
        if (!st) return;
        const opts2 = optionsRef.current;
        const dx = ev.clientX - st.originX;
        if (!st.moved && Math.abs(dx) < CLICK_THRESHOLD_PX) return;
        if (!opts2.enabled) return; // viewers: never a drag, click still works

        st.moved = true;
        setDragging(true);

        const dayDelta = Math.round(dx / opts2.pxPerDay);
        const duration = daysBetween(st.start, st.end);
        let next: Preview;

        if (st.mode === 'move') {
          let delta = dayDelta;
          const minDelta = daysBetween(st.start, opts2.clampStart);
          const maxDelta = daysBetween(st.end, opts2.clampEnd);
          delta = Math.max(minDelta, Math.min(maxDelta, delta));
          next = { startDate: addDays(st.start, delta), endDate: addDays(st.end, delta) };
        } else if (st.mode === 'resize-left') {
          let s = addDays(st.start, dayDelta);
          if (toUTC(s) < toUTC(opts2.clampStart)) s = opts2.clampStart;
          if (toUTC(s) > toUTC(st.end)) s = st.end;
          next = { startDate: s, endDate: st.end };
        } else {
          let en = addDays(st.end, dayDelta);
          if (toUTC(en) > toUTC(opts2.clampEnd)) en = opts2.clampEnd;
          if (toUTC(en) < toUTC(st.start)) en = st.start;
          next = { startDate: st.start, endDate: en };
        }

        st.latest = next;
        setPreview(next);
        void duration;
      };

      const onUp = async () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        const st = state.current;
        state.current = null;
        setDragging(false);

        if (!st) return;
        const opts2 = optionsRef.current;

        if (!st.moved) {
          setPreview(null);
          opts2.onClick();
          return;
        }

        const finalDates = st.latest;
        if (
          !finalDates ||
          (finalDates.startDate === st.start && finalDates.endDate === st.end)
        ) {
          setPreview(null);
          return;
        }

        const ok = await opts2.onCommit(finalDates.startDate, finalDates.endDate);
        setPreview(null);
        void ok;
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [],
  );

  return { onPointerDown, preview, dragging };
}
