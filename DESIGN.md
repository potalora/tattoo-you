---
name: tattoo you — Instrument
description: A framed body preview with a solid, precise control deck.
colors:
  accent: "#e65e27"
  instrument-blue: "#276783"
  instrument-green: "#46704b"
  danger: "#942f22"
  bg: "#dedfd9"
  panel: "#f2f2ec"
  paper: "#fafaf5"
  text: "#232720"
  muted: "#60675b"
  line: "#b0b5ab"
  edge: "#89937c"
  instrument-recess: "#cdd0c8"
typography:
  display:
    fontFamily: "IBM Plex Sans, Helvetica Neue, Helvetica, Arial, sans-serif"
    fontSize: "clamp(72px, 12.3vw, 164px)"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.075em"
  title:
    fontFamily: "IBM Plex Sans, Helvetica Neue, Helvetica, Arial, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: "IBM Plex Sans, Helvetica Neue, Helvetica, Arial, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "IBM Plex Sans, Helvetica Neue, Helvetica, Arial, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.5
  mono:
    fontFamily: "SFMono-Regular, Consolas, Liberation Mono, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.4
rounded:
  control: "4px"
  button: "5px"
  surface: "6px"
  frame: "7px"
spacing:
  compact: "4px"
  small: "8px"
  control: "12px"
  panel: "16px"
  workspace: "18px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "#11160e"
    rounded: "{rounded.button}"
    padding: "8px 12px"
  button-secondary:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.text}"
    rounded: "{rounded.button}"
    padding: "8px 12px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    rounded: "{rounded.button}"
    padding: "8px 12px"
  button-export:
    backgroundColor: "{colors.text}"
    textColor: "{colors.panel}"
    rounded: "{rounded.control}"
  field:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "10px 11px"
  inspector-tab-selected:
    backgroundColor: "{colors.text}"
    textColor: "#f5f6f0"
    padding: "9px 5px"
  artwork-card:
    backgroundColor: "#e5e8dd"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
---

# Design System: tattoo you — Instrument

## Overview

**Creative North Star: "Instrument"**

The established interface is a framed display beside a solid control deck. Putty surfaces, dark text and small state accents support precise adjustment while the body and artwork occupy the viewing area. This records the chosen implementation; it does not introduce a new visual concept.

The public pages share the type and palette but use larger type and a reading grid. Route-specific intent belongs in the surface briefs. Glass remains a compatibility presentation at `?theme=glass`; its translucent surfaces do not define Instrument.

**Key Characteristics:**

- Opaque putty panels with thin, visible boundaries.
- IBM Plex Sans with monospaced measurements.
- Recessed preview, compact control geometry and restrained state color.

Source: `studio/instrument.css`, `studio/instrument-controls.css`, shared `studio/studio.css`, `studio/ui/` and `public/site.css`. Original captures in `docs/images/` confirm desktop and phone composition; current source remains normative.

## Colors

Warm orange and functional blue/green sit within a muted, slightly green neutral field. Values in frontmatter are the canonical extracted tokens; not every component's state tint is a reusable token.

### Primary

- **Orange accent** (`accent`): primary actions, selected inspector underline and selected layer edge.

### Secondary

- **Instrument blue** (`instrument-blue`): active camera/focus controls, highlighted options and visible keyboard focus.
- **Instrument green** (`instrument-green`): confirmed saved status.
- **Danger red** (`danger`): destructive actions and storage/error emphasis.

### Neutral

- **Putty background** (`bg`): page and application surround.
- **Panel putty** (`panel`): solid inspector, rail and popup surfaces.
- **Paper** (`paper`): inset fields and artwork preview paper.
- **Dark ink** (`text`): text, selected tabs, slider thumbs and export action.
- **Muted ink** (`muted`): supporting labels and guidance.
- **Divider** (`line`) and **edge** (`edge`): fine boundaries between usable regions.
- **Recess** (`instrument-recess`): preview surround and pressed control depth.

**The State Color Rule.** Retain distinct selected, focus, saved and error treatments; color must accompany labels, icons, borders or control semantics.

## Typography

**Display Font:** IBM Plex Sans, with Helvetica Neue, Helvetica, Arial and sans-serif fallbacks.
**Body Font:** the same stack, locally served.
**Label/Mono Font:** SFMono-Regular, Consolas, Liberation Mono and monospace for measurements and technical status.

### Hierarchy

- **Display:** frontmatter display role is the public homepage title only; at narrow widths it uses a smaller responsive clamp.
- **Title:** compact panel headings use the frontmatter title role. Stage title uses medium weight; dialogs use a larger title (22px, weight 500, line height 1.3).
- **Body:** editor baseline follows the body role. Public explanatory copy is larger (18px, line height 1.65, maximum 66ch; 17px on phones).
- **Label:** compact field labels follow the label role. Guidance uses regular weight. Phone text, search, numeric and select controls use readable input type (16px).
- **Mono:** exact values use tabular numerals; stage metadata uses a smaller measurement line (11px).

Task feedback uses 13px text. Storage scope, layer measurements, fit guidance and phone camera labels use 12px. Allow feedback to wrap; the preview frame reserves the measured height of the feedback and camera controls.

**The Task Scale Rule.** Keep large public-page typography out of editing controls. Long study and artwork names must wrap without displacing actions.

## Layout

The desktop editor uses a study/history/comparison/reference rail, a recessed viewing stage and a separately scrolling right control deck. The standard deck is fixed width (340px), reduced on tablet (310px). Outer clearance follows the workspace spacing token; the stage-to-deck gap is compact (14px). Adjust, Tattoos and Body have distinct surfaces; Add opens the artwork library. Panels retain their state while hidden. The study name has one visible home in the selector.

At phone width (700px and below), the rail stays in one compact row and controls become a bottom deck with collapsed, normal and expanded stops. The dedicated handle alone owns dragging; the live animated sheet height determines the unobscured viewing area. Short landscape (height 500px and below) restores a side inspector. Short portrait retains a genuine sheet with distinct stops. Preserve safe-area clearance and the measured recovery-header allowance.

The selected-tattoo header identifies the current selection and its lock scope. Desktop shows exact Width and Rotation followed by placement and deeper adjustments. Phones use tactile Place / Size / Rotate / View / More keys and expose one active tool. The Tattoos surface is always reachable without scrolling past those properties. One shared explanation describes group edits and locked scope. New alternatives start with `Copy` or `Copy 2`; existing names stay intact.

Reserve an 82px column for exact numeric entry and 8px between the field, slider and validation rows so their focus outlines remain separate. Phone save feedback occupies a second line beneath the study name, including its state and browser scope. Mixed selections keep editable controls first and place the optional, counted unlock action after their scope explanation.

Empty studies offer Reference → Artwork → Placement. Body source, anatomy and starting profile precede fine proportion controls. Import focuses the tattoo in Detail. Orbit, Detail and an Angles selector form a compact camera bank. Comparison and reference review use solid, focused work surfaces: paired A/B captures on desktop, a same-size A/B switch on phones, and the exact reference PNG with download/return actions.

Reference inspection opens at 100%, with Fit, stepped zoom and native scrolling supplemented by mouse dragging. Image pixels are never re-encoded by inspection. The download/return footer and its persistent confirmation stay outside the scrolling content. Short screens allow internal scrolling to reach the full image area and guidance.

Public pages use a centered shell (maximum 1440px), generous outer gutters and heading/copy rows. These collapse to one column at 600px. They share materials and type, not the editor's fixed-canvas layout.

## Elevation & Depth

Instrument is opaque and tactile, with a clear Teenage Engineering influence. Tonal recesses and thin borders establish the display and fields. Solid control decks and raised keys are part of the identity, not disposable chrome. Buttons have shallow inset highlights and a small lower edge; pressed states become inset. Menus and dialogs use a modest soft shadow without backdrop blur. Structural simplification must retain this physical character.

### Shadow Vocabulary

- **Control edge** (`inset 0 1px 0 #ffffffb3, 0 1px 0 #23272024`): ordinary raised control.
- **Pressed control** (`inset 0 1px 2px #23272026`): active press.
- **Popup** (`0 6px 18px #23272024, 0 1px 2px #23272024`): portaled menu and dialog separation.

## Shapes

Thin bordered rectangles with modest rounding define the system. Controls use the small radius vocabulary; stage and inspector frames are slightly softer. Slider thumbs are compact upright rectangles, not circular decoration. Native checkboxes and the phone sheet handle retain their recognizable affordances. There is no pill-based global shape system.

## Components

### Buttons

Compact, tactile and clearly labeled. Secondary and ghost variants follow the frontmatter; primary is orange. Export is a distinct dark action. Targets generally retain minimum height (44px); icon actions preserve accessible names. Hover changes surface and border; active states press inward. Disabled controls use explicit muted colors rather than vanishing. Visible focus is blue (2px outline, 3px offset). Touch feedback uses a small spring scale, disabled under reduced motion.

### Inputs / Fields

Paper-colored inset fields have thin borders, the control radius and an extremely shallow inset shadow. Hover strengthens the border; focus uses the same visible blue outline. Exact numeric entry accompanies sliders. Invalid draft values restore the previous valid value with a visible message; drafts must not enter history.

### Navigation

Inspector tabs are solid keys: pale at rest, dark when selected with an orange lower edge. Camera keys select in blue. Select menus and dialogs retain Base UI keyboard, typeahead and focus behavior. Public navigation uses text links with visible focus and a dark studio entry action.

Study actions closes on Escape and restores focus to its trigger. An outside pointer closes it while leaving focus with the destination control.

### Cards / Containers

Artwork cards are bordered putty rectangles with paper previews and separate, always visible add actions. Collection rows use a tinted selected state and a thin complete boundary; their actions remain reachable by touch and keyboard. Panels, dialogs and menus use the solid surface vocabulary. Do not turn informational rows into decorative floating cards.

### Range Controls and Sheet

Sliders pair a rectangular ink thumb with an exact value field and unit. Retain the full input hit area (44px). The mobile sheet has a dedicated grip and explicit control toggle; its animation and viewport measurement must stay coordinated. Layer Actions stays within the scrolling inspector.

## Do's and Don'ts

### Do:

- **Do** preserve the Instrument font, palette and modest framed geometry.
- **Do** retain visible selection, focus, save recovery and accessible labels at every size.
- **Do** verify narrow, short portrait, short landscape, long-content, expanded-sheet and error states.
- **Do** use original demo artwork for public captures and preserve actual body lighting and material setup.

### Don't:

- **Don't** replace the chosen world with glass, decorative gradients or a new typography system during refinement.
- **Don't** hide essential controls behind hover or clip long labels and recovery messages.
- **Don't** let presentation changes reset studies, undo history, panel state or the Three.js canvas.
- **Don't** remove reduced-motion, forced-color or opaque accessibility treatments.
