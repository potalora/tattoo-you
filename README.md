# tattoo you

[Open the website](https://inkform-beta.pages.dev/)

A browser app for trying tattoo placement on 3D body references. Import artwork, adjust its position and size, compare arrangements, and download a PNG reference for your artist. The preview is approximate; confirm the final fit on your body with your artist.

![Tattoo placement in the studio](docs/images/placement.jpg)

The Instrument interface has a reusable artwork library, named studies, notes, undo/redo, and JSON workspace backups. Choose from MakeHuman, MHR neutral and Blender Studio body references. MakeHuman proportions are adjustable; skin tones include ten reference swatches and a custom color. Each study holds up to 16 tattoos. Existing tattoos can be positioned and locked while you try new additions. Phones use a draggable controls panel.

## Run locally

Requires Git and Node.js 24 or newer, including npm.

```sh
git clone https://github.com/potalora/tattoo-you.git
cd tattoo-you
npm ci
npm run build
npm start
```

Open [tattoo you](http://127.0.0.1:8788/) and choose **Open studio**. Leave the terminal running; stop with Ctrl-C. For later launches, run `npm start` from the `tattoo-you` folder. The preview server runs locally; a Cloudflare account is not required. `npm run build` generates the static site in `dist-public/`, including its renderer, geometry kernel and interface.

Studies and artwork save in the current browser using IndexedDB. The app does not upload them. Different browsers and site addresses have separate workspaces, so keep the same local address and port for later visits. Download a JSON workspace backup before clearing browser data or moving between devices. Restore replaces the destination workspace. PNG reference images are separate downloads; PDF and 3D model exports are not available.

Import a tightly cropped, transparent PNG or WebP up to 20 MB. Photos of tattoos on skin need preparation outside the app.

## Screenshots

Body controls and the phone layout. All screenshots use an original geometric demo design, with no private artwork or studies.

![Body reference controls](docs/images/body-controls.jpg)

<img src="docs/images/mobile.jpg" alt="Phone layout with the draggable controls panel" width="320">

## Development

The interface uses React, Base UI and Motion. Three.js owns the 3D view, with WebGPU and a WebGL2 fallback. A browser with JavaScript, IndexedDB and one of these graphics backends is required. The site serves its own fonts, models and rendering dependencies.

```sh
npm run build:ui
npm run check:ui
npm test
npm run build
```

UI source is in `studio/ui/`; the geometry kernel source is in `studio/wasm/`. Keep the generated `studio/ui-app.js` and `studio/ui-app.css` with source changes. The public build uses the explicit file list in `public/runtime-assets.json`.

See [frontend architecture and interface behavior](docs/frontend.md) and [screenshot provenance](docs/images/README.md). The application source uses the [MIT License](LICENSE). Third-party components and assets retain their own licenses; see [ASSET-NOTICES.md](ASSET-NOTICES.md).

Existing Inkform browser storage names and backup formats are retained.
