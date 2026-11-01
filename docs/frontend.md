# Frontend architecture

The browser app uses React 19.3, Base UI 1.9 and Motion 14.2 for its interface. Three.js owns a single canvas, scene resources and camera input. The public entry point is `studio/public-app.js`; it selects the IndexedDB adapter in `studio/local-api.js`. Artwork and studies stay in the current browser and origin.

## Ownership

| Module | Responsibility |
| --- | --- |
| `studio/application.js` | Commands, immutable snapshots, UI state and adapter/renderer lifecycle. |
| `studio/study-controller.js` | Study edits, history, alternatives and body changes. |
| `studio/workspace-sync.js` | Revision-aware saves, conflicts and render requests. |
| `studio/workspace-files.js` | Artwork, backups, restore and reference export. |
| `studio/ui/main.jsx` and panel components | Study menu, dialogs, Composition, Artwork and Body. |
| `studio/ui/primitives.jsx` | Shared controls, Base UI focus behavior and Motion transitions. |
| `studio/ui/motion.jsx` and `sheet-gesture.js` | Live accessibility preferences and mobile sheet drag/snap behavior. |
| `studio/viewport-layout.js` and `camera-framing.js` | The clear viewing area beneath floating controls and camera projection. |
| `studio/camera-motion.js` | Finite, cancellable camera transitions. |
| `studio/scene.js` | Rendering, geometry, camera input and traced previews. |

React subscribes with `useSyncExternalStore`. UI-only publications retain the current immutable study/workspace snapshot; edits and saves publish new domain snapshots. Panels stay mounted when hidden to preserve local input and disclosure state. Each memoized panel comparator must include every value that panel displays.

## Interface behavior

Instrument is the default presentation. The study selector, save recovery and history sit in the top rail. The body preview has a recessed stage and camera controls; the right inspector contains Composition, Artwork and Body tabs. IBM Plex Sans, putty panels, dark selected controls and restrained orange, blue and green accents carry the interface. Glass remains available at `?theme=glass` for existing links.

`studio/studio.css` owns shared structure, `studio/themes.css` owns Glass, and `studio/instrument.css` plus `instrument-controls.css` scope the Instrument presentation. Theme choice stays outside study data. The Instrument scene hides the authored room while retaining its illumination and body material setup.

Numeric fields accept exact values. Mixed selections describe their reference value and editable count; single-tattoo placement follows the connected body surface. Save failures remain visible with Retry, and preview failures distinguish saved work from unsaved edits. The Layer Actions disclosure stays inside the scrolling inspector. Long study and artwork names wrap.

On phones, the controls panel has collapsed, normal and expanded stops. Only the dedicated top handle drags the sheet; sliders and artwork retain their own input. The actual animated height updates the workspace measurement while the sheet moves. Desktop transitions clear mobile height overrides. Motion owns interface animation, while the scene owns finite camera interpolation and returns to idle after it settles. Export settles the camera before capture.

Reduced-motion preferences are observed live. Reduced transparency and increased contrast use opaque surfaces without backdrop filters. Forced colors retain system control colors. Keyboard interaction and focus restoration remain owned by Base UI or native controls.

## Build and verification

```sh
npm ci
npm run build
npm test
npm run check:ui
npm start
```

The build compiles the geometry kernel, vendors the renderer, bundles JSX/CSS, and assembles `dist-public/` from `public/runtime-assets.json`. Its manifest records hashes, provenance, source commit and whether the source tree was dirty. The runtime license list includes Motion and its bundled dependencies. Keep the generated UI assets with their source changes.

Tests cover save/recovery behavior, camera interpolation and cancellation, sheet snap calculations, reduced-motion paths, layout measurement and public packaging. Browser checks covered desktop, tablet, 320px and 390px phone viewports, short landscape, keyboard menus/dialogs and live accessibility preferences. Viewport emulation does not establish physical iPhone or Android performance.
