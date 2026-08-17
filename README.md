# Super Dribble Audio Amplifier

A Chrome extension that provides real-time audio amplification and equalization for any tab's audio content.

## Features

- **10-Band Parametric Equalizer**: Fine-tune audio frequencies from 32Hz to 16kHz
- **Volume Control**: Adjust volume levels with real-time feedback
- **Preset Equalizer Settings**: Pre-configured settings for different music genres
- **Real-time Audio Processing**: Route tab audio through AudioWorklet-backed WASM DSP
- **WebAssembly DSP Engine**: High-performance audio processing using C++ compiled to WASM
- **Lua Preset System**: Dynamic preset loading and management using Lua scripts
- **Spatializer Effects**: Stereo widening and reverb effects for immersive audio
- **Modern UI**: Beautiful, responsive interface with dark theme

## Installation

### Development Mode (Unpacked Extension)

1. Clone this repository:
   ```bash
   git clone https://github.com/BennyPerumalla/Super-dribble.git
   cd Super-dribble
   ```

2. Install the UI dependencies and build the runtime-only extension package:
   ```bash
   cd UI
   pnpm install
   cd ..
   node build-extension.js
   ```

3. Load the extension in Chrome:
   - Open Chrome and go to `chrome://extensions/`
   - Enable "Developer mode" in the top right
   - Click "Load unpacked"
   - Select `output/Super-Dribble`

Do not load the repository root. It contains development dependencies and may include a local Emscripten SDK; Chrome counts every file below the selected unpacked-extension folder. The generated package contains only runtime assets and is verified to stay below 20 MB.

## Usage

1. **Start Audio Capture**:
   - Navigate to any webpage with audio (YouTube, Spotify, etc.)
   - Click the Super Dribble extension icon in your browser toolbar
   - The extension will automatically start capturing audio from the current tab

2. **Adjust Audio Settings**:
   - **Volume**: Use the volume slider to adjust overall volume
   - **Equalizer**: Drag the frequency band sliders to boost or cut specific frequencies
   - **Presets**: Select from pre-configured equalizer settings (Rock, Pop, Jazz, etc.)
   - **Mute**: Click the mute button to quickly silence audio

3. **Real-time Processing**:
   - All changes are applied in real-time
   - The spectrum analyzer shows visual feedback of the audio
   - Settings persist until you change them or close the extension

## Technical Details

### Architecture

- **Background Script** (`background.js`): Owns capture state and forwards control messages
- **Offscreen Engine** (`offscreen.js`): Builds the Web Audio routing graph and lazily loads required WASM worklets
- **Content Script** (`content.js`): Injected into web pages to ensure extension presence
- **UI** (`UI/`): React-based popup interface with TypeScript
- **C++ DSP** (`wasm/`): Gain, equalization, filtering, stereo widening, and reverb calculations
- **Least-privilege injection**: Page controls are injected only into the active tab after the user opens the extension; no broad host access is requested

### Audio Processing Chain

```
Tab Audio -> MediaStreamSource -> Equalizer WASM AudioWorklet -> optional Spatializer WASM AudioWorklet -> Destination
```

### WebAssembly Integration

The extension uses WebAssembly as the audio-processing engine:

- **Equalizer WASM**: Always-required 10-band parametric EQ, gain smoothing, and output limiting
- **Spatializer WASM**: Stereo widening and FDN reverb, loaded only after a spatializer preset is applied
- **AudioWorklet bridges**: Copy planar render-quantum buffers and parameter messages; they contain no DSP implementation
- **Lua Preset System**: Dynamic preset loading using Fengari Lua VM

### Lua Preset System

Presets are defined in Lua format for maximum flexibility:

- **Equalizer Presets**: Frequency, gain, and Q factor for each band
- **Spatializer Presets**: Width, decay, damping, and mix parameters
- **Import/Export**: Save and load custom presets in Lua format

### Permissions

- `activeTab`: Access to the currently active tab
- `tabCapture`: Capture audio from browser tabs
- `scripting`: Inject media controls into the user-invoked active tab
- `offscreen`: Keep the WASM audio graph alive while the popup is closed

## Development

### Project Structure

```
Super-dribble/
├── manifest.json              # Extension manifest
├── background.js              # Service worker for audio processing
├── content.js                # Content script
├── icons/                    # Extension icons
├── wasm/                     # WebAssembly modules
│   ├── equalizer/
│   │   ├── equalizer.cpp     # C++ equalizer implementation
│   │   ├── equalizer.wasm    # Compiled WASM module
│   │   ├── equalizer-worklet.js # Buffer/parameter bridge to WASM
│   │   └── presets.lua       # Equalizer presets
│   └── spatializer/
│       ├── spatializer.cpp   # C++ spatializer implementation
│       ├── spatializer.wasm  # Compiled WASM module
│       ├── spatializer-worklet.js # Lazily loaded buffer/parameter bridge
│       └── spatializer_presets.lua # Spatializer presets
├── utils/
│   └── lua-preset-parser.js  # Lua preset parser
├── lua/
│   └── fengari.min.js        # Lua VM for preset parsing
├── UI/                       # React UI application
│   ├── src/
│   │   ├── components/       # UI components
│   │   ├── lib/             # Utilities and services
│   │   └── types/           # TypeScript declarations
│   └── build/               # Compiled UI files
├── output/
│   └── Super-Dribble/ # Runtime-only folder to load in Chrome
├── README.md                # Project documentation
├── build-extension.js      # Builds and packages the extension
├── build-wasm.js           # WASM build script
└── verify-extension.js     # Extension verification script
```

### Building

Build both WASM modules, compile the UI, create the minimal extension folder and Chrome Web Store ZIP, and verify them:

```bash
node build-extension.js
```

Load `output/Super-Dribble` in Chrome. The repository root is a development workspace, not an extension package.

Upload `output/Super-Dribble.zip` to the Chrome Web Store. The ZIP contains the extension files at its root and excludes source code, dependencies, tests, documentation, and the Emscripten SDK.

#### UI Build

To rebuild the UI after changes:

```bash
cd UI
pnpm run build
```

#### WASM Build

To build the WebAssembly modules (requires Emscripten):

```bash
# Install Emscripten first: https://emscripten.org/docs/getting_started/downloads.html
node build-wasm.js

# Rebuild one module while developing
node build-wasm.js --module=equalizer
node build-wasm.js --module=spatializer
```

The build fails when Emscripten is unavailable; it never creates placeholder binaries.

### Testing

1. Load the extension in Chrome
2. Open a tab with audio content
3. Click the extension icon
4. Test all controls and verify audio changes

## Troubleshooting

### Audio Not Working

1. Ensure the webpage has audio content
2. Check that the extension has permission to capture tab audio
3. Verify the extension is loaded in Chrome
4. Check the browser console for error messages

### Extension Not Loading

1. Ensure all files are present in the project directory
2. Verify the manifest.json is valid
3. Check that the UI has been built (`UI/build/` directory exists)
4. Reload the extension in Chrome

## License

This project is licensed under the GNU Lesser General Public License v2.1.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## Author

Benny Perumalla <benny01r@gmail.com>
Irshad Siddi <mohammadirshadsiddi@gmail.com>
Sukesh Reddy <lyricsofsongs96@gmail.com>
