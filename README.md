# Screw Jar

Pours rigid-body parts into a bin and counts how many end up entirely inside it. It runs in the browser: [Rapier](https://rapier.rs) (WebAssembly) does the physics and [three.js](https://threejs.org) draws the scene.

## What it does

- **Parts:** pan, flat, socket and hex head screws, hex nuts, boxes, cylinders, spheres or your own STL. Standard metric and inch sizes are built in (ISO and ASME head sizes), or you can type custom dimensions.
- **Mixes:** you can pour several kinds of part at once, each with its own share. The screw jar button fills the list with random standard sizes.
- **Bins:**
  - Harbor Freight storage case presets, or a custom box size.
  - Your own STL. Compartments, dividers and a low front edge are handled by filling the bin the way water would.
- **Auto fill:** pours until heaped, shakes, strikes off anything above the rim and tops up. Bins too big to fill are part-filled with a set number of parts, and the page reports how high they reach.
- **Units:** sizes can be entered in mm or inches.

## Using it

Open `index.html` in a browser. It's one self-contained file and works offline, apart from the web font.

## Building

`index.html` is built from `src/`. You need Node 18 or newer.

```sh
npm install
npm run build     # bundles src/ into index.html
npm test          # headless physics checks
```

The `tests/` folder has more checks and benchmarks. Run them with `node tests/<name>.mjs`.

## Publishing on GitHub Pages

In the repository's **Settings → Pages**, set **Source** to *Deploy from a branch*, choose `main` and `/ (root)`, and save. The site goes live at `https://<user>.github.io/<repo>/`. After changing anything in `src/`, run `npm run build` and commit the new `index.html`.
