---
version: 1
slug: "studio"
primary_target: "studio"
related_targets: ["studio/public-app.js","studio/ui/main.jsx"]
---

# Studio

## Mode

Operate

## Scope

`/studio/`, `studio/public-app.js` and the React editor. Related source: `studio/ui/`, `studio/instrument*.css` and shared layout.

## Task and composition

Import prepared artwork, place and adjust it on a body reference, compare studies and export a reference. Preserve the framed body display, study/save/history rail, Composition/Artwork/Body inspector and camera keys. The phone equivalent is the three-stop controls sheet, with a measured clear preview area.

## Constraints

Preserve the chosen Instrument world, concise control copy, local persistence, undo/redo, visible save recovery, exact numeric entry and a single canvas lifecycle. Theme changes are presentation-only. Export and backup remain distinguishable. The preview remains approximate.

## Evidence and open decisions

`docs/images/placement.jpg`, `body-controls.jpg` and `mobile.jpg` show the implemented Instrument editor with original demo art; verify layout against current CSS. No redesign or new workflow is specified by this brief.
