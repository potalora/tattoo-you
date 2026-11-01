# Instrument release review

Reviewed 1 November 2026. The public editor now opens in Instrument, with the accepted placement, recovery and responsive-layout refinements. The home page explains the app; the README documents the public repository's local build.

## Website claims

| Draft claim | Verified wording and limits |
| --- | --- |
| A variety of mannequin models | MakeHuman, MHR neutral and Blender Studio are selectable. Older model identities remain readable in saved studies. |
| Near infinite body and skin types | MakeHuman proportions have bounded controls. Other selectable references have fixed proportions. Ten skin-color reference swatches and a custom RGB color do not represent every physical skin type. |
| Tattoos automatically wrap around the body | Surface mapping follows a connected body surface. Large placements and tight curves can produce seams, gaps or distortion; the preview is approximate. |
| Expand and modify designs on the mannequin | Placement, width, rotation, mirroring and intensity are editable. The app does not draw or edit the source artwork. |
| Multiple concurrent designs | Up to 16 tattoos per study, including existing tattoos. |
| Fully contained in the browser | Artwork processing and project persistence run in the browser. The site still loads its own scripts, fonts and models from its host. |
| Rendered with WebGPU | WebGPU is used where available, with WebGL2 fallback. Both paths were exercised in Chrome. |
| No designs ever leave the browser | The app does not upload artwork or studies. Users can intentionally download PNG references and JSON workspace backups. |
| PDF and 3D-model exports | Neither is implemented. The published copy describes PNG references and JSON backups. |
| Local exports, never uploaded | Export files are generated locally and downloaded. The user controls any later sharing of those files. |

Sources: [`model-catalog.js`](../studio/model-catalog.js), [`body-controls.js`](../studio/body-controls.js), [`skin-tones.js`](../studio/skin-tones.js), [`model.js`](../studio/model.js), [`surface-map.js`](../studio/surface-map.js), [`scene.js`](../studio/scene.js), [`browser-files.js`](../studio/browser-files.js), [`workspace-files.js`](../studio/workspace-files.js) and [`local-api.js`](../studio/local-api.js).

## Privacy findings

The public entry point injects the IndexedDB adapter. The reviewed runtime has no artwork-upload implementation, server API helper or personal-workspace importer. Library changes use revisions to reject competing writes. Existing browser database names and backup formats remain unchanged. Public-only protections for startup recovery, deleted-artwork history and long Unicode duplicate names are retained.

Accepted PNG/WebP files retain their original bytes when resizing is unnecessary. That includes any embedded metadata. Backups are not anonymized or stripped of metadata. Browser storage may be cleared or evicted; the site advises keeping a separate backup.

The release is assembled from an explicit runtime allowlist. Private artwork, source PDFs, databases, server code, credentials and private deployment components are excluded. The build rejects symlinks and path traversal, removes stale output, and records file hashes and source identity. The reviewed public Git change contains application source, tests, documentation and synthetic demonstration screenshots.

The site's Content Security Policy restricts scripts, connections, workers, fonts and images to the sources needed by the local renderer. It does not grant broad script evaluation. The app adds no analytics, tracking pixels, advertising code or application cookies. Hosting still receives ordinary requests and network information, as described on the [privacy page](../public/privacy.html).

## Verification

- `npm run build`: compiled the geometry kernel, renderer and UI; assembled 197 public files.
- `npm test`: 607 tests passed, with no failures or skips.
- `npm run check:ui`: checked-in generated UI matches its source.
- `npm audit`: zero known advisories after updating the Wrangler development toolchain to 4.156.0. Browser rendering dependency versions are unchanged.
- Independent source review found no actionable release blockers.
- Chrome checks covered the home and privacy pages, default Instrument, WebGPU and forced WebGL2, import, exact numeric edits, direct placement, undo, saving/reload, PNG export, JSON backup and restore.
- The downloaded PNG was opened and inspected. The downloaded JSON contained the expected study, placement values and original synthetic artwork bytes; restoring it succeeded.
- Responsive checks covered 1280 × 840, 1040 × 760, 667 × 375, 390 × 844 and 320 × 568. No horizontal document overflow was observed. Short-landscape placement retained a 242px-high canvas.
- A complete, untruncated network capture across a second import/edit/export/backup/restore cycle recorded seven local Blob/data reads and zero HTTP requests. Initial loading separately requested site assets. Browser-extension traffic is outside the app's implementation and was excluded from app conclusions.
- Representative private catalog, PDF, database, personal-entry and API paths returned 404 from the public preview. CSP and security headers were present.

Browser checks used a separate local origin and only the original geometric demonstration artwork. Physical iPhone/Android performance and screen-reader behavior were not newly verified in this release. This is a scoped source, artifact and browser review, not a third-party security certification.
