# PRD: Roadmapper — Simple Shareable Product Roadmaps

| Field | Value |
|-------|-------|
| Author | Bill Warren |
| Date | 2026-07-22 |
| Status | Draft |
| Version | 1.0 |
| Deployment | PLN AI App Starter Kit (v1.4 — reconcile at build, see §11 Q1) |
| Database | Supabase (PostgreSQL) — explicit user requirement; overrides any starter-kit DB default |

---

## 1. Overview

Roadmapper is a lightweight, members-only web app for building clean, interactive product roadmaps covering 3-month to 1-year periods. A roadmap is a single calendar: 1–5 named initiative rows on the Y-axis, months on the X-axis, and titled bars spanning start→end dates for each roadmap item. Clicking a roadmap item drills into a subcalendar scoped to that item's timeline, broken into weeks, containing stacked sprint-item bars; clicking a sprint item opens a full-detail card on the right. Roadmaps are owned per-user, shareable read-only via an email whitelist, and exportable to PDF at both levels. Auth uses the LabOS auth system per the AI App Starter Kit; data persists in Supabase.

The design goal is the roadmap format the author already builds by hand in Figma/Notion — swimlane timeline, two levels of drill-down, nothing else — delivered as an app instead of hours of manual drawing, with modern interaction polish (drag-to-move/resize bars, micro-animations, smooth drill-down transitions).

### One-Sentence Description

A two-level swimlane roadmap app that lets a product lead build, drill into, share (read-only), and export clean initiative/sprint timelines for teams, so roadmaps that take hours in Figma or Notion take minutes and stay interactive.

---

## 2. Problem Statement

### The Problem

Building the specific roadmap format this team uses — initiative swimlanes over months, with per-item weekly sprint breakdowns — is slow and dead-ended in general tools. Figma and Notion produce static artifacts: every date shift means redrawing bars; there is no drill-down from a roadmap bar to its sprint plan; sharing is all-or-nothing; and nothing is a database, so items can't be edited structurally or exported cleanly.

### Evidence

- **Quantitative:** A 5-initiative, 12-month roadmap with ~15 items and ~40 sprint items takes hours to draw and re-layout manually in Figma; every re-plan repeats a large share of that cost. Dedicated roadmap suites solve this but carry heavy overhead — feedback pipelines, prioritization engines, per-editor pricing — that this use case doesn't want.
- **Qualitative:** The purpose-built alternatives reviewed (Aha!, Productboard, Airfocus, Craft.io, monday dev, Jira Plans) all bundle roadmapping into larger product-management platforms; the lightweight ones (Roadmunk, ProductPlan, Office Timeline) are timeline-only without a native sprint-level drill-down per item. None match the exact two-level month→week model this team uses.

### Current Alternatives

Figma (static drawings, redraw on every change), Notion timeline view (single-level, weak stacking, no per-item subcalendar), spreadsheet Gantt hacks, or heavyweight PM suites (Aha!, Productboard — overkill, wrong data model, per-seat cost). All fall short on the two-level drill-down and on frictionless read-only sharing within the network.

---

## 3. Target User

### Primary Persona

| Attribute | Description |
|-----------|-------------|
| Name | The Product Lead (roadmap owner) |
| Role | PM / product lead at a PL Network company planning 3–12 month roadmaps |
| Goal | Build and maintain an initiative-swimlane roadmap with sprint-level drill-down, share it read-only with the team, export PDFs for decks |
| Pain Point | Roadmaps take forever to draw and re-draw in Figma/Notion; no interactivity or drill-down |
| Technical Level | Intermediate |

**Secondary persona — The Viewer:** a teammate or stakeholder whitelisted by email; needs to open the roadmap, drill into items, read sprint details, and download PDFs — strictly read-only.

### User Context

Desktop browser, inside the LabOS/PL Directory environment (starter-kit iframe embed). Owners work in planning sessions and re-plan mid-quarter; viewers open shared links during team syncs and exec reviews.

---

## 4. Solution Overview

### Value Proposition

The exact roadmap format the team already uses — as a live, editable, drillable app instead of a drawing. Direct manipulation (drag bars), instant re-layout, read-only sharing by email, PDF export at both levels, zero PM-suite baggage.

### Key Differentiators

1. **Two-level drill-down as the core model** — roadmap item (months) → sprint subcalendar (weeks) → detail card. Reviewed tools are single-level timelines or full backlog suites; none do this cleanly.
2. **Deliberately minimal** — no feedback voting, prioritization frameworks, dependencies, or comments. Swimlane + bars + drill-down, matching the "roadmap timelines show less task detail than Gantt, with detail one level down" pattern the format research converges on.
3. **Native to the PL environment** — LabOS auth, starter-kit deployment, PL design language, no new accounts for viewers.

### Design direction

Modern, interactive, professional. Base visual language on the starter kit's `pl-design-system` (Inter; brand blue `#1B4CFE`; white surfaces; near-black text) so it reads native to LabOS. Micro-animations are a first-class requirement: bar hover lift + tooltip, drag ghost + snap feedback, smooth zoom/slide transition into the item subcalendar, sprint-card slide-in from the right, subtle bar-entrance stagger on load, animated today-line pulse. Respect `prefers-reduced-motion`. Roadmap item bars each get a distinct color from a fixed accessible palette (deterministic assignment, cycling); all sprint item bars share one uniform color (per requirements 15–16).

---

## 5. Features (In Scope)

> **Agent Teams Note:** each feature is a self-contained unit assignable to one teammate. Requirements-traceability: the table below maps every one of the 19 original numbered requirements to a feature — none are dropped.

| Original req # | Requirement (abbreviated) | Feature |
|---|---|---|
| 1 | 1–5 named initiative rows on Y-axis | F-1 |
| 2 | Months on X-axis | F-1 |
| 3 | Roadmap item fields (title, desc, dates, milestone, OKRs, DRIs, Status G/Y/R, KPI) | F-2 |
| 4 | Only title shows; bar spans start→end | F-2 |
| 5 | Multiple items per row per month (stacking) | F-2 |
| 6 | Click item → weekly subcalendar over item's timeline, open Y-axis | F-3 |
| 7 | Sprint item fields (name, desc, dates, milestones, KPI, DRI) | F-4 |
| 8 | Multiple sprint items stacking per period | F-4 |
| 9 | Sprint bar shows title only, spans start→end | F-4 |
| 10 | Click sprint item → right-hand full-detail card | F-4 |
| 11 | Roadmap + sprint items saveable, editable, deletable | F-2, F-4 |
| 12 | Roadmap title, full dates covered, short description | F-1 |
| 13 | Per-user roadmaps; share via email whitelist input | F-6 |
| 14 | PDF download: roadmap view + each item's calendar | F-8 |
| 15 | Each roadmap item bar a different color | F-2 |
| 16 | All sprint bars same color | F-4 |
| 17 | LabOS auth per ai-app-starter-kit-v1.4 | F-5 |
| 18 | Login → last worked-on/visited roadmap | F-5 |
| 19 | Profile page: email, owned + viewer roadmaps, clickable | F-7 |

Clarified in review: bars support **drag-to-move and drag-to-resize** (both levels); whitelisted users are **strictly read-only**; milestones render as **text in details + optional dated diamond marker on the bar**. Additions approved in review: today line, auto-scroll to current month, delete-confirmation modals (F-9).

---

### Feature 1: Roadmap Canvas & Header

**Feature ID:** F-1 · **Priority:** P0 · **Estimated Complexity:** Medium

**Description:** The main roadmap view. Header holds roadmap title, full date range covered (3–12 months), and short description — all editable inline by the owner. Below it, the calendar grid: Y-axis split into 1–5 named initiative rows (owner can add, rename, reorder, delete rows up to 5); X-axis renders month columns spanning the roadmap's date range.

**User Flow:**
1. Owner creates a roadmap (title, description, start month, end month)
2. System validates range is ≥3 and ≤12 months and renders the empty grid with one default initiative row
3. Owner adds/renames initiative rows (up to 5)
4. Owner sees the labeled swimlane grid ready for items

**Behavior Specification:**
- **Trigger:** roadmap created or opened
- **Action:** system renders header + month columns from the stored date range + initiative rows in stored order
- **Result:** owner sees an editable swimlane canvas; viewer sees the identical canvas without edit affordances

**Acceptance Criteria:**
- [ ] AC-1.1: Given a new roadmap form, when the owner submits a range of 3–12 months with a title, then the roadmap is created and the grid renders one month column per month in range.
- [ ] AC-1.2: Given a roadmap with 5 initiative rows, when the owner tries to add a sixth, then the add control is disabled with a "max 5 initiatives" hint.
- [ ] AC-1.3: Given a date range of 2 months or 13 months, when submitted, then validation rejects with a clear inline error.
- [ ] AC-1.4: Given an initiative row is renamed, when saved, then the row label updates without page reload and persists.

**Error States:** invalid date range → inline validation, no save; initiative delete with items in it → blocked with message "move or delete this initiative's items first" (prevents orphaned items); network failure on save → toast + retry, form state preserved.

**Test Requirements:** Unit: range validation, ≤5 row constraint. Integration: create/update roadmap + initiative CRUD via API. E2E: create roadmap → add 5 rows → 6th blocked.

**Database Needs:** `roadmaps`, `initiatives` (see §9). **API Endpoints:** roadmap + initiative CRUD (see §9).

---

### Feature 2: Roadmap Items (bars, stacking, colors, drag, CRUD)

**Feature ID:** F-2 · **Priority:** P0 · **Estimated Complexity:** High

**Description:** Within any initiative row the owner adds roadmap items with: title, short description, start date, end date, milestone (text + optional milestone date), OKRs, DRIs, Status (Green/Yellow/Red), and KPI. On the calendar only the title shows, as a bar spanning start→end. Multiple items coexist per row per month — bars auto-stack into sub-lanes within the row (row height grows). Each roadmap item bar gets a distinct color (deterministic assignment from a fixed accessible palette; cycles past palette length). A small status dot (G/Y/R) sits on the bar; if a milestone date is set, a diamond marker renders on the bar at that date. Items are saveable, editable (modal form), and deletable (confirm modal). Owner can also drag a bar horizontally to move both dates, and drag either edge to resize; drops snap to day granularity and persist immediately with an undo-free confirm animation.

**User Flow:**
1. Owner clicks "+ item" in an initiative row (or double-clicks empty grid space at a month)
2. System opens the item form (start date pre-filled from click position)
3. Owner fills fields and saves
4. System renders the titled bar in the correct row between start and end dates, assigns its color, stacks it below any overlapping bars
5. Owner drags the bar (or its edge); system shows a ghost preview, snaps, saves, and animates the bar into place

**Behavior Specification:**
- **Trigger:** item create/edit/delete/drag
- **Action:** system validates dates fall within the roadmap range and start ≤ end; persists; recomputes stacking layout for the row
- **Result:** bar appears/moves/disappears with animation; tooltip on hover shows title, dates, status, DRIs

**Acceptance Criteria:**
- [ ] AC-2.1: Given a valid item, when saved, then a bar with only the title renders in its initiative row spanning start→end, in a color distinct from other items on the roadmap.
- [ ] AC-2.2: Given two items in the same row with overlapping dates, when rendered, then they stack in separate sub-lanes with no visual overlap and the row height expands.
- [ ] AC-2.3: Given an owner drags a bar's right edge one month right, when dropped, then the item's end date persists +1 month (day-snapped) and the bar re-renders; a viewer attempting any drag sees no drag affordance and no mutation occurs.
- [ ] AC-2.4: Given an item with a milestone date inside its span, when rendered, then a diamond marker appears on the bar at that date with the milestone text in its tooltip.
- [ ] AC-2.5: Given delete is clicked, when the confirm modal is accepted, then the item and all its sprint items are removed; when declined, nothing changes.
- [ ] AC-2.6: Given item dates outside the roadmap range or start > end, when saved or dropped from a drag, then validation rejects and the bar reverts.

**Error States:** drag drop failing server-side → bar animates back to origin + toast; milestone date outside item span → validation error; form save conflict → latest-write-wins with toast (single-owner editing keeps this rare).

**Test Requirements:** Unit: stacking algorithm (interval-overlap lane assignment), color assignment determinism, date validation. Integration: item CRUD + drag-update endpoint incl. viewer 403. E2E: create two overlapping items → stack; drag-resize persists; delete cascade.

**Database Needs:** `roadmap_items`. **API Endpoints:** item CRUD + PATCH for drag updates.

---

### Feature 3: Roadmap Item Drill-Down Subcalendar

**Feature ID:** F-3 · **Priority:** P0 · **Estimated Complexity:** Medium

**Description:** Clicking a roadmap item bar opens that item's subcalendar view: X-axis covers only the item's start→end timeline, broken into week columns (weeks start Monday; partial first/last weeks render as partial columns); Y-axis is open (no fixed rows — sprint bars stack freely into lanes as needed). The item's title, dates, description, status, milestone, OKRs, DRIs, and KPI render in a header strip. A back control (and breadcrumb) returns to the roadmap with a smooth transition.

**User Flow:**
1. User clicks a roadmap item bar
2. System animates a zoom/slide transition into the item subcalendar
3. User sees week columns spanning the item's timeline and the item's header details
4. User clicks back/breadcrumb → returns to the roadmap, scroll position preserved

**Behavior Specification:**
- **Trigger:** click on a roadmap item bar (click-vs-drag disambiguated: mousedown+move = drag, clean click = open)
- **Action:** system loads the item + its sprint items and renders the weekly grid
- **Result:** the item's dedicated calendar with stacked sprint bars

**Acceptance Criteria:**
- [ ] AC-3.1: Given an item spanning Mar 10 – May 20, when its subcalendar opens, then week columns cover exactly that span (partial edge weeks included) and no dates outside it.
- [ ] AC-3.2: Given the subcalendar is open, when the user clicks back, then the roadmap view restores with prior scroll position.
- [ ] AC-3.3: Given a drag gesture on a bar, when it ends, then the subcalendar does NOT open (drag ≠ click).

**Error States:** item deleted while subcalendar open (another session) → friendly "this item no longer exists" state with a back link; load failure → skeleton → retry state.

**Test Requirements:** Unit: week-column derivation from arbitrary date spans. Integration: item+sprints fetch. E2E: click-through, back-navigation, drag-vs-click disambiguation.

**Database Needs:** none new. **API Endpoints:** GET item with sprint items.

---

### Feature 4: Sprint Items (bars, stacking, detail card, CRUD)

**Feature ID:** F-4 · **Priority:** P0 · **Estimated Complexity:** High

**Description:** Within a roadmap item's subcalendar the owner embeds sprint items with: name, description, start date, end date, milestones (text + optional dated diamond marker, same pattern as F-2), KPI, and DRI. Multiple sprint items stack in any given period (same lane-stacking algorithm as F-2). On the calendar only the sprint item's name shows, as a bar spanning start→end; **all sprint bars share one uniform color**. Clicking a sprint bar opens a card view sliding in from the right-hand side showing the full sprint item information; the card includes Edit and Delete (confirm modal) for owners. Sprint items are saveable, editable, deletable, and support the same drag-to-move/resize as roadmap items, constrained to the parent item's timeline.

**User Flow:**
1. Owner clicks "+ sprint item" (or double-clicks the weekly grid)
2. System opens the sprint form; owner fills fields and saves
3. System renders the uniform-color bar with the name only, stacked as needed
4. User clicks a sprint bar → detail card slides in on the right with all fields
5. Owner edits or deletes from the card; viewer sees read-only card

**Behavior Specification:**
- **Trigger:** sprint create/edit/delete/drag/click
- **Action:** validate dates within the parent item's start→end; persist; restack
- **Result:** bar renders/moves; card shows name, description, dates, milestones, KPI, DRI

**Acceptance Criteria:**
- [ ] AC-4.1: Given a valid sprint item, when saved, then a bar with only its name renders across its dates in the uniform sprint color (identical for all sprint bars).
- [ ] AC-4.2: Given overlapping sprint items, when rendered, then they stack without overlap on the open Y-axis.
- [ ] AC-4.3: Given a sprint bar is clicked, when the card opens, then it displays every field (name, description, start, end, milestones, KPI, DRI) on the right-hand side; clicking outside or the close control dismisses it.
- [ ] AC-4.4: Given sprint dates outside the parent item's timeline (via form or drag), when submitted, then validation rejects and the bar reverts.
- [ ] AC-4.5: Given a viewer, when they click a sprint bar, then the card opens read-only with no edit/delete controls.

**Error States:** same drag-failure revert pattern as F-2; delete confirm modal; card load failure → inline retry.

**Test Requirements:** Unit: parent-span constraint, uniform color. Integration: sprint CRUD incl. viewer 403. E2E: create → stack → click card → edit → delete confirm.

**Database Needs:** `sprint_items`. **API Endpoints:** sprint CRUD + PATCH.

---

### Feature 5: LabOS Auth & Last-Roadmap Redirect

**Feature ID:** F-5 · **Priority:** P0 · **Estimated Complexity:** Medium

**Description:** Authentication uses the LabOS auth system exactly as specified by the AI App Starter Kit (v1.4): the app runs iframe-embedded from `*.plnetwork.io`, receives/validates the LabOS member token on the backend, and derives the user identity (member uid + email) from it. No separate signup, no Supabase Auth for identity — Supabase is the datastore only; all authorization is enforced in the app's API layer against the LabOS identity (see §9). On login, the user is taken directly to the roadmap they last worked on or visited (owner edits and viewer visits both update this pointer); a user with no history lands on their Profile page (F-7) with a "create your first roadmap" prompt.

**User Flow:**
1. User opens the app inside LabOS
2. System validates the LabOS token server-side and resolves the member identity
3. System looks up the user's last-visited roadmap and redirects to it
4. If none exists, system shows Profile with a create CTA

**Behavior Specification:**
- **Trigger:** app load / session start; every roadmap open updates `last_visited`
- **Action:** token validation → identity → redirect
- **Result:** the user is inside their most recent roadmap in one step

**Acceptance Criteria:**
- [ ] AC-5.1: Given a valid LabOS session, when the app loads, then the user lands on their last worked-on/visited roadmap without extra clicks.
- [ ] AC-5.2: Given an invalid/expired token, when any API is called, then it returns 401 and the UI shows the starter-kit standard re-auth prompt.
- [ ] AC-5.3: Given a first-time user, when the app loads, then they land on Profile with a create-roadmap CTA.
- [ ] AC-5.4: Given a user visits roadmap B after roadmap A, when they next log in, then they land on B.

**Error States:** last-visited roadmap deleted or access revoked → fall back to Profile with an explanatory toast (never a dead end).

**Test Requirements:** Unit: token validation middleware. Integration: 401 paths, last-visited update on open. E2E: login → redirect; revoked-roadmap fallback.

**Database Needs:** `user_state`. **API Endpoints:** `GET /api/me` (identity + last roadmap).

---

### Feature 6: Sharing via Email Whitelist (read-only)

**Feature ID:** F-6 · **Priority:** P0 · **Estimated Complexity:** Medium

**Description:** Each roadmap belongs to its creating user (owner). A Share button on the roadmap opens a panel with an input for approved emails: the owner adds/removes emails; anyone authenticated via LabOS whose email matches the whitelist can access the roadmap **strictly read-only** — they can view, drill down, open sprint cards, and download PDFs, but every mutation control is absent and every mutation endpoint rejects them. Email matching is case-insensitive against the LabOS-verified email. No public links.

**User Flow:**
1. Owner clicks Share
2. Panel opens listing current approved emails
3. Owner types an email, presses add; system validates format and appends
4. Whitelisted user opens the app → the roadmap appears in their Profile under "viewer on" and is directly accessible

**Behavior Specification:**
- **Trigger:** share panel add/remove; any roadmap access
- **Action:** persist whitelist; on access, authorize as owner OR whitelisted email OR reject
- **Result:** viewers get the full read experience, zero write surface

**Acceptance Criteria:**
- [ ] AC-6.1: Given an owner adds `teammate@company.com`, when that user (LabOS-authenticated with that email, any casing) opens the roadmap, then it renders read-only: no add/edit/delete/drag/share affordances anywhere, including subcalendars and cards.
- [ ] AC-6.2: Given a non-whitelisted authenticated user requests the roadmap by URL, when the API authorizes, then it returns 403 and the UI shows "you don't have access — ask the owner to share."
- [ ] AC-6.3: Given a viewer crafts a direct mutation request (any POST/PATCH/DELETE on the roadmap or its items/sprints/shares), when received, then the server rejects 403 — enforcement is server-side, not just hidden buttons.
- [ ] AC-6.4: Given the owner removes an email, when that user next loads the roadmap, then access is denied and it disappears from their Profile viewer list.
- [ ] AC-6.5: Given a malformed email is entered, when add is pressed, then inline validation rejects it.

**Error States:** duplicate email add → no-op with hint; owner adds own email → no-op with hint.

**Test Requirements:** Unit: email normalization/validation. Integration: full authorization matrix (owner/viewer/stranger × read/write endpoints). E2E: share → viewer read-only experience → revoke.

**Database Needs:** `roadmap_shares`. **API Endpoints:** share CRUD; authorization middleware on everything.

---

### Feature 7: Profile Page

**Feature ID:** F-7 · **Priority:** P1 · **Estimated Complexity:** Low

**Description:** A simple profile page showing the user's email, the roadmaps they own, and the roadmaps they're viewers on (via whitelist). Each roadmap in either list is clickable and navigates to that roadmap. Owned roadmaps show a create-new control and a delete control (confirm modal; deleting cascades items, sprints, shares).

**User Flow:**
1. User navigates to Profile (nav link, or first-login landing)
2. User sees email, "Roadmaps you own" list, "Shared with you" list
3. User clicks any roadmap → it opens (and becomes their last-visited)

**Acceptance Criteria:**
- [ ] AC-7.1: Given a user owns 2 roadmaps and is whitelisted on 1, when Profile loads, then both lists render correctly with titles and date ranges, and each navigates on click.
- [ ] AC-7.2: Given a roadmap is deleted from Profile (confirm accepted), then it, its items, sprints, and shares are removed and it vanishes from all viewers' Profiles.
- [ ] AC-7.3: Given empty lists, then friendly empty states render (create CTA / "nothing shared with you yet").

**Error States:** load failure → retry state.

**Test Requirements:** Integration: list queries by ownership + whitelist. E2E: profile navigation, cascade delete.

**Database Needs:** none new. **API Endpoints:** `GET /api/me/roadmaps`.

---

### Feature 8: PDF Export (roadmap + per-item calendars)

**Feature ID:** F-8 · **Priority:** P1 · **Estimated Complexity:** Medium

**Description:** The roadmap view can be downloaded as a PDF, and each roadmap item's weekly calendar can be downloaded as its own PDF. Export is available to owners and viewers. The PDF is a clean, print-fit landscape render of the calendar exactly as styled (header, initiative rows, colored bars with titles, milestone diamonds, status dots, today line) — not a raw screenshot of the viewport; wide ranges scale-to-fit one page width. Filenames: `{roadmap-title}.pdf` and `{roadmap-title}—{item-title}.pdf` (slugified).

**User Flow:**
1. User clicks "Download PDF" on the roadmap (or inside an item's subcalendar)
2. System renders the export layout and generates the PDF client-side
3. Browser downloads the file

**Acceptance Criteria:**
- [ ] AC-8.1: Given a populated roadmap, when Download PDF is clicked, then a landscape PDF downloads containing the header (title, dates, description) and the full grid with all bars, colors, and labels legible.
- [ ] AC-8.2: Given an item subcalendar, when its Download PDF is clicked, then the PDF contains that item's header details and its weekly calendar with all sprint bars.
- [ ] AC-8.3: Given a viewer, when they export, then it succeeds identically to the owner.

**Error States:** generation failure → toast with retry; very long titles truncate with ellipsis in bars but render fully in the header.

**Test Requirements:** Unit: filename slugification, scale-to-fit math. E2E: export triggers a download with non-zero size at both levels (Playwright download assertion).

**Database Needs:** none. **API Endpoints:** none (client-side generation; see §9).

---

### Feature 9: Timeline Polish — Today Line, Auto-Scroll, Delete Confirms

**Feature ID:** F-9 · **Priority:** P1 · **Estimated Complexity:** Low

**Description:** The three review-approved additions: (a) a vertical "today" line on both the roadmap (month grid) and every item subcalendar (week grid) whenever today falls within the visible range; (b) on opening a roadmap, auto-scroll horizontally so the current month is in view (no-op if the range fits or today is outside it); (c) all destructive actions (roadmap, initiative, item, sprint delete) use a confirm modal naming what will be removed, including cascade counts ("this will also delete 6 sprint items").

**Acceptance Criteria:**
- [ ] AC-9.1: Given today is within the roadmap range, when it renders, then a today line appears at the correct date position on both calendar levels; when outside, no line.
- [ ] AC-9.2: Given a 12-month roadmap wider than the viewport, when opened, then the view auto-scrolls to bring the current month into view.
- [ ] AC-9.3: Given any delete, when triggered, then a confirm modal states the target and cascade count and nothing is deleted until confirmed.

**Test Requirements:** Unit: today-position math, cascade-count query. E2E: today line renders; confirm-modal cancel leaves data intact.

**Database Needs:** none. **API Endpoints:** none new.

---

## 6. Out of Scope

- **NOT building** dependency lines/arrows between bars — this is a roadmap, not a Gantt chart.
- **NOT building** comments, @mentions, notifications, or any collaboration beyond read-only viewing.
- **NOT building** feedback collection, voting, prioritization scoring (RICE/WSJF), or backlog management — the deliberate anti-Productboard/Aha! stance.
- **NOT building** zoom/granularity toggles — the month/week two-level split is fixed by design.
- **NOT building** public share links — email whitelist only.
- **NOT building** editor-role sharing — viewers are strictly read-only in v1.
- **NOT building** version history or undo stacks — delete confirms are the safety net.
- **NOT building** mobile-optimized layouts — desktop-first; must not break on tablet but is not optimized for it.
- **NOT building** real-time multiplayer cursors/live sync — latest-write-wins is acceptable for single-owner editing.
- **NOT building** integrations (Jira, Linear, Slack) or CSV import/export — PDF export only.

---

## 7. User Flows

### Primary Flow: Build and share a roadmap

1. Owner logs in via LabOS; lands on last roadmap (or Profile if none)
2. Owner creates "H2 2026 Platform Roadmap," Jul–Dec 2026, adds 4 initiative rows
3. Owner double-clicks the grid in the "Onboarding" row at August; item form opens with start pre-filled
4. Owner fills title/description/dates/milestone/OKRs/DRIs/Status/KPI and saves
5. System renders the colored, titled bar; owner drags its edge to extend into September; change persists
6. Owner clicks the bar; subcalendar opens over the item's weeks
7. Owner adds 5 sprint items; bars stack in the uniform sprint color
8. Owner clicks a sprint bar; detail card slides in on the right; owner tweaks the KPI and saves
9. Owner returns to the roadmap, clicks Share, adds three teammate emails
10. Owner clicks Download PDF; the roadmap PDF downloads

### Secondary Flow: Viewer experience

1. Whitelisted teammate logs in; the shared roadmap appears under "Shared with you" on Profile
2. Viewer opens it; sees the identical roadmap with today line, no edit affordances
3. Viewer drills into an item, opens sprint cards (read-only), downloads the item's PDF
4. Next login, viewer lands directly on this roadmap (last visited)

### Tertiary Flow: Re-plan

1. Owner opens the roadmap (auto-scrolled to the current month)
2. Owner drags two bars right one month; stacking recomputes live
3. Owner deletes an obsolete item; confirm modal warns "also deletes 4 sprint items"; owner confirms

---

## 8. Success Metrics

| Metric | Target | Measurement Method |
|--------|--------|-------------------|
| Time to build a 4-initiative, 10-item roadmap | <15 min (vs. hours in Figma) | Timed dogfood session |
| Drag-edit persistence correctness | 100% of drops persist with correct dates | E2E suite + manual QA |
| Viewer access matrix | 0 unauthorized reads/writes | Authorization test matrix passing |
| PDF export success rate | ≥99% of attempts | Client error logging |
| Adoption (post-launch) | Owner + ≥3 viewers actively using ≥1 real roadmap in month 1 | Usage logs |
| Test coverage | ≥80% | `npm run test:coverage` |

---

## 9. Implementation Notes

### Recommended Tech Stack

| Component | Recommendation | Rationale |
|-----------|---------------|-----------|
| Deployment | PLN AI App Starter Kit contract: bind `$PORT` on `0.0.0.0`, expose `GET /health`, iframe-embeddable from `*.plnetwork.io`, secrets via LabOS draft flow, deploy via `deploy-to-labs` | User requirement (req 17); reconcile specifics against v1.4 (§11 Q1) |
| Database | **Supabase (PostgreSQL)** via `@supabase/supabase-js` with the service-role key server-side only | Explicit user requirement; persistent data across container restarts |
| Auth | **LabOS auth** per starter kit; backend middleware validates the LabOS token and resolves member uid + email | Req 17; no separate accounts |
| Authorization | App API layer (owner/whitelist checks on every route). Supabase RLS is NOT the enforcement layer because users are LabOS identities, not Supabase Auth users — the service-role connection bypasses RLS by design; never ship the anon key to the client for direct table access | Correctness under the LabOS identity model |
| Frontend | React + Vite (or Next.js if the starter kit template prefers), Tailwind CSS, `pl-design-system` tokens | Starter-kit native look |
| Calendar rendering | Custom CSS-grid/absolute-positioned bars (no Gantt library) — the layout is simple enough that a library adds weight and fights the design | Full control of stacking, drag, animation |
| Drag & drop | `@dnd-kit` or pointer-event handlers with day-snap math | Drag-to-move/resize requirement |
| Animation | CSS transitions + `framer-motion` for drill-down/card transitions; honor `prefers-reduced-motion` | "Small animations that make a professional app nice to use" |
| PDF export | Client-side: dedicated export layout rendered off-screen → `html2canvas`(scale ≥2) + `jspdf`, landscape, scale-to-fit; builder may substitute a cleaner vector approach (e.g., SVG→PDF) if quality is higher | Req 14 at both levels, no server render dependency |
| Testing | Vitest + Testing Library + Playwright | Multi-agent gates |

### Database Schema

```sql
-- All access via server-side service role; authorization enforced in the API layer.

CREATE TABLE roadmaps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_uid TEXT NOT NULL,            -- LabOS member uid
  owner_email TEXT NOT NULL,          -- normalized lowercase
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  start_month DATE NOT NULL,          -- first day of first month
  end_month DATE NOT NULL,            -- first day of last month
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT range_3_to_12_months CHECK (
    end_month >= start_month + INTERVAL '2 months'
    AND end_month <= start_month + INTERVAL '11 months')
);

CREATE TABLE initiatives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  roadmap_id UUID NOT NULL REFERENCES roadmaps(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  position SMALLINT NOT NULL,         -- 1..5; app enforces max 5 per roadmap
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (roadmap_id, position)
);

CREATE TYPE item_status AS ENUM ('green','yellow','red');

CREATE TABLE roadmap_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  roadmap_id UUID NOT NULL REFERENCES roadmaps(id) ON DELETE CASCADE,
  initiative_id UUID NOT NULL REFERENCES initiatives(id),
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  milestone_text TEXT DEFAULT '',
  milestone_date DATE,                -- optional; must fall within start..end (app-validated)
  okrs TEXT DEFAULT '',
  dris TEXT DEFAULT '',
  status item_status NOT NULL DEFAULT 'green',
  kpi TEXT DEFAULT '',
  color_index SMALLINT NOT NULL,      -- deterministic palette index
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK (end_date >= start_date)
);

CREATE TABLE sprint_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  roadmap_item_id UUID NOT NULL REFERENCES roadmap_items(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  milestone_text TEXT DEFAULT '',
  milestone_date DATE,
  kpi TEXT DEFAULT '',
  dri TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK (end_date >= start_date)
);

CREATE TABLE roadmap_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  roadmap_id UUID NOT NULL REFERENCES roadmaps(id) ON DELETE CASCADE,
  email TEXT NOT NULL,                -- normalized lowercase
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (roadmap_id, email)
);

CREATE TABLE user_state (
  user_uid TEXT PRIMARY KEY,          -- LabOS member uid
  last_roadmap_id UUID REFERENCES roadmaps(id) ON DELETE SET NULL,
  last_visited_at TIMESTAMPTZ DEFAULT NOW()
);
```

Notes: bar stacking lanes are computed client-side (interval-graph greedy assignment), never stored. `color_index` assigned at create time as `count(existing items on roadmap) % palette_length`.

### API Endpoints

All routes behind LabOS-token middleware. `read` = owner or whitelisted email; `write` = owner only. No PII in URLs or query strings.

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | /health | none | Starter-kit health check |
| GET | /api/me | token | Identity + last-visited roadmap id |
| GET | /api/me/roadmaps | token | Owned + shared-with-me lists (Profile) |
| POST | /api/roadmaps | token | Create roadmap |
| GET | /api/roadmaps/:id | read | Roadmap + initiatives + items (updates user_state) |
| PATCH | /api/roadmaps/:id | write | Update header fields |
| DELETE | /api/roadmaps/:id | write | Cascade delete (confirm client-side) |
| POST | /api/roadmaps/:id/initiatives | write | Add row (server enforces ≤5) |
| PATCH | /api/initiatives/:id | write | Rename/reorder |
| DELETE | /api/initiatives/:id | write | Blocked if items exist |
| POST | /api/roadmaps/:id/items | write | Create roadmap item |
| PATCH | /api/items/:id | write | Edit / drag-move / drag-resize |
| DELETE | /api/items/:id | write | Cascade sprints |
| GET | /api/items/:id | read | Item + sprint items (subcalendar) |
| POST | /api/items/:id/sprints | write | Create sprint item |
| PATCH | /api/sprints/:id | write | Edit / drag |
| DELETE | /api/sprints/:id | write | Delete |
| GET | /api/roadmaps/:id/shares | write | List whitelist |
| POST | /api/roadmaps/:id/shares | write | Add email |
| DELETE | /api/shares/:id | write | Remove email |

### Key Implementation Considerations

- **Authorization matrix is the security core:** one middleware resolves `{role: owner | viewer | none}` per roadmap and every route declares its required role; test the full matrix.
- **Drag math:** px→date conversion off the rendered grid scale; snap to day; optimistic UI with server confirm and revert-on-failure.
- **Stacking:** sort items by start date, greedily assign each to the lowest lane with no overlap; row height = lanes × lane-height. Same function reused for sprint items.
- **Click vs. drag disambiguation** on bars (movement threshold ~4px) so drill-down and drag coexist.
- **Deterministic colors:** fixed 10-color accessible palette (distinct hues, AA contrast for white bar text) assigned by `color_index`; sprint bars use one neutral brand tone distinct from all palette entries.
- **PDF layout is a dedicated render**, not a viewport screenshot: fixed landscape dimensions, legible minimum font sizes, full title in header even when truncated on bars.
- **Secrets** (Supabase URL + service key) via the LabOS draft-secrets flow per the starter kit; never in the client bundle or repo.
- **Emails normalized lowercase** at write and compare time; no emails in URLs, logs, or client payloads beyond the owner's own share panel.
- **Iframe embedding:** correct `frame-ancestors` for `*.plnetwork.io`; no reliance on third-party cookies.

---

## 10. Claude Code Execution

Agent Teams is recommended (9 features). Task tool is the fallback.

### Option A: Agent Teams (Recommended)

Enable: `export CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` (or `settings.json` env).

Setup prompt — copy into Claude Code:

```
Read the PRD at PRD-Roadmapper-v1.md. Build it with an Agent Teams workflow.

BEFORE ANY CODE:
1. Create TeamWork.md in the project root from the template in Section 10.
2. Copy agent definitions to .claude/agents/ (db-builder, test-writer, backend-builder,
   frontend-builder, integrator).
3. RECONCILE THE STARTER KIT: read ai-app-starter-kit-v1.4 (ask the user for it if not in
   the repo). Confirm: LabOS token validation pattern, $PORT/0.0.0.0/GET /health contract,
   iframe/frame-ancestors requirements, secrets flow, deploy-to-labs steps, and any
   template/framework preference. Record findings in TeamWork.md. The DATABASE IS SUPABASE
   regardless of any starter-kit default — this is an explicit product decision.

TEAM LEAD (you): coordinate, enforce gates, run the checklist, own TeamWork.md.
Use delegate mode; do not write feature code.

TEAMMATES:
- db-builder: Supabase schema/migrations from Section 9 (constraints, cascades, enum)
- test-writer: tests FIRST from every AC (TDD); owns the AC→test map; includes the full
  owner/viewer/stranger authorization matrix and viewer-403 tests for every write route
- backend-builder: Express/Node API per Section 9 endpoint table; LabOS auth middleware;
  role middleware; no PII in URLs/logs
- frontend-builder: roadmap canvas, stacking, drag-to-move/resize, drill-down subcalendar,
  sprint cards, share panel, profile, PDF export, today line + auto-scroll + confirm
  modals; pl-design-system look; micro-animations with prefers-reduced-motion support
- integrator: wire UI to real APIs, remove mocks, E2E

EXECUTION PHASES (hard gates):
Phase 1 — Foundation: db-builder (schema) + test-writer (failing tests incl. auth matrix).
  GATE: npm run test:db.
Phase 2 — Core: backend-builder (all routes + middleware) + frontend-builder (canvas,
  items, subcalendar, sprints against mocks) + test-writer.
  GATE: npm run test:api && npm run test:components. The authorization matrix must be
  fully green before this gate passes.
Phase 3 — Integration: integrator + test-writer (E2E per Section 7 flows, incl. drag
  persistence, viewer read-only pass, PDF download assertions, delete-confirm cancel).
  GATE: npm run test:e2e.
Phase 4 — Validation: test:all, coverage >= 80%, every AC passing, /health responds,
  app binds $PORT on 0.0.0.0, verify locally then deploy via deploy-to-labs (never print
  the deploy token or URL).

CRITICAL RULES:
- Every AC needs a passing mapped test before its gate clears.
- Server-side enforcement for viewer read-only — hidden buttons are not authorization.
- Bars: roadmap items each a distinct palette color; ALL sprint bars one uniform color;
  bars show titles only; details live in forms/cards.
- Sprint dates constrained to the parent item's span; item dates to the roadmap's span;
  roadmap span 3–12 months; max 5 initiatives (server-enforced).
- Update TeamWork.md on every start/complete/blocker; do not cross a failing gate.
```

#### TeamWork.md Template

```markdown
# TeamWork — Roadmapper

> Single source of truth. Every agent updates this on start / complete / blocker.

## Project Status
| Field | Value |
|-------|-------|
| PRD | PRD-Roadmapper-v1.md |
| Current Phase | 1 — Foundation |
| Starter-kit reconciliation | pending (v1.4 findings go here) |
| Started / Last Updated | [timestamps] |

## Feature Progress
| Feature ID | Name | DB | API | UI | Tests | Integration | Status |
|-----------|------|----|-----|----|-------|-------------|--------|
| F-1 | Roadmap canvas & header | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | Not Started |
| F-2 | Roadmap items | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | Not Started |
| F-3 | Drill-down subcalendar | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | Not Started |
| F-4 | Sprint items & card | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | Not Started |
| F-5 | LabOS auth & redirect | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | Not Started |
| F-6 | Email-whitelist sharing | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | Not Started |
| F-7 | Profile page | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | Not Started |
| F-8 | PDF export | ⏳ | — | ⏳ | ⏳ | ⏳ | Not Started |
| F-9 | Today line / auto-scroll / confirms | — | — | ⏳ | ⏳ | ⏳ | Not Started |
Legend: ⏳ Pending · 🔄 In Progress · ✅ Done · ❌ Failed · 🚫 Blocked

## Phase Gates
| Phase | Gate Check | Result | Timestamp |
|-------|-----------|--------|-----------|
| 1 Foundation | npm run test:db | ⏳ | - |
| 2 Core | npm run test:api && npm run test:components (auth matrix green) | ⏳ | - |
| 3 Integration | npm run test:e2e | ⏳ | - |
| 4 Validation | test:all + coverage ≥80% + all ACs + /health + deploy | ⏳ | - |

## Activity Log
- [ts] team-lead: Initialized. Starting Phase 1.

## Blockers & Issues
| Issue | Reported By | Status | Resolution |
|-------|-----------|--------|------------|
| (none) | - | - | - |

## Acceptance Criteria → Test Mapping
| AC ID | Criterion (short) | Test Type | Test File | Status |
|-------|-------------------|-----------|-----------|--------|
| AC-1.1..1.4 | Canvas & range/row rules | Unit/Integration | /tests/api/roadmaps.test.ts | ⏳ |
| AC-2.1..2.6 | Items, stacking, drag, colors | Unit/Int/E2E | /tests/*/items.* | ⏳ |
| AC-3.1..3.3 | Subcalendar weeks & nav | Unit/E2E | /tests/*/subcal.* | ⏳ |
| AC-4.1..4.5 | Sprints, uniform color, card | Int/E2E | /tests/*/sprints.* | ⏳ |
| AC-5.1..5.4 | Auth & last-visited redirect | Int/E2E | /tests/*/auth.* | ⏳ |
| AC-6.1..6.5 | Authorization matrix | Integration | /tests/api/authz.test.ts | ⏳ |
| AC-7.1..7.3 | Profile lists & cascade | Int/E2E | /tests/*/profile.* | ⏳ |
| AC-8.1..8.3 | PDF downloads both levels | E2E | /tests/e2e/pdf.spec.ts | ⏳ |
| AC-9.1..9.3 | Today line / scroll / confirms | Unit/E2E | /tests/*/polish.* | ⏳ |
```

### Option B: Task Tool (Fallback)

```
Implement PRD-Roadmapper-v1.md with the Task tool.
1. Create TeamWork.md from Section 10; verify .claude/agents/ has the five subagent files.
2. Reconcile ai-app-starter-kit-v1.4 first (as in Option A step 3); Supabase is the DB.
3. Phase 1: parallel @database-builder (Section 9 schema → /supabase/migrations/) and
   @test-writer (failing tests from Section 5 ACs incl. the authorization matrix).
   Gate: npm run test:db.
4. Phase 2: parallel @backend-builder (Section 9 routes + LabOS/role middleware),
   @frontend-builder (Sections 5+7 UI against mocks), @test-writer. 
   Gate: npm run test:api && npm run test:components.
5. Phase 3: parallel @integrator (wire, de-mock) + @test-writer (E2E per Section 7).
   Gate: npm run test:e2e.
6. Phase 4: test:all, coverage ≥80%, every AC passing, /health + $PORT verified,
   deploy via deploy-to-labs (never print token/URL). Update TeamWork.md throughout.
```

### Feature-to-Agent Mapping

| Feature | DB | API | UI | Tests | Integration |
|---------|----|-----|----|-------|-------------|
| F-1 Canvas | roadmaps, initiatives | roadmap+initiative CRUD | header, grid, rows | unit/int/E2E | wire |
| F-2 Items | roadmap_items | item CRUD+PATCH | bars, stack, drag, colors, milestones | all + drag E2E | wire |
| F-3 Subcalendar | — | GET item+sprints | week grid, transitions | unit/E2E | wire |
| F-4 Sprints | sprint_items | sprint CRUD+PATCH | bars, card, uniform color | all | wire |
| F-5 Auth | user_state | /api/me, middleware | redirect, re-auth state | int/E2E | wire |
| F-6 Sharing | roadmap_shares | share CRUD, role middleware | share panel | authz matrix | wire |
| F-7 Profile | — | /api/me/roadmaps | lists, empty states | int/E2E | wire |
| F-8 PDF | — | — | export layout + generation | E2E download | — |
| F-9 Polish | — | — | today line, scroll, confirms | unit/E2E | — |

---

## 11. Open Questions

| # | Question | Status | Answer |
|---|----------|--------|--------|
| 1 | **ai-app-starter-kit-v1.4 reconciliation:** this PRD is written against the known starter-kit contract ($PORT/0.0.0.0, GET /health, *.plnetwork.io iframe, LabOS secrets flow, deploy-to-labs) from the pln-directory-portal repo. The v1.4 doc (on Bill's desktop) must be read at build start to confirm the exact LabOS token-validation pattern and any template preference. Supabase remains the DB regardless. | Open | - |
| 2 | Whitelist matching: emails are matched against the LabOS-verified email. If members have multiple emails in LabOS, does the primary suffice, or should matching accept any verified address? | Open | Default: primary email; revisit if viewers report access failures |
| 3 | Sprint items intentionally have **no Status (G/Y/R)** field — per the original spec, status exists on roadmap items only. Confirm this is intended (kept as-specified; not added, not dropped). | Open | - |
| 4 | Practical stacking ceiling: no hard limit on items per row; if a row exceeds ~6 lanes, is a soft warning wanted, or let rows grow indefinitely? | Open | Default: grow indefinitely |
| 5 | PDF fidelity bar: is scale-to-fit single-page-width acceptable for 12-month roadmaps, or is multi-page tiling preferred for legibility? | Open | Default: scale-to-fit |
| 6 | Does v1.4 impose framework constraints (e.g., a Next.js template) that override the React+Vite recommendation? | Open | Resolved at Q1 reconciliation |

---

## 12. Timeline & Phases

### Phase 1: Foundation (schema + auth skeleton)
- [ ] Starter-kit v1.4 reconciliation recorded in TeamWork.md
- [ ] Supabase schema + migrations (F-1/F-2/F-4/F-5/F-6 tables)
- [ ] Failing test suite from all ACs, incl. authorization matrix

### Phase 2: Core (API + UI against mocks)
- [ ] All Section 9 endpoints + LabOS/role middleware (F-5, F-6 server side)
- [ ] Roadmap canvas, item bars/stacking/drag/colors (F-1, F-2)
- [ ] Drill-down subcalendar + sprint bars/card (F-3, F-4)

### Phase 3: Integration
- [ ] De-mocked end-to-end flows; share panel + profile (F-6 UI, F-7)
- [ ] PDF export both levels (F-8); polish set (F-9)
- [ ] E2E suite green

### Phase 4: Validation & Deploy
- [ ] Coverage ≥80%; all ACs passing; /health + $PORT verified
- [ ] Deploy via deploy-to-labs; dogfood the H2 2026 roadmap

---

## Appendix

### Glossary

| Term | Definition |
|------|------------|
| Roadmap | A user-owned 3–12 month calendar with 1–5 initiative rows and a title/dates/description header. |
| Initiative | A named Y-axis swimlane row on the roadmap (max 5). |
| Roadmap item | A bar in an initiative row (title-only on the calendar) with full fields behind it; each a distinct color. |
| Sprint item | A bar inside a roadmap item's weekly subcalendar (name-only; uniform color); details open in a right-hand card. |
| Subcalendar | The per-item drill-down view: week columns spanning exactly the item's timeline, open Y-axis. |
| Viewer | A LabOS user whose email is whitelisted on a roadmap; strictly read-only, incl. PDF export. |
| Starter-kit contract | `$PORT` / `0.0.0.0` / `GET /health` / iframe-embeddable from `*.plnetwork.io` / secrets via LabOS draft flow / deploy via `deploy-to-labs`. |
| Today line | Vertical marker at the current date on both calendar levels when in range. |

### References

- ai-app-starter-kit-v1.4 (Bill's desktop — required reading at build start; see §11 Q1)
- `memser-spaceport/pln-directory-portal` — LabOS auth patterns and `pl-design-system` assets (prior PRD sessions)
- Tool research pass (July 2026): Aha!, Productboard, Roadmunk, ProductPlan, Airfocus, Craft.io, Linear, Jira Plans/Product Discovery, Asana Timeline, monday dev, Notion, Visor, Miro, Office Timeline — informed the swimlane-timeline conventions, the today-line/auto-scroll additions, and the deliberate exclusion of feedback/prioritization/dependency features
- PRD precedents: `PRD-PLN-DecisionCouncil-v1.md`, PLAA Web App PRD (Agent Teams structure)
