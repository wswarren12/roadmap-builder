'use client';

import { ITEM_PALETTE, STATUS_COLORS, barColor, completedColor, sprintColor } from '../colors';
import {
  dayOffsetInSpan,
  daysBetween,
  formatDate,
  formatRange,
  monthColumns,
  rangeEndDate,
  rangeTotalDays,
  todayISO,
  weekColumns,
} from '../dates';
import { assignLanes } from '../stacking';
import { slugify } from '../validate';
import type { Initiative, Roadmap, RoadmapItem, SprintItem } from '../types';

/**
 * PDF export (F-8): a dedicated vector render with jsPDF — not a viewport
 * screenshot — so bars, labels, milestone diamonds, status dots, and the
 * today line stay crisp at any range width. Landscape A4, scale-to-fit one
 * page width (PRD §11 Q5 default).
 */

const PAGE_W = 297;
const PAGE_H = 210;
const MARGIN = 12;
const LANE_H = 7;
const LANE_GAP = 2;
const HEADER_ROW_H = 8;

type Doc = any; // jsPDF instance (dynamically imported)

async function newDoc(): Promise<Doc> {
  const { jsPDF } = await import('jspdf');
  return new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function truncateToWidth(doc: Doc, text: string, maxWidth: number): string {
  if (doc.getTextWidth(text) <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && doc.getTextWidth(`${t}…`) > maxWidth) {
    t = t.slice(0, -1);
  }
  return `${t}…`;
}

function drawBar(
  doc: Doc,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  label: string,
  opts: {
    statusColor?: string;
    milestoneX?: number | null;
  } = {},
) {
  const [r, g, b] = hexToRgb(color);
  doc.setFillColor(r, g, b);
  doc.roundedRect(x, y, Math.max(w, 2), h, 1.2, 1.2, 'F');

  let textX = x + 1.6;
  if (opts.statusColor) {
    const [sr, sg, sb] = hexToRgb(opts.statusColor);
    doc.setFillColor(sr, sg, sb);
    doc.circle(x + 2.4, y + h / 2, 1, 'F');
    textX = x + 4.4;
  }

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  const label2 = truncateToWidth(doc, label, Math.max(w - (textX - x) - 1.5, 2));
  doc.text(label2, textX, y + h / 2 + 0.9);

  if (opts.milestoneX != null) {
    const mx = opts.milestoneX;
    const my = y - 0.6;
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(r, g, b);
    doc.setLineWidth(0.5);
    // diamond
    doc.lines(
      [
        [1.4, 1.4],
        [-1.4, 1.4],
        [-1.4, -1.4],
        [1.4, -1.4],
      ],
      mx,
      my,
      [1, 1],
      'FD',
      true,
    );
  }
}

function drawTodayLine(doc: Doc, x: number, top: number, bottom: number) {
  const [r, g, b] = hexToRgb('#F04438');
  doc.setDrawColor(r, g, b);
  doc.setLineWidth(0.5);
  doc.line(x, top, x, bottom);
}

export async function exportRoadmapPdf({
  roadmap,
  initiatives,
  items,
}: {
  roadmap: Roadmap;
  initiatives: Initiative[];
  items: RoadmapItem[];
}) {
  const doc = await newDoc();
  const spanStart = roadmap.startMonth;
  const spanEnd = rangeEndDate(roadmap.endMonth);
  const totalDays = rangeTotalDays(roadmap.startMonth, roadmap.endMonth);

  // Header
  doc.setTextColor(16, 24, 40);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(roadmap.title, MARGIN, MARGIN + 5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(71, 84, 103);
  doc.text(formatRange(spanStart, spanEnd), MARGIN, MARGIN + 11);
  let gridTop = MARGIN + 15;
  if (roadmap.description) {
    const lines = doc.splitTextToSize(roadmap.description, PAGE_W - 2 * MARGIN);
    doc.setFontSize(8);
    doc.text(lines.slice(0, 2), MARGIN, gridTop);
    gridTop += lines.slice(0, 2).length * 3.6 + 2;
  }

  const labelW = 34;
  const gridX = MARGIN + labelW;
  const gridW = PAGE_W - MARGIN - gridX;
  const scale = gridW / totalDays; // mm per day — scale-to-fit one page width
  const months = monthColumns(roadmap.startMonth, roadmap.endMonth);

  // Month header
  doc.setFontSize(7);
  doc.setTextColor(102, 112, 133);
  doc.setDrawColor(228, 231, 236);
  doc.setLineWidth(0.2);
  for (const m of months) {
    const x = gridX + m.startOffset * scale;
    doc.rect(x, gridTop, m.days * scale, HEADER_ROW_H, 'S');
    doc.text(truncateToWidth(doc, m.label, m.days * scale - 2), x + 1, gridTop + 5);
  }

  // Rows
  let y = gridTop + HEADER_ROW_H;
  for (const initiative of initiatives) {
    const rowItems = items.filter((i) => i.initiativeId === initiative.id);
    const { lanes, laneCount } = assignLanes(rowItems);
    const rowH = laneCount * (LANE_H + LANE_GAP) + LANE_GAP;

    doc.setDrawColor(228, 231, 236);
    doc.rect(MARGIN, y, labelW, rowH, 'S');
    doc.rect(gridX, y, gridW, rowH, 'S');
    for (const m of months.slice(1)) {
      const x = gridX + m.startOffset * scale;
      doc.line(x, y, x, y + rowH);
    }

    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(16, 24, 40);
    doc.text(truncateToWidth(doc, initiative.name, labelW - 3), MARGIN + 1.5, y + 5);
    doc.setFont('helvetica', 'normal');

    for (const item of rowItems) {
      const lane = lanes.get(item.id) ?? 0;
      const x = gridX + daysBetween(spanStart, item.startDate) * scale;
      const w = (daysBetween(item.startDate, item.endDate) + 1) * scale;
      const by = y + LANE_GAP + lane * (LANE_H + LANE_GAP);
      const milestoneOff =
        item.milestoneDate &&
        dayOffsetInSpan(item.startDate, item.endDate, item.milestoneDate) !== null
          ? x + (daysBetween(item.startDate, item.milestoneDate) + 0.5) * scale
          : null;
      drawBar(doc, x, by, w, LANE_H, barColor(item, roadmap.palette), item.title, {
        statusColor: STATUS_COLORS[item.status],
        milestoneX: milestoneOff,
      });
    }

    y += rowH;
  }

  const todayOff = dayOffsetInSpan(spanStart, spanEnd, todayISO());
  if (todayOff !== null) {
    drawTodayLine(doc, gridX + (todayOff + 0.5) * scale, gridTop, y);
  }

  doc.save(`${slugify(roadmap.title)}.pdf`);
}

export async function exportItemPdf({
  roadmap,
  item,
  sprints,
  initiativeName,
}: {
  roadmap: Roadmap;
  item: RoadmapItem;
  sprints: SprintItem[];
  initiativeName: string;
}) {
  const doc = await newDoc();
  const totalDays = daysBetween(item.startDate, item.endDate) + 1;

  // Header block: full item details (AC-8.2)
  doc.setTextColor(16, 24, 40);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text(item.title, MARGIN, MARGIN + 5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(71, 84, 103);
  doc.text(
    `${roadmap.title} · ${initiativeName} · ${formatRange(item.startDate, item.endDate)} · status: ${item.status}`,
    MARGIN,
    MARGIN + 11,
  );

  let cursorY = MARGIN + 16;
  doc.setFontSize(8);
  const fields: Array<[string, string]> = [];
  if (item.description) fields.push(['Description', item.description]);
  if (item.milestoneText || item.milestoneDate) {
    fields.push([
      'Milestone',
      `${item.milestoneText}${item.milestoneDate ? ` — ${formatDate(item.milestoneDate)}` : ''}`,
    ]);
  }
  if (item.okrs) fields.push(['OKRs', item.okrs]);
  if (item.dris) fields.push(['DRIs', item.dris]);
  if (item.kpi) fields.push(['KPI', item.kpi]);
  for (const [label, value] of fields) {
    doc.setFont('helvetica', 'bold');
    doc.text(`${label}: `, MARGIN, cursorY);
    const lw = doc.getTextWidth(`${label}: `);
    doc.setFont('helvetica', 'normal');
    const lines = doc.splitTextToSize(value, PAGE_W - 2 * MARGIN - lw);
    doc.text(lines.slice(0, 2), MARGIN + lw, cursorY);
    cursorY += lines.slice(0, 2).length * 3.6 + 1;
  }
  cursorY += 3;

  const gridX = MARGIN;
  const gridW = PAGE_W - 2 * MARGIN;
  const scale = gridW / totalDays;
  const weeks = weekColumns(item.startDate, item.endDate);

  doc.setFontSize(7);
  doc.setTextColor(102, 112, 133);
  doc.setDrawColor(228, 231, 236);
  doc.setLineWidth(0.2);
  for (const w of weeks) {
    const x = gridX + w.startOffset * scale;
    doc.rect(x, cursorY, w.days * scale, HEADER_ROW_H, 'S');
    doc.text(truncateToWidth(doc, w.label, w.days * scale - 2), x + 1, cursorY + 5);
  }

  const { lanes, laneCount } = assignLanes(sprints);
  const lanesH = Math.max(laneCount * (LANE_H + LANE_GAP) + LANE_GAP, 20);
  const lanesTop = cursorY + HEADER_ROW_H;
  doc.rect(gridX, lanesTop, gridW, lanesH, 'S');
  for (const w of weeks.slice(1)) {
    const x = gridX + w.startOffset * scale;
    doc.line(x, lanesTop, x, lanesTop + lanesH);
  }

  for (const sprint of sprints) {
    const lane = lanes.get(sprint.id) ?? 0;
    const x = gridX + daysBetween(item.startDate, sprint.startDate) * scale;
    const w = (daysBetween(sprint.startDate, sprint.endDate) + 1) * scale;
    const by = lanesTop + LANE_GAP + lane * (LANE_H + LANE_GAP);
    const milestoneOff =
      sprint.milestoneDate &&
      dayOffsetInSpan(sprint.startDate, sprint.endDate, sprint.milestoneDate) !== null
        ? x + (daysBetween(sprint.startDate, sprint.milestoneDate) + 0.5) * scale
        : null;
    const sprintFill = sprint.completedAt
      ? completedColor(roadmap.palette)
      : sprintColor(roadmap.palette);
    drawBar(doc, x, by, w, LANE_H, sprintFill, sprint.name, { milestoneX: milestoneOff });
  }

  const todayOff = dayOffsetInSpan(item.startDate, item.endDate, todayISO());
  if (todayOff !== null) {
    drawTodayLine(doc, gridX + (todayOff + 0.5) * scale, cursorY, lanesTop + lanesH);
  }

  doc.save(`${slugify(roadmap.title)}—${slugify(item.title)}.pdf`);
}

export { ITEM_PALETTE };
