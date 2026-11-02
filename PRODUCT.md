# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

People exploring tattoo placement before discussing the final fit with their tattoo artist. The app accepts their own prepared artwork; the downloaded reference supports that conversation.

## Product Purpose

**tattoo you** lets someone try artwork on 3D body references, adjust placement and scale, compare arrangements, and download a PNG reference. Success is a useful placement study. The preview is approximate; final fit must be confirmed on the person's body with their artist.

## Positioning

The implemented mechanism is an editable 3D placement study with reusable artwork, multiple tattoos and browser-local persistence. No comparative superiority, adoption or professional endorsement claim has been established.

## Operating Context

The public static app opens at `/studio/`. Import a tightly cropped transparent PNG or WebP (up to 20 MB), choose a body reference and area, place and adjust artwork, and inspect it through camera views. Named studies, notes, alternatives and undo/redo support comparison. Export a PNG for discussion or a JSON workspace backup for safekeeping and device transfer.

## Capabilities and Constraints

- The public entry uses IndexedDB. Artwork and studies stay in the current browser and origin; the app does not upload them. Another browser or site address has a separate workspace. Device copies do not sync automatically.
- Browser data can be removed or storage can fail. Keep visible save status, Retry and backup/recovery routes. A restore replaces the destination workspace; its safety-backup step and replacement warning must remain explicit.
- Each study supports up to 16 tattoos. Existing tattoos can be positioned and locked while trying new additions.
- Selectable body references are MakeHuman original, MHR neutral and Blender Studio. MakeHuman proportions are adjustable; model capabilities differ. Ten skin reference swatches and a custom color are available. Retired model identities remain readable for existing studies.
- PNG reference export and JSON backup are separate downloads. PDF and 3D model exports are not implemented. Photos of tattoos on skin need preparation outside the app.
- JavaScript, IndexedDB and WebGPU or WebGL2 are required. Fonts, models and rendering dependencies are served by the site.
- React owns interface state; Three.js owns one canvas and its resources. Preserve the canvas lifecycle, editing history, revision-aware saving and camera/export coordination. See `docs/frontend.md` for implementation boundaries.
- Phones use a contextual Place / Size / Rotate / View / More deck with three sheet stops and a dedicated drag handle. The tattoo collection is independently reachable. Controls and artwork keep their own gestures; short landscape uses a side inspector.
- Empty studies offer Reference → Artwork → Placement without a compulsory wizard. Import opens a close-up. Anatomy and starting profile come before fine proportion adjustments.
- Visual comparison captures two studies with matching body settings at the same camera pose. Desktop shows paired previews; phones switch A/B. The live study, saved cameras and history remain independent.
- Reference review shows the exact PNG offered for download, including its placement notes. Direct PNG download remains available in Study actions; another angle is prepared by returning to editing.

## Brand Commitments

The public name is **tattoo you**. The visual direction is emphatically **Instrument**, inspired by Teenage Engineering: opaque control surfaces, tactile keys, recessed display framing, precise type and deliberate orange accents. Preserve that identity and concise, practical copy as workflows evolve. Legacy Inkform storage names and backup formats are compatibility details, not a second public product identity. Do not add unsupported claims or substitute a new visual direction during refinement.

## Evidence on Hand

`docs/images/placement.jpg`, `body-controls.jpg` and `mobile.jpg` are actual public-build captures using original geometric demo artwork, documented in `docs/images/README.md`. They show the implemented experience, not private studies. CSS and UI source are the current authority when captures drift. Third-party rights and provenance live in `ASSET-NOTICES.md` and asset-specific notices. No testimonials, usage metrics, fit-validation study or physical-phone performance evidence is established here.

## Product Principles

- Help people compare placement and communicate with their artist without promising exact body fit.
- Keep artwork ownership and local storage understandable; preserve backup and recovery access.
- Preserve reversible editing, exact adjustments and truthful save/error states.
- Treat desktop and phone as equal acceptance targets for import, placement, exact adjustment, layers, alternatives and export.

## Accessibility & Inclusion

Preserve keyboard controls, focus restoration, visible focus, live reduced-motion preferences and forced-color treatments. Reduced transparency and increased contrast use opaque surfaces. Do not claim a certified accessibility standard or physical-device performance from viewport emulation alone.

## Open Decisions

No specific audience segmentation, validated fit accuracy or formal accessibility conformance target has been established. Future account, synchronization, collaboration or paid-service behavior requires a product decision; it is not part of the current public app.
