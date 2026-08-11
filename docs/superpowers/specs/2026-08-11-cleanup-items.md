# Cleanup batch — 2026-08-11

Seven member-requested fixes. Data model: migration 007 adds
`initiatives.description` and `roadmap_items.responsible_team`.

```gherkin
Scenario: Copy buttons work inside the LabOS iframe
  Given the app runs in a cross-origin iframe where navigator.clipboard is blocked
  When the owner clicks Copy (invite link or agent link)
  Then the URL lands on the clipboard via the execCommand fallback
  And the button shows "Copied ✓"

Scenario: Roadmap description grows with content
  Given a roadmap description of several hundred words
  When the roadmap loads or the owner types
  Then the description textarea grows to fit — no inner scrollbar

Scenario: Initiative names wrap
  Given an initiative named longer than the label column
  Then the full name wraps onto multiple lines instead of truncating

Scenario: Initiative short description
  Given an editor on the roadmap view
  When they type a description under an initiative name and blur
  Then PATCH /api/initiatives/[id] persists it and it reloads with the page
  And viewers see it read-only

Scenario: Label copy
  Then the item form and drill-down say "DRI" (was "DRIs") and "Key Results" (was "OKRs")

Scenario: Responsible team on items
  Given the item form
  Then a "Responsible team" input sits under the DRI row
  When saved, GET /api/items/[id] returns responsibleTeam and the drill-down
  shows a "Responsible team" field under DRI

Scenario: DRI initials contrast
  Then initials avatars render PL-blue circles with white border and white initials
```
