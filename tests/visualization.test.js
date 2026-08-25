const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');

const root = path.join(__dirname, '..');

async function loadVisualizationModule() {
  return import(pathToFileURL(path.join(root, 'utils', 'audio-visualization.mjs')).href);
}

test('FFT ranges are derived from sample rate and FFT size', async () => {
  const { createBandBinRanges } = await loadVisualizationModule();
  const ranges = createBandBinRanges(48000, 2048);

  assert.equal(ranges.length, 10);
  assert.equal(ranges[0].centerFrequency, 32);
  assert.ok(ranges[0].startBin >= 1);
  assert.ok(ranges[0].endBin >= ranges[0].startBin);
  assert.ok(ranges[9].endBin <= 1023);
  assert.ok(ranges[0].endBin < ranges[1].startBin);

  for (const fftSize of [256, 512, 1024]) {
    const undersizedRanges = createBandBinRanges(48000, fftSize);
    assert.equal(undersizedRanges[0].startBin, undersizedRanges[1].startBin);
    assert.equal(undersizedRanges[0].endBin, undersizedRanges[1].endBin);
  }

  const alternate = createBandBinRanges(44100, 4096);
  assert.notEqual(alternate[5].startBin, ranges[5].startBin);
});

test('energy calculation isolates frequency windows instead of duplicating amplitude', async () => {
  const {
    calculateBandEnergies,
    createBandBinRanges,
  } = await loadVisualizationModule();
  const ranges = createBandBinRanges(48000, 2048);
  const data = new Uint8Array(1024);
  const target = ranges[5];

  for (let index = target.startBin; index <= target.endBin; index += 1) {
    data[index] = 255;
  }

  const energies = calculateBandEnergies(data, ranges);
  assert.ok(energies[5] > 0.9);
  assert.ok(energies[5] > energies[4] * 2);
  assert.ok(energies[5] > energies[6] * 2);
});

test('band smoothing rises faster than it releases and settles silence', async () => {
  const { smoothBandEnergies } = await loadVisualizationModule();
  const current = new Float32Array([0.8, 0.2]);
  smoothBandEnergies(new Float32Array([1, 0]), current, 0.5, 0.1);

  assert.ok(current[0] > 0.8);
  assert.ok(current[1] < 0.2);

  for (let index = 0; index < 80; index += 1) {
    smoothBandEnergies(new Float32Array([0, 0]), current, 0.5, 0.12);
  }
  assert.ok(current[0] < 0.01);
  assert.ok(current[1] < 0.01);
});

test('offscreen visualization uses one analyser tap and broadcasts sampled frames', () => {
  const source = fs.readFileSync(path.join(root, 'offscreen.js'), 'utf8');

  assert.match(source, /createAnalyser/);
  assert.match(source, /VISUALIZATION_FFT_SIZE\s*=\s*2048/);
  assert.match(source, /smoothingTimeConstant\s*=\s*0\.1/);
  assert.match(source, /getByteFrequencyData/);
  assert.match(source, /VISUALIZATION_FRAME_INTERVAL_MS\s*=\s*1000\s*\/\s*60/);
  assert.match(source, /nextSampleAt/);
  assert.match(source, /analyserRawEnergy/);
  assert.doesNotMatch(source, /analyserSmoothedEnergy/);
  assert.match(source, /setTimeout\(\s*sample/);
  assert.match(source, /new BroadcastChannel\('super-dribble-visualization'\)/);
  assert.match(source, /visualizationChannel\.postMessage/);
  assert.match(source, /sampledAt/);
  assert.match(source, /connectProcessedOutput\(equalizer, context\)/);
  assert.match(source, /node\.connect\(context\.destination\)/);
  assert.match(source, /node\.connect\(analyserNode\)/);
  assert.match(source, /analyserSink\.gain\.value\s*=\s*0/);
  assert.doesNotMatch(source, /analyser\.connect\(context\.destination\)/);
  assert.doesNotMatch(source, /void compileWasmModule\(EQUALIZER_WASM_PATH\)\.catch/);
  assert.match(source, /timeToAudioReadyMs/);
  assert.match(source, /visualizationFps/);
});

test('visualization sampling is opt-in and stops when the popup disconnects', () => {
  const offscreen = fs.readFileSync(path.join(root, 'offscreen.js'), 'utf8');
  const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');

  assert.match(offscreen, /set_visualization_enabled/);
  assert.match(offscreen, /if \(visualizationEnabled\) startVisualizationSampling/);
  assert.match(background, /super-dribble-visualization/);
  assert.match(background, /visualizationPorts/);
});

test('popup visualization rejects stale frames and resets rendered meters', () => {
  const source = fs.readFileSync(
    path.join(root, 'UI', 'src', 'equalizer', 'AudioEqualizer.tsx'),
    'utf8',
  );

  assert.match(source, /sampledAt <= lastEnergyUpdate\.current/);
  assert.match(source, /latency > 120/);
  assert.match(source, /performance\.timeOrigin \+ time/);
  assert.match(source, /displayedEnergy\.current\.fill\(0\)/);
  assert.match(source, /node\.style\.setProperty\("--energy-height", "0%"\)/);
});
