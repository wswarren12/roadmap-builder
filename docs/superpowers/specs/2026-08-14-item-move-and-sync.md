# Item moves + cross-roadmap synced import — 2026-08-14

**F-15a: move item between initiatives from the edit modal (everywhere).**
The roadmap-view modal already offers the full initiative dropdown and
`PATCH /api/items/[id]` already applies `initiativeId` moves. Gap: the
drill-down's edit modal receives only the item's own initiative.

**F-15b: "Import from other roadmap".** A secondary button at the top of the
item create/edit modal imports an item (plus its sprints) from another
roadmap the member can read. Imported copies stay **synced forever** via a
shared `sync_group_id` (migration 008): content edits to any copy propagate
to all copies; sprints sync the same way (their own group ids). Per-roadmap
placement (`initiativeId`, `colorIndex`) does NOT propagate. Deleting a copy
removes only that roadmap's copy; deleting a sprint removes it from every
copy (sprints are item content).

```gherkin
Scenario: Move an item to another initiative from the drill-down
  Given item I sits in initiative "Onboarding" and the roadmap has "Growth"
  When the member opens I's drill-down, edits it, and selects "Growth"
  Then the roadmap view shows I's bar in the "Growth" row

Scenario: Import an item from another roadmap
  Given member M can WRITE roadmap A (item I with 2 sprints) and roadmap B
  When M clicks "Import from other roadmap" in B's item modal, picks A then I
  Then B gains an item identical to I (title, dates, DRI, sprints, …)
  And both copies share a sync_group_id; each sprint pair shares one too

Scenario: Read access on the source is not enough (security)
  Given member V is only a viewer of roadmap A but owns roadmap B
  When V tries to import A's item into B
  Then the import is rejected 403 — a link is a two-way edit channel, so
  creating one is a write operation on BOTH roadmaps (otherwise a viewer
  could edit A's items through their own copy)

Scenario: Edits propagate to every linked copy
  Given linked copies I_A and I_B
  When anyone updates I_A's title, dates, status, DRI, or a sprint
  Then I_B reflects the same change on next load
  And moving I_A to another initiative does NOT move I_B

Scenario: Sprint create/delete propagate
  When a sprint is added to I_A
  Then an identical linked sprint appears under I_B
  When that sprint is deleted from I_B
  Then it disappears from I_A too

Scenario: Deleting a copy is local
  When I_B is deleted
  Then I_A and its sprints are untouched

Scenario: Import guards
  Import fails 400 when I's dates fall outside B's range,
  400 when the target initiative isn't B's, 403/404 when M can't read A.
```

Out of scope: conflict resolution (last write wins — single store), syncing
via agent editor links is included automatically (they use the same wrappers),
un-linking copies.
