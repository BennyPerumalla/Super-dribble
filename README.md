# Super Dribble Audio Amplifier

Real-time audio amplification, 10-band parametric equalization, and stereo spatialization for
any Chrome tab — with all sample-rate DSP running in WebAssembly.

[![CI](https://github.com/BennyPerumalla/Super-dribble/actions/workflows/ci.yml/badge.svg)](https://github.com/BennyPerumalla/Super-dribble/actions/workflows/ci.yml)

| | |
| --- | --- |
| **Version** | 1.0.0 |
| **Platform** | Chromium (Chrome, Brave, Edge) — Manifest V3, Chrome 116+ |
| **License** | GNU LGPL v2.1 |
| **Technical spec** | [`docs/technical_documentation.md`](docs/technical_documentation.md) |

---

## Contents

- [What it does](#what-it-does)
- [How it works](#how-it-works)
- [Install](#install)
- [Usage](#usage)
- [Build](#build)
- [Testing](#testing)
- [Permissions and privacy](#permissions-and-privacy)
- [Project layout](#project-layout)
- [Contributing](#contributing)
- [Troubleshooting](#troubleshooting)
- [License](#license)

---

## What it does

| Feature | Detail |
| --- | --- |
| **Master gain** | 0 % – 400 % of unity, with ~10 ms one-pole smoothing so slider drags don't zipper. |
| **10-band parametric EQ** | 32 Hz – 16 kHz, peaking biquads at Q = 1.0, ±24 dB per band. |
| **Spatializer** | Frequency-dependent mid/side widening over a 4th-order Linkwitz-Riley crossover, plus a 4×4 Hadamard feedback-delay-network reverb. |
| **Spectrum visualizer** | 10-band energy at 60 Hz, derived from a *silent* analyser tap so it adds nothing to the output. |
| **Now Playing** | Title, artist, album art, and elapsed/total time read from the page's MediaSession. |
| **Transport control** | Play/pause toggle, next, previous — driven through the page's own controls. |
| **Preset library** | 13 equalizer and 11 spatializer presets authored in Lua, plus custom import. |
| **Output limiting** | Hard clamp at ±1.0 after gain, so boosting past unity cannot produce digital overs. |

### Design rules the codebase actually enforces

These are checked by `verify-extension.js` on every build — a violation fails the build rather
than shipping:

- **All DSP is WebAssembly.** No `BiquadFilterNode`, no `ScriptProcessorNode`, no
  `onaudioprocess`. The AudioWorklet files marshal buffers and forward parameters; every
  filter, delay, and clamp lives in C++.
- **Exactly one `GainNode` exists**, and it is the muted analyser sink — so the visualizer can
  never leak audio into the output.
- **No `host_permissions`, no declared `content_scripts`.** Page code is injected on demand,
  into the one tab you opened the popup on.
- **No `unsafe-eval`.** The CSP allows only `wasm-unsafe-eval`, which is why presets are parsed
  by a bounded parser instead of an embedded Lua interpreter.
- **The packaged extension stays under 20 MB** and contains only runtime files.

---

## How it works

```
┌──────────┐   getMediaStreamId    ┌───────────────┐
│  Popup   │ ────────────────────▶ │ Service       │
│  React   │ ◀──────────────────── │ worker        │
└────┬─────┘      status/state     └───────┬───────┘
     │                                     │ streamId + cached settings
     │ BroadcastChannel                    ▼
     │ (visualization)          ┌──────────────────────────────────┐
     └────────────────────────  │ Offscreen document               │
                                │                                  │
                                │ getUserMedia(tab)                │
                                │   └▶ Equalizer WASM worklet      │
                                │        ├▶ [Spatializer WASM]     │
                                │        │      └▶ destination     │
                                │        └▶ Analyser ▶ Gain(0) ▶ ⏚ │
                                └──────────────────────────────────┘
```

**Why an offscreen document?** An `AudioContext` created in the popup dies the moment the popup
closes. Hosting the graph in an offscreen document (`reasons: ['AUDIO_PLAYBACK']`) keeps
processing alive while you browse.

**Why the muted gain node?** An `AnalyserNode` only advances its FFT while it is on a path that
reaches a destination — but connecting it straight to the destination would sum the signal in
twice. Routing `Analyser → Gain(0) → destination` keeps the graph live at exactly zero
contribution.

**Signal path:**

```
Tab audio → MediaStreamSource → equalizer.wasm → [spatializer.wasm] → destination
                                       └────────→ Analyser → Gain(0) → destination
```

The spatializer module is compiled and spliced into the graph only after a spatializer setting
is enabled, and the compiled `WebAssembly.Module` is cached, so toggling it off and on again
doesn't recompile.

Full architecture, message protocol, DSP maths, WASM ABI, and concurrency model:
[`docs/technical_documentation.md`](docs/technical_documentation.md).

---

## Install

### Prerequisites

| Tool | Version | Needed for |
| --- | --- | --- |
| Node.js | 22 | Build scripts |
| pnpm | 10.29.1 | UI dependencies |
| Emscripten (emsdk) | 6.0.6 | Compiling the C++ DSP to WASM |
| Chromium browser | 116+ | Running the extension |

Emscripten install guide: <https://emscripten.org/docs/getting_started/downloads.html>

### From source

```bash
git clone https://github.com/BennyPerumalla/Super-dribble.git
cd Super-dribble
cd UI && pnpm install && cd ..
node build-extension.js
```

Then in Chrome:

1. Open `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select **`output/Super-Dribble`**

> **Load `output/Super-Dribble`, not the repository root.** Chrome counts every file beneath the
> folder you select, including `node_modules` and any local Emscripten SDK. The generated
> package contains runtime assets only and is verified to stay under 20 MB.

### Chrome Web Store package

`node build-extension.js` also produces `output/Super-Dribble.zip`, with the extension files at
the archive root and no source, dependencies, tests, or docs.

---

## Usage

1. Open a tab that is playing audio.
2. Click the Super Dribble toolbar icon.
3. Press **Connect** to start processing that tab.

| Control | Behaviour |
| --- | --- |
| **Volume slider** | Master gain, 0–100 % of the slider mapping to the engine's gain stage. |
| **Mute** | Silences output; the slider fill turns red while muted. |
| **EQ sliders** | Ten vertical bands, 32 Hz → 16 kHz. Changing any band sets the preset to *Custom*. |
| **Presets dropdown** | Seven built-in curves plus **Import Preset…** for a `.lua` file. |
| **Reset** | Returns all ten bands to 0 dB. |
| **"Parametric EQ" title** | Click to flip the card and reveal the spatializer. |
| **Stereo / Reverb** | Spatializer toggles on the reverse face. **Back to EQ** flips back. |
| **Library button** | Opens the full Lua preset library. |

Settings are cached in the service worker, so edits made before connecting are applied the
moment capture starts, and survive a service-worker restart.

### Popup dimensions

The popup is a fixed **468 × 596 px** and does not scroll. Panels are pinned at
**148 / 49 / 295 px** — a 3 : 1 : 6 split of the content column. This is deliberate: Chromium
caps popups near 800 × 600 and does not honour proportional flex distribution reliably at this
size. See §14.2 of the technical documentation before changing any popup geometry.

---

## Build

### Everything, verified and packaged

```bash
node build-extension.js
```

Runs, in order: WASM compile → UI build → runtime-input assertion → package copy →
`verify-extension.js` → ZIP. Any failing stage aborts the build.

### WASM only

```bash
node build-wasm.js
node build-wasm.js --module=equalizer
node build-wasm.js --module=spatializer
```

The build **fails** if Emscripten cannot be found. It never writes a placeholder binary — a
stub `.wasm` that loads but outputs silence is much harder to diagnose than a failed build.

Compiler search order: `$EMSDK/upstream/emscripten`, `~/emsdk/upstream/emscripten`,
`<repo>/emsdk/upstream/emscripten`, then `em++` on `PATH`.

### UI only

```bash
cd UI
pnpm run build       # tsc -b && vite build → UI/build/
pnpm run dev         # Vite dev server on http://localhost:8080
pnpm run typecheck
pnpm run lint
pnpm run format.fix
```

Vite pins its output filenames, so a UI rebuild never changes the asset paths and
`manifest.json` never needs editing after a UI change.

> `background.js`, `content.js`, `offscreen.js`, and the AudioWorklet files are **not bundled**.
> After editing any of them, reload the unpacked extension in `chrome://extensions` — a UI
> rebuild alone will not pick up the change.

---

## Testing

```bash
node --test tests/*.test.js     # architecture, background, manifest, visualization
cd UI && pnpm test              # vitest
```

The Node tests parse and `vm`-load the real sources rather than test doubles, so they assert
properties of the code that actually ships:

| File | Asserts |
| --- | --- |
| `tests/audio-architecture.test.js` | Graph shape and DSP-purity properties of `offscreen.js` and the worklets. |
| `tests/background.test.js` | Offscreen lifecycle, message routing, control caching, and the visualization port — under both "offscreen exists" and "does not exist". |
| `tests/manifest.test.js` | Permission allowlist; absence of `content_scripts` / `host_permissions`; content-script load guard. |
| `tests/visualization.test.js` | FFT bin-range derivation across sample rates and FFT sizes, band non-overlap, DC exclusion, degenerate-FFT collapse. |

CI (`.github/workflows/ci.yml`) runs lint → UI tests → Node tests → full package build on
every push, and uploads `output/Super-Dribble.zip` as a 14-day artifact.

---

## Permissions and privacy

| Permission | Why |
| --- | --- |
| `activeTab` | Temporary access to the tab you invoked the extension on. Grants nothing until you click. |
| `tabCapture` | Obtain the tab's audio stream. |
| `scripting` | Inject the media-metadata script into that one tab. |
| `offscreen` | Keep the audio graph alive after the popup closes. |

**No `host_permissions`. No declared content scripts.** Nothing runs on a page until you open
the popup on it.

- No network requests, other than album art loaded from the URL the page itself declares.
- No persistent storage — there is no `storage` permission.
- No telemetry or analytics.
- Captured audio is processed locally and routed to your output device. It never leaves the
  browser process.

---

## Project layout

```
Super-dribble/
├── manifest.json                  MV3 manifest
├── background.js                  Service worker — capture brokerage, state cache
├── content.js                     On-demand media metadata + transport control
├── offscreen.html / offscreen.js  Audio engine host and engine
├── build-wasm.js                  Emscripten driver
├── build-extension.js             Package + archive driver
├── verify-extension.js            Release gate (runs inside build-extension.js)
├── wasm/
│   ├── equalizer/                 equalizer.cpp/.wasm, worklet bridge, presets.lua
│   └── spatializer/               spatializer.cpp/.wasm, worklet bridge, presets.lua
├── utils/audio-visualization.mjs  Band/bin math shared by the engine and tests
├── UI/                            React + TypeScript + Tailwind popup (Vite)
│   ├── src/equalizer/             AudioEqualizer.tsx — orchestration hub
│   ├── src/lib/audioService.ts    Messaging transport layer
│   └── build/                     Build output — this is what the manifest loads
├── tests/                         Node test suite
├── docs/technical_documentation.md  Full technical specification
└── output/                        Generated package and Web Store ZIP
```

There is no root `package.json` — root tooling is invoked directly with `node`. The UI is a
self-contained pnpm workspace under `UI/`.

---

## Contributing

See [`docs/CONTRIBUTING.md`](docs/CONTRIBUTING.md) and
[`docs/CODE_OF_CONDUCT.md`](docs/CODE_OF_CONDUCT.md).

1. Fork and branch from `main`.
2. Read the relevant section of
   [`docs/technical_documentation.md`](docs/technical_documentation.md) first — several
   apparently arbitrary choices (fixed WASM memory, the muted gain node, pinned popup pixels,
   the flip-card opacity delay) are workarounds for specific platform behaviour and are
   documented as such.
3. Keep `node build-extension.js` green. It runs the verifier, which enforces the DSP-purity
   and permission invariants.
4. Add or update tests under `tests/` for engine changes, `UI/src/**/*.spec.ts` for UI changes.
5. Open a pull request describing the behaviour change and how you verified it.

Known issues and technical debt are tracked in §21 of the technical documentation.

---

## Troubleshooting

**No audio after connecting**

- Confirm the tab is actually producing audio (the tab's speaker indicator is lit).
- Reload the page, then reconnect. A stream captured before a navigation is dead.
- Open the offscreen document's console: `chrome://extensions` → Super Dribble →
  **Inspect views: offscreen.html**. Startup logs the resolved audio path and the full
  performance-metrics object.

**Album art is missing**

The artwork comes from the page's `navigator.mediaSession.metadata.artwork`, falling back to
`<meta property="og:image">`. Sites that publish neither will show the placeholder glyph. If
you just pulled a change to `content.js`, reload the unpacked extension — that file is not
bundled and a UI rebuild will not update it.

**Controls do nothing**

Control messages need a live engine. Before capture starts they are cached and answered with
`{success: true, cached: true}`, then replayed when you connect. Press **Connect** first.

**`node build-wasm.js` fails**

Emscripten was not found or is not activated. Run `emsdk activate latest` and re-source
`emsdk_env`, or set `EMSDK` to your emsdk root. The build intentionally refuses to emit a
placeholder binary.

**Extension won't load**

- Select `output/Super-Dribble`, not the repository root.
- Confirm `UI/build/` exists and is non-empty; run `node build-extension.js` if not.
- Requires Chrome 116 or newer (`minimum_chrome_version`).

**Diagnostics**

Ask the engine for its timings directly from the offscreen console:

```js
chrome.runtime.sendMessage({ action: 'get_performance_metrics', target: 'offscreen' })
```

Returns `timeToAudioReadyMs`, per-stage startup breakdown, `visualizationFps`,
`baseLatencyMs`, `outputLatencyMs`, and the negotiated `sampleRate`.

---

## License

GNU Lesser General Public License v2.1. See [`docs/LICENSE`](docs/LICENSE).

## Authors

- Benny Perumalla &lt;benny01r@gmail.com&gt;
- Irshad Siddi &lt;mohammadirshadsiddi@gmail.com&gt;
- Sukesh Reddy &lt;lyricsofsongs96@gmail.com&gt;
