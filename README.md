# AbleMark Web

A browser-based label editor and printer for Bluetooth thermal printers, with a printing
protocol reverse-engineered from the **AbleMark** Android app (`com.feioou.deliprint.ablemark`).

No native app, no drivers, no plugins — just open the page in Chrome/Edge, pick a BLE printer
and print labels straight from the browser.

**[Русская версия](README.ru.md)**

## Features

- **Desktop editor** — canvas with free drag, selection handles, rotation, resize, layer list,
  alignment, keyboard shortcuts.
- **Element types**: text, date/time, barcode (Code 128), QR code (incl. Wi-Fi / vCard / link
  presets), image, line, shape, table, serial number, price tag.
- **Model profiles** — auto-detects the printer by name and applies the right protocol, print
  direction, DPI and default paper size (L-series, P50/S2, D100/X4 and more).
- **Print settings** — paper type (gap label / continuous / black mark), density, copies,
  direction, render quality (threshold vs. Floyd–Steinberg dithering).
- **Incremental printing** — serial numbers and incrementing barcodes per copy.
- **Device info** — battery, paper remaining, firmware version, serial number, MAC address,
  auto power-off time (read/write), status.
- **Service panel** — calibration, gap calibration, beep, screen on/off, time sync, feed to
  mark, induction print, factory reset.
- **BT console** — send arbitrary hex commands and see the raw replies (great for exploring
  the printer).
- **Templates** — save to `localStorage`, apply, export/import as `.amlbl` (JSON).
- **Bilingual UI** — Russian and English.
- **WYSIWYG preview** — shows the exact 1-bit raster that gets printed (supersampling +
  box-downsample for sharp text edges).

## Supported printers

Any printer speaking the AbleMark / yxqapp SDK protocol over **BLE**:

| Series | Models | Protocol |
|---|---|---|
| L-series | P11, P12, P15, P7, P1s, M1, S15, S12, A1, LP15, LP90, LPC74, YEW12 | `l` |
| P50 family | P50, P5OS, P50S, T2, M50, M57, S2, X2, M60, ET-Z05xx, Jammuk | `p50` |
| P80 | P80, P80S, T3 | `l` |
| D-series | D100, D200, X4, L100, U210 | `p50` |
| Receipt | ESC/POS-compatible (58/80 mm) | `escpos` |

> Printers that only speak Bluetooth Classic **SPP** (e.g. D100/D200/S8) can't be connected
> from a browser — Web Bluetooth exposes GATT (BLE) only.

## Requirements

- **Chrome, Edge or Opera** (desktop or Android) with **Web Bluetooth** support.
- The page must be served over **HTTPS** (or `http://localhost`) — Web Bluetooth requires a
  [secure context](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts).
- A BLE thermal printer that isn't connected to another device (a printer usually holds a
  single connection).

## Getting started

### Local

```bash
# serve the repo root with any static server, e.g.:
python -m http.server 8000
# or
npx serve .
```

Then open <http://localhost:8000>, click **Connect**, pick the printer, add elements on the
left, adjust properties on the right and hit **Print**.

### GitHub Pages

Push to `main` — the included workflow (`.github/workflows/deploy.yml`) deploys the site to
GitHub Pages automatically. Then enable Pages in the repo settings:

**Settings → Pages → Source: GitHub Actions**.

## Usage

| Key | Action |
|---|---|
| Arrows | move the selected element (Shift = 10× step) |
| Ctrl + Arrows | move layer up/down |
| Tab / Shift+Tab | cycle through elements |
| Ctrl+C / Ctrl+V | copy / paste |
| Ctrl+X | cut |
| Ctrl+D | duplicate |
| Delete / Backspace | delete |
| `+` / `-` | scale element |
| R | rotate 90° |
| Enter | open properties (also double-click) |
| Esc | close modal |

## Project structure

```
index.html             single-page app
css/style.css          styles
js/ablemark.js         protocol (GATT, flow control, commands, parsers)
js/editor.js           canvas editor (elements → 1-bit raster)
js/templates.js        template library (localStorage + import/export)
js/i18n.js             RU/EN localization
js/app.js              UI logic
vendor/                pako (zlib), qrcode-generator
test/                  node + puppeteer tests
docs/                  reverse-engineering notes (protocol, BT operations)
.github/workflows/     GitHub Pages deployment
```

## Development & tests

```bash
node test/protocol.test.js    # commands, codecs, parsers, rotation, serial
node test/templates.test.js   # template library
node test/i18n.test.js        # RU/EN dictionary completeness
node test/ascii.test.js       # rendering sharpness (requires Chrome)
node test/smoke.test.js       # end-to-end UI (requires Chrome, puppeteer-core)
```

The `smoke`/`ascii` tests need `puppeteer-core` and a local Chrome; adjust the executable
path in the test if needed.

## How it works

The app builds the label on a canvas, converts it to a 1-bit raster (supersampling + box
downsample or Floyd–Steinberg), optionally rotates it according to the model's print
direction, and streams the bytes to the printer over BLE with credit-based flow control.

Full protocol documentation: [`docs/PROTOCOL.md`](docs/PROTOCOL.md) and
[`docs/BT_OPERATIONS.md`](docs/BT_OPERATIONS.md).

## Limitations

- No Bluetooth Classic **SPP** (browser restriction).
- No firmware updates / OTA (needs native codecs and boot mode).
- No JBIG image codec (X8/D100 use a native library).
- Images/templates with embedded images aren't persisted between sessions (images are kept
  in memory only).

## License

MIT — see [LICENSE](LICENSE). Protocol implementation ideas partially borrowed from
[thermoprint](https://github.com/tomLadder/thermoprint) by tomLadder (MIT); see the
attribution section in the LICENSE file.

## Disclaimer

This project is an independent clean-room-style reimplementation of the communication
protocol, written for interoperability with existing hardware. It is not affiliated with,
endorsed by, or sponsored by the authors of the AbleMark app or the printer manufacturers.
All trademarks belong to their respective owners.
