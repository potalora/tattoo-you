# tattoo you

## try it before you buy it

## What is this?

A tattoo studio app that allows you to place a tattoo design on a variety of mannequin models with a range of body shapes and skin tones supported. Tattoos are automatically wrapped around the shape of the body, and you can resize and reposition tattoo designs on the mannequin itself. Multiple concurrent designs are supported.

## How does it work?

The app runs in the browser and uses 3D graphics. The app doesn’t upload your designs. Export images and workspace backups locally, without uploading to a server.

## Questions?

email potalora at gmail dot com

## Technical details

tattoo you is a static web app. Artwork processing, body adjustments and workspace persistence run in the browser. The public build does not require an application server or server-side database.

### Stack and rendering

- **Interface:** React, Base UI and Motion, with the Instrument theme as the default.

- **3D rendering:** Three.js with WebGPU and a WebGL2 fallback.

- **Body geometry:** an AssemblyScript kernel compiled to WebAssembly, with a JavaScript fallback for body morphing.

- **Build tools:** esbuild for the interface bundle, AssemblyScript for the geometry kernel, and Wrangler for local preview.

Artwork is mapped across connected triangles of the body mesh from a selected surface anchor. You can adjust placement, size, rotation and mirroring without changing the source image. Large designs and tight curves can produce seams or gaps; the result is a placement reference.

Selectable body references include MakeHuman, MHR neutral and Blender Studio. MakeHuman supports adjustable proportions; the other selectable references have fixed proportions.

### Run locally

Requires Git and Node.js 24 or newer, including npm.

```sh
git clone https://github.com/potalora/tattoo-you.git
cd tattoo-you
npm ci
npm run build
npm start
```

Open [http://127.0.0.1:8788/](http://127.0.0.1:8788/). A Cloudflare account is not required for local preview.

### Development

```sh
npm run build:ui
npm run check:ui
npm test
npm run build
```

UI source lives in `studio/ui/`; rendering is in `studio/scene.js`; body morphing is in `studio/geometry-kernel.js` and `studio/wasm/`. Keep generated `studio/ui-app.js` and `studio/ui-app.css` in sync with their source.

The build assembles `dist-public/` from an explicit allowlist in `public/runtime-assets.json` and records file hashes and source provenance. Fonts, models and rendering dependencies are served with the site.
