# Vector Converter

Electron desktop utility for turning SVG decals into:

* CAD-ready DXF (scaled to real-world size, exported in millimetres with `$INSUNITS`)
* Raster mock-ups composited onto background photos (e.g. car window) with correct physical scaling
* Black-and-white PNG for vinyl cutters / laser engravers

---

## Features

| Feature | Details |
|---------|---------|
| 📐 **Real-world scaling** | Reads `width` / `height` in *in* or *mm*. If absent, assumes the SVG `viewBox` units are **millimetres**. |
| 📁 **Batch assets** | Generates DXF, B/W PNG, and a colour mock-up in one click. |
| 🖼️ **Mock-up overlay** | Filename parsing (e.g. `window_18in.jpg`) tells the app the physical width of the background photo so the overlay decal is sized correctly. |
| 💾 **DXF export** | Uses Maker.js; writes `$INSUNITS = 4` (mm) and scales geometry so height = declared physical size. |
| 🧹 **Clean repo** | `output-files/` is git-ignored; only source SVGs track. |

## Installation

```bash
# Clone
git clone https://github.com/curtisgibby/vector-converter.git
cd vector-converter

# Use correct Node version (requires nvm)
nvm use

# Install deps
npm install

# Run (development)
npm start
```

Requires Node 22+ (see `.nvmrc`) and the system build tools Sharp needs (on macOS: `xcode-select --install`).

## Usage

1. **Select SVG** – click *Select SVG* and pick your decal file.
2. **Select background (optional)** – pick a JPG/PNG whose filename contains the physical width, e.g. `window_18in.jpg`.
3. **Pick colour** – choose a fill colour for the mock-up.
4. **Generate** – the app creates:
   * `output-files/<svgName>.dxf`
   * `output-files/<svgName>_bw.png`
   * `output-files/<svgName>_on_<bgName>_mockup.png`

## Packaging (optional)

```bash
npm run dist   # uses electron-builder (add if desired)
```

---

## Contributing

PRs welcome! Open an issue for bugs or enhancement ideas.

## License

MIT © Curtis Gibby
