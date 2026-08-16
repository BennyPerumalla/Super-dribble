const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadBackground({ offscreenStatus = null } = {}) {
  const listeners = [];
  const sentMessages = [];
  const contextQueries = [];
  const captureRequests = [];
  const chrome = {
    runtime: {
      getURL: (resourcePath) => `chrome-extension://test/${resourcePath}`,
      getContexts: async (query) => {
        contextQueries.push(query);
        return [{ contextType: 'OFFSCREEN_DOCUMENT' }];
      },
      onMessage: {
        addListener(listener) {
          listeners.push(listener);
        },
      },
      async sendMessage(message) {
        sentMessages.push(message);
        if (message.action === 'get_status' && message.target === 'offscreen' && offscreenStatus) {
          return offscreenStatus;
        }
        return { success: true };
      },
    },
    offscreen: {
      createDocument: async () => {},
      closeDocument: async () => {},
    },
    tabCapture: {
      getMediaStreamId(options, callback) {
        captureRequests.push(options);
        callback(`stream-for-tab-${options.targetTabId}`);
      },
    },
  };

  const source = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');
  vm.runInNewContext(source, {
    chrome,
    console: { log() {}, error() {} },
    setTimeout(callback) {
      callback();
      return 1;
    },
  });

  assert.equal(listeners.length, 1);
  return { captureRequests, contextQueries, listener: listeners[0], sentMessages };
}

function dispatch(listener, request) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`No response for ${request.action}`)), 1000);
    listener(request, {}, (response) => {
      clearTimeout(timeout);
      resolve(response);
    });
  });
}

test('offscreen-targeted messages are not recursively handled', () => {
  const { listener, sentMessages } = loadBackground();
  let responded = false;

  const keepAlive = listener(
    { action: 'start_capture', target: 'offscreen', streamId: 'stream-1' },
    {},
    () => { responded = true; },
  );

  assert.equal(keepAlive, false);
  assert.equal(responded, false);
  assert.deepEqual(sentMessages, []);
});

test('capture_error clears optimistic capture state', async () => {
  const { contextQueries, listener } = loadBackground();

  assert.equal(
    (await dispatch(listener, { action: 'start_capture', streamId: 'stream-1', tabId: 42 })).success,
    true,
  );
  assert.equal(contextQueries[0].documentUrls[0], 'chrome-extension://test/offscreen.html');
  assert.equal((await dispatch(listener, { action: 'get_status' })).isInitialized, true);

  assert.equal(
    (await dispatch(listener, { action: 'capture_error', error: 'capture failed' })).success,
    true,
  );
  const status = await dispatch(listener, { action: 'get_status' });
  assert.equal(status.isInitialized, false);
  assert.equal(status.isProcessing, false);
  assert.equal(status.activeTabId, null);
});

test('capture_stopped clears state after the stream becomes inactive', async () => {
  const { listener } = loadBackground();

  await dispatch(listener, { action: 'start_capture', streamId: 'stream-2', tabId: 84 });
  assert.equal((await dispatch(listener, { action: 'capture_stopped' })).success, true);

  const status = await dispatch(listener, { action: 'get_status' });
  assert.equal(status.isInitialized, false);
  assert.equal(status.isProcessing, false);
  assert.equal(status.activeTabId, null);
});

test('status is recovered from the offscreen engine after service-worker suspension', async () => {
  const offscreenStatus = {
    success: true,
    isInitialized: true,
    isProcessing: true,
    activeTabId: 77,
    volume: 135,
    eqValues: [1, 2, 3, 4, 5, 4, 3, 2, 1, 0],
    preset: 'Recovered',
    spatializerParams: { width: 1.2, mix: 0.3 },
  };
  const { listener } = loadBackground({ offscreenStatus });

  const status = await dispatch(listener, { action: 'get_status' });
  assert.deepEqual(JSON.parse(JSON.stringify(status)), offscreenStatus);
});

test('start sends cached DSP state in one offscreen initialization message', async () => {
  const { captureRequests, listener, sentMessages } = loadBackground();

  await dispatch(listener, { action: 'start_capture', streamId: 'stream-3', tabId: 21 });

  assert.equal(sentMessages.length, 1);
  assert.equal(captureRequests.length, 1);
  assert.equal(captureRequests[0].targetTabId, 21);
  assert.equal(sentMessages[0].target, 'offscreen');
  assert.equal(sentMessages[0].action, 'start_capture');
  assert.equal(sentMessages[0].streamId, 'stream-for-tab-21');
  assert.equal(sentMessages[0].volume, 100);
  assert.deepEqual(Array.from(sentMessages[0].eqValues), new Array(10).fill(0));
  assert.equal(sentMessages[0].spatializerEnabled, false);
});

test('preset state is normalized to ten finite equalizer bands', async () => {
  const { listener } = loadBackground();

  await dispatch(listener, {
    action: 'update_eq_preset',
    preset: { name: 'Malformed', values: [3, Number.NaN] },
  });

  const status = await dispatch(listener, { action: 'get_status' });
  assert.deepEqual(Array.from(status.eqValues), [3, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
});

test('spatializer state is forwarded lazily and restored on the next capture', async () => {
  const { listener, sentMessages } = loadBackground();
  const params = { width: 1.5, decay: 0.7, damping: 0.4, mix: 0.25 };

  await dispatch(listener, { action: 'start_capture', streamId: 'stream-4', tabId: 22 });
  await dispatch(listener, { action: 'update_spatializer', params });

  const spatializerUpdate = sentMessages.find((message) => message.action === 'update_spatializer');
  assert.equal(spatializerUpdate?.action, 'update_spatializer');
  assert.deepEqual(JSON.parse(JSON.stringify(spatializerUpdate.params)), params);
  assert.deepEqual(
    JSON.parse(JSON.stringify((await dispatch(listener, { action: 'get_status' })).spatializerParams)),
    params,
  );

  await dispatch(listener, { action: 'start_capture', streamId: 'stream-5', tabId: 23 });
  const restoredStart = sentMessages
    .filter((message) => message.action === 'start_capture')
    .at(-1);
  assert.equal(restoredStart?.spatializerEnabled, true);
  assert.deepEqual(JSON.parse(JSON.stringify(restoredStart.spatializerParams)), params);
});
