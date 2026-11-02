# Frontend architecture

The browser app uses React 19.3, Base UI 1.9 and Motion 14.2 for its interface. Three.js owns a single canvas, scene resources and camera input. The public entry point is `studio/public-app.js`; it selects the IndexedDB adapter in `studio/local-api.js`. Artwork and studies stay in the current browser and origin.

## Ownership

| Module | Responsibility |
| --- | --- |
| `studio/application.js` | Commands, immutable snapshots, UI state and adapter/renderer lifecycle. |
| `studio/study-controller.js` | Study edits, history, alternatives and body changes. |
| `studio/workspace-sync.js` | Revision-aware saves, conflicts and render requests. |
| `studio/workspace-files.js` | Artwork, backups, restore and reference export. |
| `studio/study-comparison.js` | Compatible-study filtering, isolated A/B captures and renderer restoration. |
| `studio/ui/main.jsx` and panel components | Study rail, selected-tattoo adjustment, collection, artwork and body setup. |
| `studio/ui/journey-panels.jsx` | Paired/phone A/B comparison and exact reference review. |
| `studio/ui/primitives.jsx` | Shared controls, Base UI focus behavior and Motion transitions. |
| `studio/ui/motion.jsx` and `sheet-gesture.js` | Live accessibility preferences and mobile sheet drag/snap behavior. |
| `studio/viewport-layout.js` and `camera-framing.js` | The clear viewing area beneath floating controls and camera projection. |
| `studio/camera-motion.js` | Finite, cancellable camera transitions. |
| `studio/scene.js` | Rendering, geometry, camera input and traced previews. |

React subscribes with `useSyncExternalStore`. UI-only publications retain the current immutable study/workspace snapshot; edits and saves publish new domain snapshots. Panels stay mounted when hidden to preserve local input and disclosure state. Each memoized panel comparator must include every value that panel displays.

## Interface behavior

Instrument is the default presentation. The study selector, save recovery, history, comparison and reference review sit in the top rail. The recessed body display has Orbit, Detail and an Angles selector. Adjust, Tattoos and Body have separate control surfaces; Add opens the artwork library. IBM Plex Sans, opaque putty decks, tactile keys, dark selected controls and deliberate orange, blue and green accents retain the Teenage Engineering-inspired direction. Glass remains available at `?theme=glass` for existing links.

`studio/studio.css` owns shared structure, `studio/themes.css` owns Glass, and `studio/instrument.css` plus `instrument-controls.css` scope the Instrument presentation. Theme choice stays outside study data. The Instrument scene hides the authored room while retaining its illumination and body material setup.

Numeric fields accept exact values. Mixed selections describe their reference value and editable count; single-tattoo placement follows the connected body surface. Save failures remain visible with Retry, and preview failures distinguish saved work from unsaved edits. The Layer Actions disclosure stays inside the scrolling inspector. Long study and artwork names wrap.

The Instrument selection header identifies the tattoo and lock scope. Desktop Width and Rotation precede placement; phones show one Place / Size / Rotate / View / More tool. The phone View tool contains camera framing and angle controls, returning the permanent camera bank when the deck collapses. Group controls share one accessible scope explanation. Import waits for the scene update, chooses Detail and focuses Body area. The separate collection keeps selection and layer management independent from the property scroll. `ui/study-menu.js` owns native Study actions dismissal and listener cleanup. Alternative defaults use unique leading `Copy` labels within the existing name limit; saved names are never migrated.

Comparison holds `state.reviewing` and blocks editing while the existing renderer captures both studies. Matching body settings and a shared camera/crop keep the visual comparison meaningful. Workspace IDs, study cameras and history are unchanged. Camera restoration is immediate, retains its named view and clears delayed camera-save callbacks. Temporary renderer stats cannot be attributed to the active study; failure to restore invalidates preview ownership before editing/export recovery.

`prepareReference()` creates the PNG once. The UI snapshot holds its preview and metadata; the Blob stays in the application closure. `downloadReference()` sends that exact Blob, while `saveImage()` remains the direct preparation/download route. Closing review releases the prepared reference. No second renderer, upload or new persistence schema is introduced.

On phones, the controls panel has collapsed, normal and expanded stops. Only the dedicated top handle drags the sheet; sliders and artwork retain their own input. The actual animated height updates the workspace measurement while the sheet moves. Desktop transitions clear mobile height overrides. Motion owns interface animation, while the scene owns finite camera interpolation and returns to idle after it settles. Export settles the camera before capture.

The existing viewport observer also publishes `--dock-live-height` for the framed Instrument stage. Feedback wrapping changes the frame reservation and camera boundary together without changing saved camera state or adding an observer.

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
