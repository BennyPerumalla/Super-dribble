console.log('Super Dribble WASM Audio Engine loaded');

function normalizeEqValues(values) {
  return Array.from({ length: 10 }, (_, index) => (
    Number.isFinite(values?.[index]) ? values[index] : 0
  ));
}

let audioContext = null;
let sourceNode = null;
let equalizerNode = null;
let spatializerNode = null;
let spatializerCreating = null;
let activeStream = null;
let isProcessing = false;
let activeTabId = null;
let currentVolume = 100;
let currentEqValues = normalizeEqValues();
let currentPreset = 'Flat';
let currentSpatializerParams = null;
let pipelineGeneration = 0;
let spatializerGeneration = 0;

const wasmModuleCache = new Map();

const EQUALIZER_WORKLET_PATH = 'wasm/equalizer/equalizer-worklet.js';
const EQUALIZER_WASM_PATH = 'wasm/equalizer/equalizer.wasm';
const SPATIALIZER_WORKLET_PATH = 'wasm/spatializer/spatializer-worklet.js';
const SPATIALIZER_WASM_PATH = 'wasm/spatializer/spatializer.wasm';

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.target !== 'offscreen') return false;

  (async () => {
    try {
      switch (request.action) {
        case 'start_capture':
          await startProcessing(request);
          sendResponse({ success: true });
          break;
        case 'stop_capture':
          await stopProcessing();
          sendResponse({ success: true });
          break;
        case 'set_volume':
          requireEqualizer().port.postMessage({ type: 'set-volume', value: request.value });
          currentVolume = request.value;
          sendResponse({ success: true });
          break;
        case 'update_eq':
          requireEqualizer().port.postMessage({
            type: 'set-band',
            index: request.bandIndex,
            gainDb: request.gainDb,
          });
          if (Number.isInteger(request.bandIndex) && request.bandIndex >= 0 && request.bandIndex < 10) {
            currentEqValues[request.bandIndex] = request.gainDb;
            currentPreset = 'Custom';
          }
          sendResponse({ success: true });
          break;
        case 'update_eq_preset':
          requireEqualizer().port.postMessage({ type: 'set-eq', values: request.preset?.values ?? [] });
          currentEqValues = normalizeEqValues(request.preset?.values ?? currentEqValues);
          currentPreset = request.preset?.name || 'Custom';
          sendResponse({ success: true });
          break;
        case 'update_spatializer':
          if (request.params == null) {
            disableSpatializer();
            currentSpatializerParams = null;
          } else {
            await ensureSpatializer(request.params);
            currentSpatializerParams = { ...request.params };
          }
          sendResponse({ success: true });
          break;
        case 'get_status':
          sendResponse({
            success: true,
            isInitialized: isProcessing,
            isProcessing,
            activeTabId,
            volume: currentVolume,
            eqValues: [...currentEqValues],
            preset: currentPreset,
            spatializerParams: currentSpatializerParams,
          });
          break;
        default:
          sendResponse({ success: false, error: `Unknown offscreen action: ${request.action}` });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('Offscreen audio error:', error);
      sendResponse({ success: false, error: message });
    }
  })();

  return true;
});

async function startProcessing(request) {
  if (isProcessing || audioContext || activeStream) await stopProcessing();

  const generation = ++pipelineGeneration;
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: request.streamId,
      },
    },
    video: false,
  });

  if (generation !== pipelineGeneration) {
    stream.getTracks().forEach((track) => track.stop());
    throw new Error('Audio pipeline start was superseded');
  }

  try {
    activeStream = stream;
    const context = new AudioContext({ latencyHint: 'interactive' });
    audioContext = context;

    const [equalizerModule] = await Promise.all([
      compileWasmModule(EQUALIZER_WASM_PATH),
      context.audioWorklet.addModule(chrome.runtime.getURL(EQUALIZER_WORKLET_PATH)),
    ]);
    assertPipelineActive(generation, context);

    const equalizer = new AudioWorkletNode(context, 'super-dribble-equalizer', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers',
      processorOptions: {
        wasmModule: equalizerModule,
        initialState: {
          volume: request.volume ?? 100,
          eqValues: request.eqValues ?? new Array(10).fill(0),
        },
      },
    });
    equalizerNode = equalizer;
    await waitForProcessor(equalizer, 'equalizer');
    assertPipelineActive(generation, context);

    equalizer.connect(context.destination);
    if (request.spatializerEnabled && request.spatializerParams) {
      await ensureSpatializer(request.spatializerParams, generation);
    }

    assertPipelineActive(generation, context);
    const source = context.createMediaStreamSource(stream);
    source.connect(equalizer);
    sourceNode = source;

    stream.addEventListener('inactive', () => {
      if (generation !== pipelineGeneration || activeStream !== stream) return;
      stopProcessing().finally(() => chrome.runtime.sendMessage({ action: 'capture_stopped' }));
    }, { once: true });

    await context.resume();
    assertPipelineActive(generation, context);
    isProcessing = true;
    activeTabId = request.tabId ?? null;
    currentVolume = request.volume ?? 100;
    currentEqValues = normalizeEqValues(request.eqValues);
    currentPreset = request.preset || 'Flat';
    currentSpatializerParams = request.spatializerEnabled && request.spatializerParams
      ? { ...request.spatializerParams }
      : null;
    console.log('Audio path: MediaStreamSource -> Equalizer WASM -> optional Spatializer WASM -> Destination');
  } catch (error) {
    const isCurrentGeneration = generation === pipelineGeneration;
    await stopProcessing();
    if (isCurrentGeneration) {
      chrome.runtime.sendMessage({
        action: 'capture_error',
        error: error instanceof Error ? error.message : String(error),
      });
    }
    throw error;
  }
}

async function ensureSpatializer(params, expectedGeneration = pipelineGeneration) {
  const context = audioContext;
  const equalizer = equalizerNode;
  if (!context || !equalizer) throw new Error('Audio pipeline is not initialized');

  if (spatializerNode) {
    spatializerNode.port.postMessage({ type: 'set-params', params });
    return spatializerNode;
  }
  if (spatializerCreating) {
    const node = await spatializerCreating;
    node.port.postMessage({ type: 'set-params', params });
    return node;
  }

  const creationGeneration = ++spatializerGeneration;
  const creation = (async () => {
    let node = null;
    try {
      const [spatializerModule] = await Promise.all([
        compileWasmModule(SPATIALIZER_WASM_PATH),
        context.audioWorklet.addModule(chrome.runtime.getURL(SPATIALIZER_WORKLET_PATH)),
      ]);
      assertPipelineActive(expectedGeneration, context, equalizer);
      assertSpatializerActive(creationGeneration);

      node = new AudioWorkletNode(context, 'super-dribble-spatializer', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: 'explicit',
        channelInterpretation: 'speakers',
        processorOptions: { wasmModule: spatializerModule, initialParams: params },
      });
      await waitForProcessor(node, 'spatializer');
      assertPipelineActive(expectedGeneration, context, equalizer);
      assertSpatializerActive(creationGeneration);

      equalizer.disconnect();
      equalizer.connect(node);
      node.connect(context.destination);
      spatializerNode = node;
      return node;
    } catch (error) {
      node?.port.postMessage({ type: 'dispose' });
      node?.disconnect();
      throw error;
    }
  })();
  spatializerCreating = creation;

  try {
    return await creation;
  } finally {
    if (spatializerCreating === creation) spatializerCreating = null;
  }
}

function disableSpatializer() {
  spatializerGeneration += 1;
  spatializerCreating = null;

  const node = spatializerNode;
  spatializerNode = null;
  if (!node || !equalizerNode || !audioContext) return;

  equalizerNode.disconnect();
  equalizerNode.connect(audioContext.destination);
  node.port.postMessage({ type: 'dispose' });
  node.disconnect();
}

async function compileWasmModule(resourcePath) {
  if (!wasmModuleCache.has(resourcePath)) {
    const compilation = (async () => {
      const response = await fetch(chrome.runtime.getURL(resourcePath));
      if (!response.ok) throw new Error(`Failed to load ${resourcePath}: ${response.status}`);
      return WebAssembly.compile(await response.arrayBuffer());
    })().catch((error) => {
      wasmModuleCache.delete(resourcePath);
      throw error;
    });
    wasmModuleCache.set(resourcePath, compilation);
  }
  return wasmModuleCache.get(resourcePath);
}

function waitForProcessor(node, label) {
  return new Promise((resolve, reject) => {
    const settle = (callback, value) => {
      clearTimeout(timeout);
      node.port.removeEventListener('message', onMessage);
      callback(value);
    };
    const onMessage = (event) => {
      if (event.data?.type === 'ready') {
        settle(resolve);
      } else if (event.data?.type === 'error') {
        settle(reject, new Error(event.data.error || `${label} WASM initialization failed`));
      }
    };
    const timeout = setTimeout(
      () => settle(reject, new Error(`${label} WASM initialization timed out`)),
      5000,
    );
    node.port.addEventListener('message', onMessage);
    node.port.start();
  });
}

function assertPipelineActive(generation, context, equalizer = equalizerNode) {
  if (
    generation !== pipelineGeneration
    || audioContext !== context
    || (equalizer && equalizerNode !== equalizer)
  ) {
    throw new Error('Audio pipeline operation was superseded');
  }
}

function assertSpatializerActive(generation) {
  if (generation !== spatializerGeneration) {
    throw new Error('Spatializer initialization was superseded');
  }
}

function requireEqualizer() {
  if (!isProcessing || !equalizerNode) throw new Error('Audio pipeline is not initialized');
  return equalizerNode;
}

async function stopProcessing() {
  pipelineGeneration += 1;
  spatializerGeneration += 1;
  isProcessing = false;
  activeTabId = null;
  spatializerCreating = null;

  const source = sourceNode;
  const equalizer = equalizerNode;
  const spatializer = spatializerNode;
  const stream = activeStream;
  const context = audioContext;

  sourceNode = null;
  equalizerNode = null;
  spatializerNode = null;
  activeStream = null;
  audioContext = null;

  source?.disconnect();
  equalizer?.port.postMessage({ type: 'dispose' });
  equalizer?.disconnect();
  spatializer?.port.postMessage({ type: 'dispose' });
  spatializer?.disconnect();

  stream?.getTracks().forEach((track) => track.stop());
  if (context && context.state !== 'closed') await context.close();
}
