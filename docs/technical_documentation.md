# Super Dribble — Technical Documentation

| Field | Value |
| --- | --- |
| Product | Super Dribble Audio Amplifier |
| Product version | 1.0.0 (`manifest.json`) |
| Document revision | 2.0 |
| Status | Baseline — describes the implementation as committed |
| Platform | Chromium, Manifest V3, `minimum_chrome_version: 116` |
| License | GNU LGPL v2.1 |
| Audience | Maintainers, reviewers, integrators, release engineers |

**Normative language.** *SHALL* / *MUST* denote invariants that are mechanically enforced by
`verify-extension.js` or `tests/`. *SHOULD* denotes a convention that is followed in the
current implementation but is not machine-checked. Anything else is descriptive.

**Verifiability.** Every constant, export name, message action, and threshold in this document
was read out of the source tree at the referenced path. Where a value is duplicated in two
places (e.g. the 10 band centre frequencies), both locations are named, because they are a
known synchronisation hazard.

---

## Table of contents

1. [Scope and system overview](#1-scope-and-system-overview)
2. [Architecture](#2-architecture)
3. [Runtime lifecycle](#3-runtime-lifecycle)
4. [Inter-context message protocol](#4-inter-context-message-protocol)
5. [Audio signal chain](#5-audio-signal-chain)
6. [DSP specification — equalizer](#6-dsp-specification--equalizer)
7. [DSP specification — spatializer](#7-dsp-specification--spatializer)
8. [WebAssembly ABI and worklet bridge contract](#8-webassembly-abi-and-worklet-bridge-contract)
9. [Concurrency and lifecycle invariants](#9-concurrency-and-lifecycle-invariants)
10. [Visualization subsystem](#10-visualization-subsystem)
11. [Performance instrumentation](#11-performance-instrumentation)
12. [Media metadata subsystem](#12-media-metadata-subsystem)
13. [Preset subsystem](#13-preset-subsystem)
14. [Presentation layer](#14-presentation-layer)
15. [Security model](#15-security-model)
16. [Build and release pipeline](#16-build-and-release-pipeline)
17. [Verification gates](#17-verification-gates)
18. [Continuous integration](#18-continuous-integration)
19. [Test suite](#19-test-suite)
20. [Repository layout](#20-repository-layout)
21. [Defect and debt register](#21-defect-and-debt-register)
22. [Appendix A — constant reference](#appendix-a--constant-reference)
23. [Appendix B — shipped file manifest](#appendix-b--shipped-file-manifest)

---

## 1. Scope and system overview

Super Dribble is a Chromium extension that intercepts the audio output of a single
user-designated browser tab, processes it through a WebAssembly DSP chain, and renders the
result to the system output device. It provides:

- master gain from 0 % to 400 % of unity;
- a 10-band parametric equalizer (peaking biquads, ±24 dB per band);
- an optional stereo spatializer (frequency-dependent mid/side widening plus a feedback delay
  network reverb);
- a 10-band spectrum visualizer driven from a silent analyser tap;
- transport metadata and playback control for the captured page;
- a Lua-authored preset library for both DSP stages.

### 1.1 Design constraints

These constraints are load-bearing. Several are enforced by the release verifier
(`verify-extension.js`); breaking one fails the build rather than degrading at runtime.

| ID | Constraint | Enforcement |
| --- | --- | --- |
| C-1 | All sample-rate DSP *SHALL* execute in WebAssembly. No `BiquadFilterNode`, no `ScriptProcessorNode`, no `onaudioprocess`. | `verify-extension.js` |
| C-2 | The audio graph *SHALL* contain exactly one `GainNode`, and it *SHALL* be the muted analyser sink. | `verify-extension.js` |
| C-3 | The analyser sink gain *SHALL* be literally `0`, so the visualizer tap contributes no audio. | `verify-extension.js` |
| C-4 | The extension *SHALL NOT* declare `content_scripts` or `host_permissions`. | `verify-extension.js`, `tests/manifest.test.js` |
| C-5 | Permissions *SHALL* be exactly `activeTab`, `tabCapture`, `scripting`, `offscreen`. | `verify-extension.js`, `tests/manifest.test.js` |
| C-6 | The packaged extension *SHALL* stay under 20 MB and *SHALL* contain only runtime files. | `verify-extension.js` |
| C-7 | WASM binaries *SHALL* be real Emscripten output with the exact expected export set. Placeholder binaries are not permitted. | `build-wasm.js`, `verify-extension.js` |
| C-8 | The extension CSP *SHALL* include `wasm-unsafe-eval` and *SHALL NOT* include `unsafe-eval`. | `verify-extension.js` |

### 1.2 Non-goals

- Multi-tab simultaneous capture. Exactly one capture session exists at a time.
- Surround/multichannel output. The pipeline is fixed at 2 channels
  (`outputChannelCount: [2]`, `channelCountMode: 'explicit'`).
- Persistent storage. There is no `storage` permission; state lives in the service worker and
  offscreen document for the lifetime of those contexts.

---

## 2. Architecture

### 2.1 Execution contexts

| Context | Entry point | Lifetime | Responsibility |
| --- | --- | --- | --- |
| Popup | `UI/build/index.html` → `assets/main-BCOVmn2O.js` | While open | Presentation, user input, visualization rendering |
| Service worker | `background.js` (`type: module`) | Event-driven, terminable | Capture brokerage, offscreen lifecycle, control-state cache, visualization port registry |
| Offscreen document | `offscreen.html` → `offscreen.js` | While capture is active | Owns `AudioContext`, `MediaStream`, WASM worklets, analyser tap, performance metrics |
| Content script | `content.js` | While the page lives | Media metadata extraction, transport control |
| Equalizer worklet | `wasm/equalizer/equalizer-worklet.js` | With the `AudioContext` | Buffer marshalling to `equalizer.wasm` |
| Spatializer worklet | `wasm/spatializer/spatializer-worklet.js` | Created on demand | Buffer marshalling to `spatializer.wasm` |

The content script is **not** declared in the manifest. It is injected on demand with
`chrome.scripting.executeScript` from the popup, and only into the tab the user acted on.

### 2.2 Topology

```
┌────────────────────────────────────────────────────────────────────────┐
│ Popup  (UI/build/index.html)                                           │
│   AudioEqualizer.tsx ── audioService.ts                                │
└───┬───────────────────────────────┬────────────────────────────────┬───┘
    │ chrome.runtime.sendMessage    │ chrome.tabs.sendMessage        │ chrome.runtime.connect
    │                               │                                │  ('super-dribble-visualization')
    ▼                               ▼                                ▼
┌──────────────────────┐   ┌──────────────────┐          ┌──────────────────────┐
│ background.js        │   │ content.js       │          │ visualizationPorts   │
│  service worker      │   │  (injected)      │          │  Set<Port>           │
│                      │   │                  │          └──────────┬───────────┘
│ tabCapture           │   │ MediaSession     │                     │ enable/disable tap
│  .getMediaStreamId   │   │ HTMLMediaElement │                     │
└──────┬───────────────┘   └──────────────────┘                     │
       │ streamId + cached control state                            │
       ▼                                                            ▼
┌────────────────────────────────────────────────────────────────────────┐
│ offscreen.js                                                           │
│                                                                        │
│  getUserMedia({chromeMediaSource:'tab'})                               │
│        │                                                               │
│        ▼                                                               │
│  MediaStreamSource ──▶ super-dribble-equalizer ─┬──▶ [spatializer] ──▶ destination
│                          (equalizer.wasm)       │      (spatializer.wasm)
│                                                 └──▶ AnalyserNode ──▶ Gain(0) ──▶ destination
│                                                            │           (silent tap)
│                                                            ▼
│                                          BroadcastChannel('super-dribble-visualization')
└────────────────────────────────────────────────────────────────────────┘
```

### 2.3 Layering rule

`audioService.ts` is a **pass-through transport layer**. It performs no DSP, holds no audio
state, and does not interpret payloads beyond shaping them into messages. All authoritative
audio state lives in `offscreen.js`; `background.js` holds a *cache* of the last-known control
values so that the settings survive service-worker restarts and pre-capture edits.

---

## 3. Runtime lifecycle

### 3.1 Capture start

```
Popup                     background.js                offscreen.js
  │
  │ ensureContentScript(tabId)
  │   ping → [inject content.js] → ping
  │
  │ {action:'start_capture', tabId}
  ├──────────────────────────────▶│
  │                               │ setupOffscreenDocument('offscreen.html')
  │                               │   getContexts(OFFSCREEN_DOCUMENT) → create if absent
  │                               │ tabCapture.getMediaStreamId({targetTabId})
  │                               │
  │                               │ {action:'start_capture', target:'offscreen',
  │                               │  streamId, tabId, volume, eqValues, preset,
  │                               │  spatializerEnabled, spatializerParams,
  │                               │  visualizationEnabled}
  │                               ├─────────────────────────────────▶│
  │                               │                                  │ getUserMedia(tab)
  │                               │                                  │ new AudioContext({latencyHint:'interactive'})
  │                               │                                  │ compile equalizer.wasm ∥ addModule(worklet)
  │                               │                                  │ new AudioWorkletNode(...) → await 'ready'
  │                               │                                  │ createAnalyser + createGain(0) tap
  │                               │                                  │ connectProcessedOutput()
  │                               │                                  │ [ensureSpatializer() if requested]
  │                               │                                  │ createMediaStreamSource → connect
  │                               │                                  │ context.resume()
  │                               │◀─────────────── {success:true} ──┤
  │◀──────────── {success:true} ──┤ activeStreamId / activeTabId set │
```

The WASM module compilation and the `audioWorklet.addModule()` call are issued concurrently
via `Promise.all` (`offscreen.js:184-192`), because neither depends on the other. The same
pattern is used for the spatializer (`offscreen.js:301-304`).

### 3.2 Capture stop

`stopProcessing()` (`offscreen.js:515`) is the single teardown path. It is invoked by an
explicit `stop_capture`, by a failed `startProcessing()`, by a re-entrant
`startProcessing()`, and by the `inactive` event on the captured `MediaStream`.

Ordering is significant:

1. Increment both generation counters, invalidating every in-flight async operation.
2. Stop visualization sampling and clear `isProcessing` / `activeTabId`.
3. Snapshot all node references into locals, then null the module-level fields — so a
   concurrent handler sees a torn-down engine immediately, before any `await`.
4. Disconnect nodes, post `{type:'dispose'}` to both worklets, stop every `MediaStreamTrack`.
5. `await context.close()` if the context is not already closed.

When the stream ends externally, the offscreen document notifies the service worker with
`{action:'capture_stopped'}` so the cached `activeStreamId` / `activeTabId` are cleared
(`background.js:185-190`).

### 3.3 Offscreen document creation

`setupOffscreenDocument()` (`background.js:7`) is idempotent under three independent races:

- an existing document is detected via `chrome.runtime.getContexts()` and returns early;
- a concurrent creation is awaited through the `offscreenCreating` promise;
- Chromium's `"Only a single offscreen document may be created"` error is caught and
  swallowed; any other error propagates.

---

## 4. Inter-context message protocol

All messages are plain JSON-serialisable objects with an `action` discriminator. Messages
destined for the offscreen document carry `target: 'offscreen'`; the service worker
early-returns `false` for `target === 'offscreen' | 'ui'` (`background.js:134-136`) so it never
double-handles a forwarded message.

### 4.1 Popup → service worker

| Action | Request fields | Response | Notes |
| --- | --- | --- | --- |
| `start_capture` | `tabId: number` | `{success}` \| `{success:false, error}` | Rejects a non-integer `tabId`. Creates the offscreen document. |
| `stop_capture` | — | `{success:true}` | Always clears cached capture state. |
| `set_volume` | `value: number` (percent) | `{success:true}` or `{success:true, cached:true}` | `cached:true` when no offscreen document exists. |
| `update_eq` | `bandIndex: 0..9`, `gainDb: number` | as above | Sets `currentPreset = 'Custom'`. |
| `update_eq_preset` | `preset: {name, values: number[10]}` | as above | Values normalised by `normalizeEqValues`. |
| `update_spatializer` | `params: object \| null` | as above | `null` disables and destroys nothing — see §7.5. |
| `get_status` | — | status object (§4.4) | Reads through to the offscreen engine when present. |

Unrecognised actions receive `{success:false, error:'Unknown action or unhandled'}`.

### 4.2 Service worker → offscreen document

Every one of these carries `target: 'offscreen'`. Handled by the `switch` at
`offscreen.js:63-139`.

| Action | Request fields | Response |
| --- | --- | --- |
| `start_capture` | `streamId`, `tabId`, `volume`, `eqValues`, `preset`, `spatializerEnabled`, `spatializerParams`, `visualizationEnabled` | `{success:true}` |
| `stop_capture` | — | `{success:true}` |
| `set_volume` | `value` | `{success:true}` |
| `update_eq` | `bandIndex`, `gainDb` | `{success:true}` |
| `update_eq_preset` | `preset.values` | `{success:true}` |
| `update_spatializer` | `params \| null` | `{success:true}` |
| `get_status` | — | `{success, isInitialized, isProcessing, activeTabId, volume, eqValues, preset, spatializerParams, performance}` |
| `get_performance_metrics` | — | `{success:true, performance}` |
| `get_visualization` | — | `{success:true, isProcessing, energy: number[10]}` |
| `set_visualization_enabled` | `enabled: boolean` | `{success:true}` |

Control actions that require a live engine call `requireEqualizer()`, which throws
`'Audio pipeline is not initialized'`; the handler converts any throw into
`{success:false, error}`.

### 4.3 Popup → content script

Sent with `chrome.tabs.sendMessage`. Handled at `content.js:250-272`.

| Action | Request fields | Response |
| --- | --- | --- |
| `ping` | — | `{success:true, message:'Content script is active'}` |
| `media_control` | `command: 'toggle' \| 'next' \| 'previous'` | `{success:true}` \| `{success:false, error}` |
| `get_media_info` | — | media metadata object (§12.1) |

### 4.4 Broadcast and unsolicited messages

| Message | Origin | Channel | Payload |
| --- | --- | --- | --- |
| `visualization_update` | offscreen | `BroadcastChannel('super-dribble-visualization')` | `{action, energy: number[10], sampledAt}` |
| `media_state_update` | content script | `chrome.runtime.sendMessage` | media metadata object, spread onto `{action}` |
| `content_script_ready` | content script | `chrome.runtime.sendMessage` | `{action, url, title}` |
| `capture_stopped` | offscreen | `chrome.runtime.sendMessage` | `{action}` |
| `capture_error` | offscreen | `chrome.runtime.sendMessage` | `{action, error}` |

`sampledAt` is `performance.timeOrigin + performance.now()` — a wall-clock-comparable
timestamp, not a context-relative one (`offscreen.js:372`).

### 4.5 Long-lived visualization port

The popup calls `chrome.runtime.connect({name: 'super-dribble-visualization'})`. The service
worker adds the port to `visualizationPorts` and calls
`setExistingOffscreenVisualizationEnabled(true)`.

> **Invariant.** Connecting the visualization port *SHALL NOT* create the offscreen document
> or start capture. `setExistingOffscreenVisualizationEnabled()` first checks
> `getContexts()` and returns early when no document exists (`background.js:63-75`). Opening
> the popup must never spin up an audio engine.

On `onDisconnect`, the port is removed; when the set becomes empty the analyser tap is
disabled again.

---

## 5. Audio signal chain

### 5.1 Graph

```
MediaStreamSource
   └─▶ AudioWorkletNode 'super-dribble-equalizer'
          ├─▶ AudioContext.destination                    (when spatializer absent)
          ├─▶ AudioWorkletNode 'super-dribble-spatializer' (when enabled)
          │        └─▶ AudioContext.destination
          └─▶ AnalyserNode ─▶ GainNode(gain = 0) ─▶ AudioContext.destination
```

`connectProcessedOutput(node, context)` (`offscreen.js:417`) connects the *current tail* node
to both the destination and the analyser. When the spatializer is inserted, the equalizer is
disconnected from the destination and the spatializer becomes the tail.

### 5.2 Node configuration

Both worklet nodes are constructed with:

```js
{
  numberOfInputs: 1,
  numberOfOutputs: 1,
  outputChannelCount: [2],
  channelCount: 2,
  channelCountMode: 'explicit',
  channelInterpretation: 'speakers',
}
```

Fixing `channelCountMode` to `'explicit'` prevents Chromium from up- or down-mixing based on
the captured stream, which would otherwise change the channel layout the WASM code sees.

### 5.3 Why the silent analyser sink exists

An `AnalyserNode` only advances its internal FFT while it is part of a path that reaches a
destination. Connecting it directly to `destination` would sum the analysed signal into the
output, doubling it. The pipeline therefore routes `Analyser → GainNode(0) → destination`:
the graph is live, the contribution is exactly zero. This is constraint **C-2/C-3**, and
`verify-extension.js` asserts both the single-`createGain` count and the literal
`analyserSink.gain.value = 0` assignment.

---

## 6. DSP specification — equalizer

**Source:** `wasm/equalizer/equalizer.cpp` (143 lines) → `wasm/equalizer/equalizer.wasm`.

### 6.1 Topology

Per channel: 10 cascaded peaking biquad sections, applied in ascending frequency order,
followed by master gain and a hard limiter.

```
x[n] ─▶ BQ(32Hz) ─▶ BQ(64) ─▶ … ─▶ BQ(16kHz) ─▶ × gain_smoothed ─▶ clamp(±1.0) ─▶ y[n]
```

### 6.2 Band definition

| Index | Centre frequency | Q | Gain range |
| --- | --- | --- | --- |
| 0 | 32 Hz | 1.0 | −24 … +24 dB |
| 1 | 64 Hz | 1.0 | −24 … +24 dB |
| 2 | 125 Hz | 1.0 | −24 … +24 dB |
| 3 | 250 Hz | 1.0 | −24 … +24 dB |
| 4 | 500 Hz | 1.0 | −24 … +24 dB |
| 5 | 1 000 Hz | 1.0 | −24 … +24 dB |
| 6 | 2 000 Hz | 1.0 | −24 … +24 dB |
| 7 | 4 000 Hz | 1.0 | −24 … +24 dB |
| 8 | 8 000 Hz | 1.0 | −24 … +24 dB |
| 9 | 16 000 Hz | 1.0 | −24 … +24 dB |

The frequency table is declared in **three** places and *MUST* stay identical:

- `wasm/equalizer/equalizer-worklet.js` — `EQ_FREQUENCIES`, the values actually pushed to WASM;
- `utils/audio-visualization.mjs` — `EQ_CENTER_FREQUENCIES`, used to derive FFT bin ranges;
- `UI/src/constants/frequencyBands.ts` — `FREQUENCY_BANDS`, display labels only.

### 6.3 Peaking biquad coefficients

`BiquadFilter::setPeaking(frequency, q, gainDb, sampleRate)` implements the standard
Audio EQ Cookbook peaking form:

```
A     = 10^(gainDb / 40)
ω     = 2π · f / fs
α     = sin(ω) / (2Q)

b0 = 1 + α·A      b1 = −2·cos(ω)      b2 = 1 − α·A
a0 = 1 + α/A      a1 = −2·cos(ω)      a2 = 1 − α/A
```

Coefficients are normalised by `a0` and evaluated as a Direct Form I difference equation with
per-channel state.

### 6.4 Gain and limiting

| Parameter | Range | Behaviour |
| --- | --- | --- |
| Volume | 0 … 400 % | Clamped on entry. `1.0` = unity. |
| Band gain | −24 … +24 dB | Clamped on entry. |
| Output | −1.0 … +1.0 | Hard clamp per sample. |

Volume changes are not applied instantaneously. A one-pole smoother runs at sample rate:

```
coefficient = exp(-1 / (0.01 · sampleRate))          // ≈ 10 ms time constant
g[n] = target + (g[n-1] − target) · coefficient
```

This is what prevents the audible zipper artefact when the volume slider is dragged.

### 6.5 Exports

```
create_equalizer(sampleRate)      → pointer
destroy_equalizer(ptr)
set_volume_percent(ptr, percent)
set_band(ptr, index, frequency, q, gainDb)
process_buffer(ptr, leftPtr, rightPtr, frameCount)
```

`process_buffer` operates **in place**: it reads and overwrites the two `Float32Array`
scratch buffers.

---

## 7. DSP specification — spatializer

**Source:** `wasm/spatializer/spatializer.cpp` (310 lines) → `wasm/spatializer/spatializer.wasm`.

The spatializer is two independent effects in one module: a frequency-dependent stereo
widener and a feedback-delay-network reverb.

### 7.1 Frequency-dependent M/S widening

```
M = (L + R) / 2
S = (L − R) / 2

S_low  = LR4_lowpass(S)      · lowWidthFactor   · width
S_high = LR4_highpass(S)     · highWidthFactor  · width

L' = M + (S_low + S_high)
R' = M − (S_low + S_high)
```

Splitting the side signal at a crossover and widening the two halves by different factors is
what keeps the bass mono-compatible while the top end opens up. Default factors are
`lowWidthFactor = 0.3` (bass largely collapsed toward centre) and `highWidthFactor = 1.5`.

The crossover is a **4th-order Linkwitz-Riley**, built as two cascaded Butterworth biquads per
branch (`Q = 0.70710678`). Two cascaded 2nd-order Butterworth sections give the −6 dB
crossover point and allpass summation that LR4 requires.

### 7.2 FDN reverb

| Property | Value |
| --- | --- |
| Order | 4 |
| Feedback matrix | 4×4 Hadamard, normalisation factor `0.5` |
| Base delay primes | 1553, 1871, 2083, 2221 |
| Target delay span | ≈ 100 ms, scaled from the primes at the active sample rate |
| Damping | One-pole lowpass inside each feedback path |
| Decay gain | `powf(0.001f, delayLength / (decay · sampleRate))` |

A Hadamard matrix is used because it is orthogonal — energy-preserving — so the decay is
governed solely by the per-line gains rather than by matrix loss. The delay lengths are
mutually prime so that the modal density stays high and no comb resonances line up.

The decay gain expression is the standard RT60 formulation: the gain that attenuates a line by
60 dB (`0.001` in amplitude) over `decay · sampleRate` samples.

### 7.3 Parameter ranges

| Parameter | Setter | Range | Default |
| --- | --- | --- | --- |
| `width` | `spatializer_set_width` | unclamped multiplier | — |
| `decay` | `spatializer_set_decay` | 0 … 1 | — |
| `damping` | `spatializer_set_damping` | 0 … 1 | — |
| `mix` | `spatializer_set_mix` | 0 … 1 | — |
| `crossoverFrequency` | `spatializer_set_crossover_freq` | 50 … 500 Hz | 250 Hz |
| `lowWidthFactor` | `spatializer_set_low_width_factor` | 0 … 1 | 0.3 |
| `highWidthFactor` | `spatializer_set_high_width_factor` | 0 … 3 | 1.5 |

All clamping happens in C++, on entry to each setter. The JavaScript layer performs only a
`Number.isFinite` guard (`spatializer-worklet.js:85-105`) — it does not duplicate the ranges,
deliberately, so there is exactly one authority for them.

### 7.4 Exports

```
create_spatializer(sampleRate)   → pointer
destroy_spatializer(ptr)
spatializer_set_width(ptr, value)
spatializer_set_decay(ptr, value)
spatializer_set_damping(ptr, value)
spatializer_set_mix(ptr, value)
spatializer_set_crossover_freq(ptr, value)
spatializer_set_low_width_factor(ptr, value)
spatializer_set_high_width_factor(ptr, value)
spatializer_process_buffer(ptr, leftPtr, rightPtr, frameCount)
```

### 7.5 Enable / disable semantics

`ensureSpatializer(params)` (`offscreen.js:282`) is lazy and idempotent:

- if the node exists, it forwards `{type:'set-params', params}` and returns;
- if a creation is already in flight, it awaits that promise and then forwards the params —
  so two rapid enables do not create two nodes;
- otherwise it compiles the WASM module and adds the worklet module concurrently, then
  constructs the node and re-splices the graph.

`disableSpatializer()` removes the node from the graph. The spatializer WASM module remains in
`wasmModuleCache`, so a subsequent re-enable skips recompilation.

---

## 8. WebAssembly ABI and worklet bridge contract

### 8.1 Compilation

`build-wasm.js` invokes `em++` with:

```
-std=c++17 -O3 -fno-exceptions --no-entry
-sSTANDALONE_WASM=1
-sEXPORTED_FUNCTIONS=<module exports>,_malloc,_free
-sFILESYSTEM=0
-sMALLOC=emmalloc
-sALLOW_MEMORY_GROWTH=0
-sINITIAL_MEMORY=8388608      # 8 MiB
-sSTACK_SIZE=131072           # 128 KiB
-sASSERTIONS=0
```

Rationale for the non-obvious flags:

| Flag | Reason |
| --- | --- |
| `-sSTANDALONE_WASM=1` | Produces a bare `.wasm` with no JS glue, so it can be instantiated directly inside an `AudioWorkletGlobalScope` where no DOM or loader exists. |
| `-sALLOW_MEMORY_GROWTH=0` | Memory growth detaches and reallocates the `ArrayBuffer`, which would silently invalidate the `Float32Array` views held across `process()` calls. Fixed memory makes the views permanently valid. |
| `-fno-exceptions` | Unwinding in the audio render thread is not acceptable, and it removes the exception tables from the binary. |
| `-sFILESYSTEM=0`, `-sMALLOC=emmalloc` | Size. The equalizer binary is 10 753 bytes; the spatializer is 25 024 bytes. |

Compiler discovery order (`compilerCandidates()`): `$EMSDK/upstream/emscripten/em++.{exe,bat}`,
`~/emsdk/...`, `<repo>/emsdk/...`, then bare `em++` on `PATH`. If none responds to
`--version` with exit code 0, the build **fails**. It never emits a stub binary — that is
constraint **C-7**, and it exists because a stub `.wasm` that loads but outputs silence is far
harder to diagnose than a failed build.

### 8.2 Memory model

`INITIAL_MEMORY` is 8 MiB and fixed. Each worklet allocates two scratch buffers once, in its
constructor:

```js
const bufferBytes = BUFFER_CAPACITY * Float32Array.BYTES_PER_ELEMENT;  // 128 * 4 = 512
this.leftPointer  = this.exports.malloc(bufferBytes);
this.rightPointer = this.exports.malloc(bufferBytes);
this.leftBuffer   = new Float32Array(this.exports.memory.buffer, this.leftPointer,  128);
this.rightBuffer  = new Float32Array(this.exports.memory.buffer, this.rightPointer, 128);
```

`BUFFER_CAPACITY = 128` matches the Web Audio render quantum. `process()` still loops in
128-frame chunks rather than assuming the quantum size, so a future 256-frame render quantum
would not overflow the allocation.

There is **no allocation in the audio callback**. Every `process()` call reuses the same two
buffers and the same two pointers.

### 8.3 WASI import shim

`STANDALONE_WASM` output imports a small `wasi_snapshot_preview1` surface. The worklets supply
stubs that return `WASI_BAD_FILE_DESCRIPTOR` (8) for `fd_write`, `fd_close`, and `fd_seek`
(`spatializer-worklet.js:12-20`). Nothing in the DSP path performs I/O; the stubs exist only to
satisfy instantiation.

Note the asymmetry: the equalizer worklet instantiates with `{}` as its import object, while
the spatializer supplies the WASI shim. Both currently link, because the compiler only emits
those imports when reachable code needs them.

### 8.4 Instantiation sequence

```js
const instance = new WebAssembly.Instance(processorOptions.wasmModule, imports);
this.exports = instance.exports;
this.exports._initialize();       // STANDALONE_WASM reactor initialiser — runs C++ ctors
```

`_initialize()` *MUST* be called before any other export. It runs static constructors; skipping
it leaves global state uninitialised.

The `WebAssembly.Module` is passed through `processorOptions`. This is deliberate: a compiled
`Module` is structured-cloneable, so the main thread compiles once and the worklet instantiates
without a second fetch or compile.

### 8.5 Port protocol

| Direction | Message | Meaning |
| --- | --- | --- |
| worklet → main | `{type:'ready'}` | Instantiation, allocation, and initial parameters all succeeded. |
| worklet → main | `{type:'error', error: string}` | Constructor failed; the processor has already self-disposed. |
| main → worklet | `{type:'set-volume', value}` | Equalizer only. |
| main → worklet | `{type:'set-band', index, gainDb}` | Equalizer only. |
| main → worklet | `{type:'set-eq', values: number[10]}` | Equalizer only. |
| main → worklet | `{type:'set-params', params}` | Spatializer only. |
| main → worklet | `{type:'dispose'}` | Free WASM allocations, destroy the instance, stop processing. |

`waitForProcessor(node, label)` (`offscreen.js:471`) resolves on `ready`, rejects on `error`,
and rejects with `"<label> WASM initialization timed out"` after **5 000 ms**. It removes its
listener and clears its timer on every exit path.

### 8.6 Bridge purity

> **Invariant.** The worklet files *SHALL* contain no DSP. They marshal buffers and forward
> parameters. Every filter, gain, delay, and clamp lives in C++.

`process()` returns `false` once disposed — which lets Chromium garbage-collect the
processor — and `true` otherwise. Channels beyond index 1 are zero-filled
(`spatializer-worklet.js:164-166`).

---

## 9. Concurrency and lifecycle invariants

The offscreen engine performs many `await`s during startup. Between any two of them, the user
may have closed the popup, stopped capture, or started capture on a different tab. Two
generation counters make every one of those windows safe.

### 9.1 Generation counters

| Counter | Incremented by | Guard |
| --- | --- | --- |
| `pipelineGeneration` | `startProcessing()` entry, `stopProcessing()` | `assertPipelineActive(generation, context, equalizer)` |
| `spatializerGeneration` | `ensureSpatializer()` creation, `stopProcessing()` | `assertSpatializerActive(generation)` |

`assertPipelineActive` throws `'Audio pipeline operation was superseded'` if *any* of three
conditions hold: the generation changed, the module-level `audioContext` is no longer the one
captured at entry, or the equalizer node was swapped. Checking the object identity — not just
the counter — catches a teardown-then-restart that happened to land on the same count.

The check is applied after every await point in `startProcessing()`: after WASM compile, after
`waitForProcessor`, before graph construction, and after `context.resume()`.

### 9.2 Superseded stream cleanup

If the generation changed while `getUserMedia` was pending, the newly acquired stream is
explicitly stopped before throwing (`offscreen.js:168-171`). Without this, a superseded
capture would leak a live tab-capture track and leave the tab's recording indicator on.

### 9.3 WASM module cache

`wasmModuleCache: Map<path, Promise<WebAssembly.Module>>` memoises compilation across capture
sessions. The cached value is the *promise*, so two concurrent starts share one compile. On
rejection the entry is deleted (`offscreen.js:462-465`), so a transient fetch failure does not
poison the cache permanently.

### 9.4 Service-worker termination

The service worker is terminable at any time. Its cached control state
(`currentVolume`, `currentEqValues`, `currentPreset`, `currentSpatializerParams`) is therefore
**not** authoritative. `get_status` reads through to the offscreen engine and *rehydrates* the
cache from the response (`background.js:226-234`), falling back to the cache only when no
engine exists.

Control changes made while no offscreen document exists are cached and answered with
`{success:true, cached:true}`; they are then replayed as part of the next `start_capture`
payload.

---

## 10. Visualization subsystem

### 10.1 Analyser configuration

| Setting | Value | Rationale |
| --- | --- | --- |
| `fftSize` | 2048 | ≈ 23 Hz resolution at 48 kHz — enough to separate the 32 Hz and 64 Hz bands. |
| `minDecibels` | −94 | Roughly the 16-bit noise floor. |
| `maxDecibels` | −8 | Leaves headroom so normal programme material does not sit pinned at full scale. |
| `smoothingTimeConstant` | 0.1 | Light temporal smoothing; the visual smoothing is applied in the UI instead. |

### 10.2 Band energy derivation

`utils/audio-visualization.mjs` (shared by the engine and the tests):

```js
BAND_EDGE_FACTOR = Math.SQRT2

createBandBinRanges(sampleRate, fftSize, centerFrequencies = EQ_CENTER_FREQUENCIES)
  → [{ centerFrequency, startBin, endBin }, ...]      // 10 entries
```

Each band spans `[f / √2, f · √2]` — one octave centred on the band frequency — converted to
FFT bin indices from the *actual* `sampleRate` and `fftSize`. Bin 0 (DC) is excluded and the
top index is clamped to `frequencyBinCount − 1`.

`calculateBandEnergies(frequencyData, bandRanges, output)` computes, per band, the RMS of the
normalised byte magnitudes and then applies a noise gate:

```
gated = (rms − 0.025) / 0.975      clamped to [0, 1]
```

Subtracting a 2.5 % floor and rescaling means true silence reads exactly `0` rather than a
shimmering low value — the difference between a visualizer that rests and one that never
settles.

`smoothBandEnergies(incoming, current, attack = 0.5, release = 0.12)` provides asymmetric
ballistics: fast attack, slow release, so transients register but decay reads smoothly.

### 10.3 Sampling clock

Sampling runs on a self-rescheduling `setTimeout` chain at
`VISUALIZATION_FRAME_INTERVAL_MS = 1000 / 60` (`offscreen.js:355-408`).

`requestAnimationFrame` is unavailable in an offscreen document that is never painted, and a
fixed `setTimeout(16)` drifts. The implementation therefore maintains an absolute `nextSampleAt`
deadline and, when a sample overruns, **skips whole missed slots** instead of firing a burst:

```js
nextSampleAt += VISUALIZATION_FRAME_INTERVAL_MS;
if (nextSampleAt <= now) {
  const missedSlots = Math.floor((now - nextSampleAt) / VISUALIZATION_FRAME_INTERVAL_MS) + 1;
  nextSampleAt += missedSlots * VISUALIZATION_FRAME_INTERVAL_MS;
}
```

This keeps the effective rate pinned at 60 Hz rather than oscillating between 60 and 30 after a
single slow frame.

### 10.4 Frame transport

A single pre-allocated message object (`visualizationFrameMessage`) is mutated and posted each
frame. `BroadcastChannel` structured-clones on post, so reuse is safe and avoids 60
allocations per second.

Sampling only runs while `visualizationEnabled && isProcessing`. The popup owns the enable
signal through its port (§4.5); when the popup closes, sampling stops.

---

## 11. Performance instrumentation

`createPerformanceMetrics()` (`offscreen.js:422`) allocates a fresh metrics object at the start
of every capture. All durations are milliseconds rounded to 2 decimal places
(`roundMetric = Math.round(v * 100) / 100`); `null` means "not yet measured".

| Key | Definition |
| --- | --- |
| `captureMs` | Duration of `getUserMedia` for the tab stream. |
| `audioContextCreateMs` | `new AudioContext({latencyHint:'interactive'})`. |
| `wasmModuleReadyMs` | Fetch + `WebAssembly.compile` of `equalizer.wasm` (cache hit ⇒ near zero). |
| `workletModuleReadyMs` | `audioWorklet.addModule()` for the equalizer bridge. |
| `wasmProcessorReadyMs` | Node construction → `ready` message. |
| `spatializerReadyMs` | Full spatializer bring-up, when requested at start. |
| `analyserInitMs` | Analyser + silent sink construction and band-range derivation. |
| `audioGraphCreateMs` | Node wiring, including any spatializer splice. |
| `timeToAudioReadyMs` | End-to-end: `startProcessing()` entry → `isProcessing = true`. **The headline number.** |
| `visualizationFirstFrameMs` | Pipeline start → first visualization frame emitted. |
| `visualizationSampleMs` | Duration of the most recent sample+publish cycle. |
| `visualizationFps` | Frames per second, recomputed over each ≥1 s window. |
| `baseLatencyMs` | `context.baseLatency × 1000`. |
| `outputLatencyMs` | `context.outputLatency × 1000`. |
| `sampleRate` | Negotiated `AudioContext` sample rate. |
| `fftSize` | 2048. |

Retrieve with `{action:'get_performance_metrics', target:'offscreen'}`, or read the
`performance` field of `get_status`. The full object is also logged once per successful start
(`offscreen.js:268`).

---

## 12. Media metadata subsystem

**Source:** `content.js`. Guarded by `globalThis.__superDribbleContentScriptLoaded` so repeated
injection is a no-op.

### 12.1 Metadata shape

```ts
{
  isPlaying: boolean,
  title: string,
  artist: string,
  album: string,
  artwork: string,        // absolute URL, '' when unavailable
  appName: string,
  duration?: number,      // seconds
  position?: number,      // seconds
}
```

### 12.2 Resolution order

1. **`navigator.mediaSession.metadata`** — the primary source. `title`, `artist`, `album`, and
   `artwork` are read from it.
2. **Site-specific DOM scraping** — currently Spotify only, used when MediaSession yields
   nothing better than `document.title`.
3. **`document.title`** — last-resort title.

`duration` and `position` always come from the selected `HTMLMediaElement`, and only when
`isFinite`.

### 12.3 Artwork selection

`getArtwork(md)` (`content.js:73-91`) implements the algorithm that makes the popup show the
same thumbnail the site itself shows:

1. Iterate `md.artwork`, an array of `{src, sizes, type}` where `sizes` is a space-separated
   list such as `"96x96 256x256"`.
2. For each entry take the **last** size token — the largest declared — parse `W x H`, and
   compute area.
3. Keep the entry with the greatest area.
4. Resolve the winner against `location.href` via `new URL(src, location.href).href`, because
   MediaSession sources may be relative.
5. If MediaSession supplies no artwork, fall back to
   `<meta property="og:image">` / `<meta name="og:image">`.
6. Return `''` if neither yields a URL.

The popup keeps the URL of any image that fails to load and suppresses re-render for that exact
URL, so a broken artwork link cannot drive a load-error loop across the 2 s metadata poll.

### 12.4 Change detection

`sendMediaUpdate(force)` dedupes on a key of
`{title, artist, appName, isPlaying, floor(duration)}`. Position-only updates are throttled to
**1 Hz** (`content.js:137`).

`artwork` is intentionally absent from the dedupe key: it changes only when the track changes,
which the title/artist key already captures, and including a long URL in the key would cost a
string comparison per `timeupdate`.

Element listeners are attached for `play`, `playing`, `pause`, `ended`, `loadedmetadata`,
`durationchange` (forced update) and `timeupdate` (throttled). A `MutationObserver` on
`document.documentElement` attaches listeners to media elements added later — necessary for
SPA players that swap `<audio>`/`<video>` nodes between tracks.

`'Extension context invalidated'` is caught specifically and disconnects the observer, so a
reloaded extension leaves no console-spamming orphan script behind.

### 12.5 Transport control

`media_control` supports `toggle`, `next`, `previous`. `toggle` acts directly on the media
element; `next` and `previous` dispatch synthetic clicks against a selector list covering
Spotify, YouTube, and SoundCloud, then push a forced metadata update after 300 ms. Unmatched
selectors return `{success:false, error:'<Next|Previous> control not found on this page'}`.

### 12.6 On-demand injection

`ensureContentScript(tabId)` in `UI/src/lib/audioService.ts`:

1. `ping` the tab;
2. on failure, `chrome.scripting.executeScript({target:{tabId}, files:['content.js']})`;
3. `ping` again to confirm.

The result is memoised per tab in `contentScriptReadiness`. This is the mechanism that lets the
extension ship with **no** `content_scripts` block and **no** host permissions (C-4): code
reaches a page only after the user opens the popup on it.

---

## 13. Preset subsystem

### 13.1 Sources

| File | Table | Entries |
| --- | --- | --- |
| `wasm/equalizer/presets.lua` | `presets` | 13 — Flat, Rock, Hard Rock, Metal, Pop, Electronic, Hip Hop, Jazz, Classical, Acoustic, Blues, Treble Boost, Clarity |
| `wasm/spatializer/spatializer_presets.lua` | `spatial_presets` | 11 — Auditorium, Echo, Great hall, Light reverb, Scene, Small Room, Stadium, Studio, Studio Room, Concert Hall, Expansive Cinema |
| `UI/src/constants/eq_presets.ts` | `EQ_PRESETS` | 7 — Flat, Rock, Pop, Jazz, Classical, Electronic, Hip Hop |

### 13.2 Lua schema

Equalizer preset entries carry `name`, `description`, `category`, `tags`, `author`, `version`,
and a `bands` array of `{frequency, gain, q}`.

> **Band-count mismatch, by design.** Lua equalizer presets declare **16** bands: indices 1–10
> (Lua 1-based) map to the engine's 10 sliders, and 11–16 are supplementary fine-tuning entries.
> The engine has exactly 10 bands, so `applyLuaPreset()` slices indices 0–9 and discards the
> rest. The extra bands are forward-looking metadata, not active DSP.

Spatializer preset entries carry `name`, `description`, and a `params` object of
`{width, decay, damping, mix}`.

### 13.3 Parser

`UI/src/utils/lua-preset-parser.ts` — class `LuaPresetParser`. It is a **regex and
brace-balancing parser, not a Lua interpreter**:

| Method | Behaviour |
| --- | --- |
| `parsePresets(luaContent, 'equalizer' \| 'spatializer')` | Strips `--` and `--[[ ]]` comments, extracts the `presets` / `spatial_presets` table, splits top-level objects. |
| `splitTopLevelObjects(body)` | Brace-depth scan; returns the interior of each depth-1 `{...}`. |
| `parseLuaObjectBody(body)` | Extracts `key = "string"` and `key = number` pairs; recurses into `bands`, `params`, `tags`. |
| `extractBalancedBrace(text, openIndex)` | Depth counter from a known `{`. |
| `loadEqualizerPresets()` / `loadSpatializerPresets()` | `fetch(chrome.runtime.getURL(path))` then parse. |

Every failure path returns `[]` and logs, rather than throwing — a malformed preset file
degrades the library, it does not break the popup.

The reason this is not a real Lua VM is CSP. MV3 forbids `unsafe-eval`, and a Lua interpreter
implemented in JavaScript needs dynamic code generation for anything beyond table literals.
Since presets are declarative data, a bounded parser is sufficient and keeps the CSP clean
(C-8).

### 13.4 Application path

```
LuaPresetManager (lazy chunk)
   └─ audioService.applyLuaPreset(preset)
        ├─ bands.slice(0, 10) → gain values
        └─ {action:'update_eq_preset', preset:{name, values}}
              └─ background.js cache → offscreen → {type:'set-eq'} → set_band × 10
```

---

## 14. Presentation layer

### 14.1 Stack

React 18.3.1, TypeScript 5.5.3, Tailwind CSS 3.4.11, Vite 6.2.2 with
`@vitejs/plugin-react-swc`, `lucide-react` for iconography. Package manager `pnpm@10.29.1`.

### 14.2 Popup geometry contract

Chromium caps an extension popup at approximately **800 × 600 px** and does not scroll it for
you. The popup therefore uses fixed pixel geometry throughout.

| Element | Value |
| --- | --- |
| `html` / `body` background | `#0a0a0a`, opaque, edge to edge |
| `body` width × height | 468 × 596 px |
| Card | 468 × 596, `overflow: hidden`, no border radius |
| Content column (after 20 px padding, 40 px header, gaps) | 492 px |
| Now Playing panel | 148 px |
| Master Volume panel | 49 px |
| EQ / Spatializer flip card | 295 px |

> **Rule: never use `min-h-screen`, `100vh`, or `flex-grow` for popup layout.**
>
> Two failure modes motivate this. First, viewport units inside a popup resolve against a
> viewport the popup itself is sizing, which produces scroll. Second — measured, not
> theorised — Chromium's flex distribution did **not** honour `flex: 3/1/6` with
> `flex-basis: 0`: the three panels resolved to 170.8 / 47.6 / 273.6 px instead of the required
> 147.6 / 49.2 / 295.2, even though the total matched the 492 px column exactly. Pinning
> `flex: none` with explicit heights of 148 / 49 / 295 measured at the intended 3 : 1 : 6.

> **Rule: the popup document must be opaque.** A transparent popup body renders as a hard black
> rectangle on Windows *and* suppresses the browser's own window corner rounding. Filling
> `#0a0a0a` edge to edge and setting **no** radius on the card lets the browser round the
> window natively.

### 14.3 Flip card

The EQ panel is a 3D flip container: front face = 10 EQ sliders, preset dropdown, reset; back
face = spatializer toggles. `perspective: 1200px`, `transform-style: preserve-3d`,
`transform: rotateY(180deg)` over `0.6s cubic-bezier(0.16, 1, 0.3, 1)`.

> **Chromium defect workaround.** `backface-visibility: hidden` is not honoured on elements
> that also have `backdrop-filter`, so both faces bleed through mid-rotation. The mitigation is
> a delayed opacity swap — `transition: opacity 0s linear 0.3s` on `.flip-face` — which flips
> `opacity` and `pointer-events` at the animation midpoint, while the card is edge-on and
> invisible. See `UI/src/index.css:488-506`.

`prefers-reduced-motion: reduce` disables both the rotation and the opacity transition.

### 14.4 Deterministic build output

`UI/vite.config.ts` **pins output filenames** rather than letting Rollup hash them:

| Chunk | Emitted name |
| --- | --- |
| entry | `assets/main-BCOVmn2O.js` |
| CSS | `assets/main-CtJRbM6p.css` |
| `LuaPresetManager` | `assets/LuaPresetManager-BIxQlNX6.js` |
| `lua-preset-parser` | `assets/lua-preset-parser-ByQ3BOJ_.js` |

Consequence: a UI rebuild never changes the asset paths, so `manifest.json` — which references
only `UI/build/index.html` — never needs editing after a UI change. `base: './'` keeps the
generated references relative so they resolve under `chrome-extension://`.

Also set: `publicDir: false`, `outDir: 'build'`, `emptyOutDir: true`, dev server on port 8080.

Path aliases: `@`, `@components`, `@lib`, `@equalizer`, `@pages`, `@types`.

---

## 15. Security model

### 15.1 Permissions

| Permission | Purpose | Why not broader |
| --- | --- | --- |
| `activeTab` | Temporary access to the tab the user invoked the extension on. | Grants nothing until the user clicks the action; expires on navigation. |
| `tabCapture` | Obtain a tab-audio stream ID. | Required for the core function. |
| `scripting` | Inject `content.js` into the invoked tab. | Paired with `activeTab`, so injection is confined to that tab. |
| `offscreen` | Host the `AudioContext` outside the popup. | The alternative — running audio in the popup — would kill playback on popup close. |

The manifest declares **no** `host_permissions` and **no** `content_scripts` (C-4). This is
asserted by both `verify-extension.js` and `tests/manifest.test.js`.

### 15.2 Content Security Policy

```
script-src 'self' 'wasm-unsafe-eval'; object-src 'self'
```

`wasm-unsafe-eval` is required for `WebAssembly.compile` / `new WebAssembly.Instance`. Plain
`unsafe-eval` is **not** present, which is precisely why the Lua preset system uses a bounded
parser rather than an interpreter (§13.3).

### 15.3 Data handling

- No network egress. Nothing is fetched except extension-internal resources via
  `chrome.runtime.getURL`. The one exception is remote artwork, loaded as an `<img src>` from
  the URL the page itself declares.
- No persistent storage. No `storage` permission.
- No telemetry. Performance metrics are in-memory and retrievable only by the popup.
- Audio never leaves the process: the captured stream is routed to the local output device.

### 15.4 Offscreen document justification

Declared as `reasons: ['AUDIO_PLAYBACK']` with the justification
`"Processing audio for equalization and effects"`. Both fields are surfaced during Chrome Web
Store review.

---

## 16. Build and release pipeline

There is **no root `package.json`**. Root-level tooling is invoked directly with `node`. The
UI is a self-contained pnpm workspace under `UI/`.

### 16.1 One-shot build

```bash
node build-extension.js
```

Stages (`build-extension.js:129-150`):

1. `node build-wasm.js` — compile both C++ modules.
2. `pnpm run build` in `UI/` — `tsc -b && vite build` into `UI/build/`.
3. `assertRuntimeInputs()` — every entry in `runtimeFiles` must exist and be **non-empty**;
   every entry in `runtimeDirectories` must exist and be non-empty.
4. `copyRuntimePackage()` — wipe and rebuild `output/Super-Dribble` with runtime files only.
5. `node verify-extension.js output/Super-Dribble` — see §17. A failure aborts the build.
6. `createReleaseArchive()` — `output/Super-Dribble.zip`.
7. Report package size, ZIP size, and the exact folder to load.

Archiving is platform-specific: PowerShell `Compress-Archive -CompressionLevel Optimal -Force`
on Windows (with `'` → `''` quoting), `zip -q -r` elsewhere. Both produce an archive with the
extension files at the **root**, which is what the Web Store requires.

### 16.2 Targeted builds

```bash
node build-wasm.js                      # both modules
node build-wasm.js --module=equalizer
node build-wasm.js --module=spatializer
node build-wasm.js --module=all
```

An unknown module name is a hard error listing the valid values.

```bash
cd UI
pnpm run build        # tsc -b && vite build
pnpm run dev          # Vite dev server, port 8080
pnpm test             # vitest --run
pnpm run typecheck
pnpm run lint
pnpm run format.fix
```

### 16.3 Loading

Load `output/Super-Dribble` in `chrome://extensions`. **Do not load the repository root** —
Chrome counts every file beneath the selected folder, including `node_modules` and any local
Emscripten SDK.

> `content.js`, `background.js`, `offscreen.js`, and the worklets are **not bundled**. Editing
> them requires reloading the unpacked extension; a UI-only rebuild does not pick them up.

---

## 17. Verification gates

`verify-extension.js` is the release gate. It takes a package directory as `argv[2]` and exits
non-zero on any failure.

### 17.1 Package integrity

- Every required runtime file exists and has non-zero size.
- No non-runtime files are present in the package.
- Total package size ≤ 20 MB.

### 17.2 WASM integrity

- Both `.wasm` files begin with the magic header `\0asm`.
- Each exports **exactly** its expected symbol set, plus `malloc` and `free`.

### 17.3 DSP purity assertions

These are the machine-checked form of constraints C-1 through C-3:

| Assertion | Rejects / requires |
| --- | --- |
| No Web Audio DSP | source must not match `createBiquadFilter\|createScriptProcessor\|onaudioprocess` |
| Single gain node | exactly one `createGain` occurrence |
| Silent tap | must contain `analyserSink.gain.value = 0` |
| Worklet-based | must contain `AudioWorkletNode` |

A regression that quietly reintroduces a `BiquadFilterNode` fails the build rather than
shipping a JS-DSP path alongside the WASM one.

### 17.4 Manifest and policy

- Required fields present; permissions match the allowlist exactly (C-5).
- `content_scripts` and `host_permissions` absent (C-4).
- The popup file referenced by `action.default_popup` exists.
- CSP contains `wasm-unsafe-eval`.
- Every asset referenced by the built `index.html` resolves inside `UI/build/`.

---

## 18. Continuous integration

`.github/workflows/ci.yml` — `ubuntu-latest`, 15-minute timeout.

| Step | Detail |
| --- | --- |
| pnpm | `pnpm/action-setup`, version 10.29.1 |
| Node | 22, pnpm cache keyed on `UI/pnpm-lock.yaml` |
| Emscripten | `mymindstorm/setup-emsdk@v14`, emsdk 6.0.6 |
| Install | `pnpm install --frozen-lockfile` (in `UI/`) |
| Lint | `pnpm run lint` |
| UI tests | `pnpm test` (vitest) |
| Node tests | `node --test tests/*.test.js` |
| Package | `node build-extension.js` |
| Artifact | `output/Super-Dribble.zip`, 14-day retention |

Because CI runs the full `build-extension.js`, every push is gated on all of §17.

---

## 19. Test suite

### 19.1 Node tests (`node --test tests/*.test.js`)

| File | Coverage |
| --- | --- |
| `tests/audio-architecture.test.js` | Static analysis of `offscreen.js` / worklet sources. Extracts individual function and method bodies by brace matching and asserts the graph shape and DSP-purity properties. |
| `tests/background.test.js` | Loads `background.js` in a `vm` with a mocked `chrome` namespace. Exercises offscreen creation, message routing, control caching, and the visualization port handler under both `offscreenExists: true/false`. |
| `tests/manifest.test.js` | Permission allowlist, absence of `content_scripts` / `host_permissions`, presence of `content.js`, and that it defines `initializeSuperDribbleContentScript` and the `__superDribbleContentScriptLoaded` guard. |
| `tests/visualization.test.js` | `createBandBinRanges` / `calculateBandEnergies` / `smoothBandEnergies`. Verifies 10 ranges, DC-bin exclusion, non-overlap of adjacent bands, the `frequencyBinCount − 1` clamp, sample-rate independence (48 kHz/2048 vs 44.1 kHz/4096), and the degenerate-collapse behaviour at undersized FFTs (256/512/1024). |

The Node tests deliberately avoid a browser harness. They parse and `vm`-load the real sources,
so they assert properties of the shipped code rather than of a test double.

### 19.2 UI tests (`pnpm test`)

Vitest 3.1.4. `UI/src/utils/lua-preset-parser.spec.ts` covers the preset parser.

---

## 20. Repository layout

```
Super-dribble/
├── manifest.json                        MV3 manifest — 33 lines, no asset hashes
├── background.js                        Service worker
├── content.js                           On-demand content script
├── offscreen.html / offscreen.js        Audio engine host + engine
├── build-wasm.js                        Emscripten driver
├── build-extension.js                   Package + archive driver
├── verify-extension.js                  Release gate
├── extension-info.json                  Build descriptor (name, version, feature list)
├── icons/                               icon16.png (513 B), icon48.png (2 101 B), icon128.png (8 184 B)
├── wasm/
│   ├── equalizer/
│   │   ├── equalizer.cpp                10-band peaking EQ, gain smoothing, limiter
│   │   ├── equalizer.wasm               10 753 B
│   │   ├── equalizer-worklet.js         Bridge — no DSP
│   │   └── presets.lua                  13 presets, 16 bands each
│   └── spatializer/
│       ├── spatializer.cpp              M/S widener + 4×4 Hadamard FDN reverb
│       ├── spatializer.wasm             25 024 B
│       ├── spatializer-worklet.js       Bridge — no DSP
│       └── spatializer_presets.lua      11 presets
├── utils/
│   ├── audio-visualization.mjs          Band/bin math — shared by engine and tests
│   └── lua-preset-parser.js             Standalone parser (not in the runtime manifest)
├── lua/
│   ├── fengari.min.js                   Shipped; superseded by the regex parser (§21)
│   └── parser.js                        Legacy
├── UI/
│   ├── index.html                       468 × 596 popup shell
│   ├── vite.config.ts                   Pinned asset names
│   ├── src/
│   │   ├── equalizer/AudioEqualizer.tsx Orchestration hub
│   │   ├── lib/audioService.ts          Messaging transport
│   │   ├── constants/                   frequencyBands.ts, eq_presets.ts
│   │   ├── utils/lua-preset-parser.ts   CSP-safe preset parser
│   │   └── index.css                    Popup geometry, flip card, slider styling
│   └── build/                           Build output — loaded by the manifest
├── tests/                               4 Node test files
├── docs/                                This document, user guide, contributing, CoC
├── output/                              Generated: Super-Dribble/ and Super-Dribble.zip
└── .github/workflows/ci.yml             CI pipeline
```

---

## 21. Defect and debt register

Recorded so that a reader is not misled by the tree, and so these are not rediscovered as
"bugs" later. None of these affect the audio path.

| ID | Item | Location | Impact | Suggested action |
| --- | --- | --- | --- | --- |
| D-1 | `controlPlayback()` types accept `'play'` and `'pause'`, but the content script handles only `toggle`, `next`, `previous`. Those two commands fall through to `{success:false, error:'Unknown command'}`. | `UI/src/lib/audioService.ts:232`, `content.js:241-242` | Type signature promises unimplemented behaviour. | Narrow the union, or implement the two cases. |
| D-2 | Three tracked source files are **0 bytes**: `utils/eq-controller.js`, `utils/preset-utils.js`, `utils/spatial-controller.js`. None is in `runtimeFiles`. | `utils/` | Dead entries; misleading to readers. | Delete. |
| D-3 | `lua/fengari.min.js` is in `runtimeFiles` and therefore shipped, but the UI parses presets with the regex parser and never loads a Lua VM. | `build-extension.js:22` | Dead weight in the package. | Confirm no consumer, then drop from `runtimeFiles`. |
| D-4 | `verify-extension.js` defaults to `output/super-dribble-extension` when no `argv[2]` is given; the real package path is `output/Super-Dribble`. | `verify-extension.js` | Standalone invocation without an argument fails confusingly. | Update the default. |
| D-5 | Log message typo: `"giUI index does not reference…"`. | `verify-extension.js` | Cosmetic. | Fix the string. |
| D-6 | `docs/user_guide.md` documents an unrelated "Advanced VLC Audio Filters" project — VLC `aout_filter` modules, HRTF, Dolby Prologic-II, LADSPA. It has no relationship to this extension. | `docs/user_guide.md` | Actively misleading. | Rewrite against the real UI, or remove. |
| D-7 | The 10 band centre frequencies are declared in three files with no shared constant. | `equalizer-worklet.js`, `utils/audio-visualization.mjs`, `UI/src/constants/frequencyBands.ts` | Silent visualizer/EQ misalignment if one is edited alone. | Single source, or an equality assertion in `tests/`. |
| D-8 | `extension-info.json` carries a hard-coded `buildDate` of `2025-08-15T12:46:19.117Z` and is not regenerated by the build. | `extension-info.json` | Stale metadata. | Generate during `build-extension.js`, or drop the field. |
| D-9 | Spatializer toggle buttons expose no `aria-label` / `aria-pressed`. | `UI/src/equalizer/AudioEqualizer.tsx` | Screen readers cannot announce state. | Add ARIA attributes. |
| D-10 | The equalizer worklet instantiates with `{}` imports while the spatializer supplies a WASI shim. | `equalizer-worklet.js`, `spatializer-worklet.js` | Works today; brittle if new C++ code pulls in `fd_write`. | Use the shim in both. |

---

## Appendix A — constant reference

| Constant | Value | Location |
| --- | --- | --- |
| `BUFFER_CAPACITY` | 128 | both worklets |
| `EQ_Q` | 1.0 | `equalizer-worklet.js` |
| EQ band frequencies | 32, 64, 125, 250, 500, 1 000, 2 000, 4 000, 8 000, 16 000 Hz | `equalizer-worklet.js` |
| Band gain clamp | ±24 dB | `equalizer.cpp` |
| Volume range | 0 … 400 % | `equalizer.cpp` |
| Gain smoothing coefficient | `exp(-1 / (0.01 · sampleRate))` | `equalizer.cpp` |
| Output clamp | ±1.0 | `equalizer.cpp` |
| FDN order | 4 | `spatializer.cpp` |
| Hadamard normalisation | 0.5 | `spatializer.cpp` |
| FDN base primes | 1553, 1871, 2083, 2221 | `spatializer.cpp` |
| FDN delay span | ≈ 100 ms | `spatializer.cpp` |
| Butterworth Q | 0.70710678 | `spatializer.cpp` |
| Crossover default / range | 250 Hz / 50–500 Hz | `spatializer.cpp` |
| Low width factor default | 0.3 (range 0–1) | `spatializer.cpp` |
| High width factor default | 1.5 (range 0–3) | `spatializer.cpp` |
| `VISUALIZATION_FFT_SIZE` | 2048 | `offscreen.js:53` |
| `VISUALIZATION_FRAME_INTERVAL_MS` | 1000 / 60 | `offscreen.js:54` |
| Analyser `minDecibels` | −94 | `offscreen.js:219` |
| Analyser `maxDecibels` | −8 | `offscreen.js:220` |
| Analyser `smoothingTimeConstant` | 0.1 | `offscreen.js:221` |
| `BAND_EDGE_FACTOR` | `Math.SQRT2` | `utils/audio-visualization.mjs` |
| Noise floor | `(rms − 0.025) / 0.975` | `utils/audio-visualization.mjs` |
| Smoothing attack / release | 0.5 / 0.12 | `utils/audio-visualization.mjs` |
| Processor ready timeout | 5 000 ms | `offscreen.js:485-488` |
| Position update throttle | 1 000 ms | `content.js:137` |
| Transport-click settle delay | 300 ms | `content.js` |
| `INITIAL_MEMORY` | 8 388 608 B (8 MiB) | `build-wasm.js` |
| `STACK_SIZE` | 131 072 B (128 KiB) | `build-wasm.js` |
| Package size ceiling | 20 MB | `verify-extension.js` |
| Popup dimensions | 468 × 596 px | `UI/index.html`, `UI/src/index.css` |
| Panel heights | 148 / 49 / 295 px | `AudioEqualizer.tsx` |
| Flip duration | 0.6 s `cubic-bezier(0.16, 1, 0.3, 1)` | `UI/src/index.css` |
| EQ slider track length | 200 px | `UI/src/index.css` |

## Appendix B — shipped file manifest

Authoritative list: `runtimeFiles` + `runtimeDirectories` in `build-extension.js:12-31`.
Anything not listed here is development-only and *SHALL NOT* appear in the package.

```
manifest.json
background.js
content.js
offscreen.html
offscreen.js
utils/audio-visualization.mjs
icons/icon16.png
icons/icon48.png
icons/icon128.png
lua/fengari.min.js
wasm/equalizer/equalizer.wasm
wasm/equalizer/equalizer-worklet.js
wasm/equalizer/presets.lua
wasm/spatializer/spatializer.wasm
wasm/spatializer/spatializer-worklet.js
wasm/spatializer/spatializer_presets.lua
UI/build/**                     (directory, copied recursively)
```

---

## Authors

- Benny Perumalla &lt;benny01r@gmail.com&gt;
- Irshad Siddi &lt;mohammadirshadsiddi@gmail.com&gt;
- Sukesh Reddy &lt;lyricsofsongs96@gmail.com&gt;

Licensed under the GNU Lesser General Public License v2.1.
