const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function functionSource(source, functionName) {
  const declaration = source.indexOf(`function ${functionName}`);
  assert.ok(declaration >= 0, `${functionName} must be declared`);

  const bodyStart = source.indexOf('{', declaration);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(declaration, index + 1);
  }

  assert.fail(`Could not find the end of ${functionName}`);
}

function methodSource(source, methodName) {
  const declaration = source.indexOf(`${methodName}(`);
  assert.ok(declaration >= 0, `${methodName} must be declared`);

  const bodyStart = source.indexOf('{', declaration);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(declaration, index + 1);
  }

  assert.fail(`Could not find the end of ${methodName}`);
}

async function instantiateStandaloneWasm(bytes) {
  const wasi = {
    fd_write: () => 0,
    fd_close: () => 0,
    fd_seek: () => 0,
  };
  return WebAssembly.instantiate(bytes, { wasi_snapshot_preview1: wasi });
}

function createWorkletProcessor(workletPath, wasmPath, processorOptions) {
  let Processor = null;
  class MockAudioWorkletProcessor {
    constructor() {
      this.port = {
        messages: [],
        onmessage: null,
        postMessage(message) {
          this.messages.push(message);
        },
      };
    }
  }

  const context = vm.createContext({
    Array,
    AudioWorkletProcessor: MockAudioWorkletProcessor,
    Error,
    Float32Array,
    Math,
    Number,
    String,
    WebAssembly,
    registerProcessor(name, RegisteredProcessor) {
      Processor = RegisteredProcessor;
    },
    sampleRate: 48000,
  });
  vm.runInContext(read(workletPath), context, { filename: workletPath });
  assert.ok(Processor, `${workletPath} must register an AudioWorkletProcessor`);

  const wasmModule = new WebAssembly.Module(fs.readFileSync(path.join(root, wasmPath)));
  const processor = new Processor({ processorOptions: { ...processorOptions, wasmModule } });
  assert.equal(processor.port.messages[0]?.type, 'ready');
  return processor;
}

test('offscreen Web Audio graph contains routing nodes but no JavaScript DSP nodes', () => {
  const source = read('offscreen.js');

  assert.match(source, /createMediaStreamSource/);
  assert.match(source, /new AudioWorkletNode/);
  assert.doesNotMatch(source, /createGain|createBiquadFilter|createScriptProcessor|onaudioprocess/);
});

test('WASM modules are compiled before entering the audio worklet', () => {
  const offscreen = read('offscreen.js');
  const equalizer = read('wasm/equalizer/equalizer-worklet.js');
  const spatializer = read('wasm/spatializer/spatializer-worklet.js');

  assert.match(offscreen, /WebAssembly\.compile(?:Streaming)?/);
  assert.doesNotMatch(offscreen, /wasmBytes/);
  assert.match(offscreen, /wasmModule/);
  assert.match(equalizer, /WebAssembly\.Instance/);
  assert.match(spatializer, /WebAssembly\.Instance/);
  assert.doesNotMatch(equalizer, /WebAssembly\.(?:compile|instantiate)/);
  assert.doesNotMatch(spatializer, /WebAssembly\.(?:compile|instantiate)/);
});

test('spatializer WASM is loaded only inside the on-demand initializer', () => {
  const source = read('offscreen.js');
  const startup = functionSource(source, 'startProcessing');
  const initializer = functionSource(source, 'ensureSpatializer');

  assert.match(initializer, /SPATIALIZER_WORKLET_PATH/);
  assert.match(initializer, /SPATIALIZER_WASM_PATH/);
  assert.doesNotMatch(startup, /SPATIALIZER_(?:WORKLET|WASM)_PATH/);
});

test('worklet bridges delegate processing to WASM exports', () => {
  const equalizer = read('wasm/equalizer/equalizer-worklet.js');
  const spatializer = read('wasm/spatializer/spatializer-worklet.js');

  assert.match(equalizer, /exports\.process_buffer/);
  assert.match(spatializer, /exports\.spatializer_process_buffer/);
  assert.doesNotMatch(equalizer, /Math\.(sin|cos|pow)|biquad/i);
  assert.doesNotMatch(spatializer, /Math\.(sin|cos|pow)|reverb|delayLine/i);
});

test('worklet audio callbacks reuse preallocated WASM buffers', () => {
  const equalizerProcess = methodSource(read('wasm/equalizer/equalizer-worklet.js'), 'process');
  const spatializerProcess = methodSource(read('wasm/spatializer/spatializer-worklet.js'), 'process');

  for (const processSource of [equalizerProcess, spatializerProcess]) {
    assert.doesNotMatch(
      processSource,
      /new\s+Float32Array|\.malloc\s*\(|\.free\s*\(|WebAssembly\.(?:instantiate|compile)/,
    );
  }
});

test('equalizer worklet bridges mono buffers through the real WASM instance', () => {
  const processor = createWorkletProcessor(
    'wasm/equalizer/equalizer-worklet.js',
    'wasm/equalizer/equalizer.wasm',
    { initialState: { volume: 100, eqValues: new Array(10).fill(0) } },
  );
  const input = new Float32Array(300).fill(0.2);
  const outputLeft = new Float32Array(300);
  const outputRight = new Float32Array(300);

  assert.equal(processor.process([[input]], [[outputLeft, outputRight]]), true);
  for (let frame = 0; frame < input.length; frame += 1) {
    assert.ok(Math.abs(outputLeft[frame] - 0.2) < 1e-6);
    assert.ok(Math.abs(outputRight[frame] - 0.2) < 1e-6);
  }

  processor.port.onmessage({ data: { type: 'dispose' } });
  assert.equal(processor.process([[input]], [[outputLeft, outputRight]]), false);
});

test('spatializer worklet delegates chunked stereo processing and disposes cleanly', () => {
  const processor = createWorkletProcessor(
    'wasm/spatializer/spatializer-worklet.js',
    'wasm/spatializer/spatializer.wasm',
    { initialParams: { width: 0, mix: 0 } },
  );
  const inputLeft = new Float32Array(300).fill(0.25);
  const inputRight = new Float32Array(300).fill(-0.25);
  const outputLeft = new Float32Array(300);
  const outputRight = new Float32Array(300);

  assert.equal(processor.process([[inputLeft, inputRight]], [[outputLeft, outputRight]]), true);
  for (let frame = 0; frame < inputLeft.length; frame += 1) {
    assert.ok(Math.abs(outputLeft[frame]) < 1e-6);
    assert.ok(Math.abs(outputRight[frame]) < 1e-6);
  }

  processor.port.onmessage({ data: { type: 'dispose' } });
  assert.equal(processor.process([[inputLeft, inputRight]], [[outputLeft, outputRight]]), false);
});

test('compiled equalizer performs gain processing inside WASM', async () => {
  const bytes = fs.readFileSync(path.join(root, 'wasm/equalizer/equalizer.wasm'));
  const { instance } = await instantiateStandaloneWasm(bytes);
  const exports = instance.exports;
  exports._initialize();

  const frameCount = 128;
  const left = exports.malloc(frameCount * 4);
  const right = exports.malloc(frameCount * 4);
  const equalizer = exports.create_equalizer(48000);
  const heap = new Float32Array(exports.memory.buffer);

  exports.set_volume_percent(equalizer, 200);
  for (let block = 0; block < 20; block += 1) {
    heap.fill(0.25, left >> 2, (left >> 2) + frameCount);
    heap.fill(0.25, right >> 2, (right >> 2) + frameCount);
    exports.process_buffer(equalizer, left, right, frameCount);
  }

  assert.ok(heap[left >> 2] > 0.45);
  assert.ok(heap[right >> 2] > 0.45);

  exports.destroy_equalizer(equalizer);
  exports.free(left);
  exports.free(right);
});

test('compiled spatializer performs stereo processing inside WASM', async () => {
  const bytes = fs.readFileSync(path.join(root, 'wasm/spatializer/spatializer.wasm'));
  const { instance } = await instantiateStandaloneWasm(bytes);
  const exports = instance.exports;
  exports._initialize();

  const frameCount = 128;
  const left = exports.malloc(frameCount * 4);
  const right = exports.malloc(frameCount * 4);
  const spatializer = exports.create_spatializer(48000);
  const heap = new Float32Array(exports.memory.buffer);
  const leftOffset = left >> 2;
  const rightOffset = right >> 2;

  heap.fill(0.25, leftOffset, leftOffset + frameCount);
  heap.fill(-0.25, rightOffset, rightOffset + frameCount);
  exports.spatializer_set_width(spatializer, 0);
  exports.spatializer_set_mix(spatializer, 0);
  exports.spatializer_process_buffer(spatializer, left, right, frameCount);

  for (let frame = 0; frame < frameCount; frame += 1) {
    assert.ok(Math.abs(heap[leftOffset + frame]) < 1e-6);
    assert.ok(Math.abs(heap[rightOffset + frame]) < 1e-6);
  }

  exports.destroy_spatializer(spatializer);
  exports.free(left);
  exports.free(right);
});
