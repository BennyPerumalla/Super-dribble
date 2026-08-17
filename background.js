// Super Dribble Audio Amplifier - Background Service Worker
// Manages the Offscreen Document for audio processing.

let offscreenCreating = null; // Promise to prevent race conditions

// Ensure the offscreen document exists
async function setupOffscreenDocument(path) {
  const offscreenUrl = chrome.runtime.getURL(path);

  // Check if an offscreen document is already open
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [offscreenUrl]
  });

  if (existingContexts.length > 0) {
    return;
  }

  // Create offscreen document
  if (offscreenCreating) {
    await offscreenCreating;
  } else {
    try {
      offscreenCreating = chrome.offscreen.createDocument({
        url: path,
        reasons: ['AUDIO_PLAYBACK'],
        justification: 'Processing audio for equalization and effects',
      });
      await offscreenCreating;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (!message.startsWith('Only a single offscreen')) {
         throw e;
      }
      console.log('Offscreen document already exists (race condition handled).');
    } finally {
      offscreenCreating = null;
    }
  }
}

// Close offscreen document to save resources
async function closeOffscreenDocument() {
  await chrome.offscreen.closeDocument();
}

function normalizeEqValues(values) {
  return Array.from({ length: 10 }, (_, index) => (
    Number.isFinite(values?.[index]) ? values[index] : 0
  ));
}

// Track active capture state
let activeStreamId = null;
let activeTabId = null;
let currentVolume = 100; // Default to 100 (1.0 gain)
let currentEqValues = normalizeEqValues(); // Default flat
let currentPreset = 'Flat';
let currentSpatializerParams = null;
const visualizationPorts = new Set();

async function setExistingOffscreenVisualizationEnabled(enabled) {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL('offscreen.html')],
  });
  if (contexts.length === 0) return;

  await chrome.runtime.sendMessage({
    action: 'set_visualization_enabled',
    target: 'offscreen',
    enabled,
  });
}

chrome.runtime.onConnect?.addListener((port) => {
  if (port.name !== 'super-dribble-visualization') return;

  visualizationPorts.add(port);
  // Never create the audio engine while the popup is painting. If a capture
  // already exists, only enable its analyser side tap.
  setExistingOffscreenVisualizationEnabled(true).catch(() => {});

  port.onDisconnect.addListener(() => {
    visualizationPorts.delete(port);
    if (visualizationPorts.size === 0) {
      setExistingOffscreenVisualizationEnabled(false).catch(() => {});
    }
  });
});

function clearCaptureState() {
  activeStreamId = null;
  activeTabId = null;
}

function getTabCaptureStreamId(tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (streamId) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (!streamId) {
        reject(new Error('Chrome did not return a tab capture stream ID'));
      } else {
        resolve(streamId);
      }
    });
  });
}

async function getOffscreenStatus() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL('offscreen.html')],
  });
  if (contexts.length === 0) return null;

  try {
    const response = await chrome.runtime.sendMessage({
      action: 'get_status',
      target: 'offscreen',
    });
    return typeof response?.isProcessing === 'boolean' ? response : null;
  } catch {
    return null;
  }
}

// Handle messages from UI and Content Scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Messages forwarded to the offscreen engine must not be processed again
  // by the service worker.
  if (request.target === 'offscreen' || request.target === 'ui') {
    return false;
  }

  console.log('Background received message:', request);

  (async () => {
    try {
      if (request.action === 'start_capture') {
        if (!Number.isInteger(request.tabId)) {
          throw new Error('A valid tab ID is required to start capture');
        }

        const offscreenPath = 'offscreen.html';
        await setupOffscreenDocument(offscreenPath);
        const streamId = await getTabCaptureStreamId(request.tabId);

        const startResponse = await chrome.runtime.sendMessage({
          action: 'start_capture',
          target: 'offscreen',
          streamId,
          tabId: request.tabId,
          volume: currentVolume,
          eqValues: currentEqValues,
          preset: currentPreset,
          spatializerEnabled: !!currentSpatializerParams,
          spatializerParams: currentSpatializerParams,
          visualizationEnabled: visualizationPorts.size > 0,
        });

        if (!startResponse?.success) {
          throw new Error(startResponse?.error || 'Offscreen WASM pipeline failed to start');
        }

        activeStreamId = streamId;
        activeTabId = request.tabId;

        sendResponse({ success: true });
      } 
      else if (request.action === 'stop_capture') {
        const stopResponse = await chrome.runtime.sendMessage({
          action: 'stop_capture', 
          target: 'offscreen'
        });
        
        clearCaptureState();
        // Optional: Reset volume/EQ defaults or keep them as "user preferences"?
        // Let's keep them.
        
        sendResponse(stopResponse?.success === false ? stopResponse : { success: true });
      }
      else if (request.action === 'capture_error' || request.action === 'capture_stopped') {
        // The offscreen document owns the real stream lifecycle. Keep the
        // service-worker status in sync when capture fails or ends externally.
        clearCaptureState();
        sendResponse({ success: true });
      }
      else if (['set_volume', 'update_eq', 'update_eq_preset', 'update_spatializer'].includes(request.action)) {
         // Update local cache
         if (request.action === 'set_volume') {
             currentVolume = request.value;
         } else if (request.action === 'update_eq') {
             if (request.bandIndex >= 0 && request.bandIndex < 10) {
                 currentEqValues[request.bandIndex] = request.gainDb;
                 currentPreset = 'Custom';
             }
         } else if (request.action === 'update_eq_preset') {
             if (request.preset && request.preset.values) {
                  currentEqValues = normalizeEqValues(request.preset.values);
                 currentPreset = request.preset.name || 'Custom';
             }
         } else if (request.action === 'update_spatializer') {
             currentSpatializerParams = request.params ? { ...request.params } : null;
         }

         // Forward control messages to offscreen
         const controlResponse = await chrome.runtime.sendMessage({
             ...request,
             target: 'offscreen'
         });
         sendResponse(controlResponse?.success === false ? controlResponse : { success: true });
      }
      else if (request.action === 'get_status') {
          const engineStatus = await getOffscreenStatus();
          if (engineStatus) {
              activeTabId = engineStatus.activeTabId ?? null;
              activeStreamId = engineStatus.isProcessing ? 'offscreen-active' : null;
              currentVolume = engineStatus.volume ?? currentVolume;
              currentEqValues = normalizeEqValues(engineStatus.eqValues ?? currentEqValues);
              currentPreset = engineStatus.preset ?? currentPreset;
              currentSpatializerParams = engineStatus.spatializerParams ?? null;
          }

          sendResponse(engineStatus || {
              isInitialized: !!activeStreamId,
              activeTabId: activeTabId,
              isProcessing: !!activeStreamId,
              volume: currentVolume,
              eqValues: currentEqValues,
              preset: currentPreset,
              spatializerParams: currentSpatializerParams
          });
      }
      else {
          sendResponse({ success: false, error: 'Unknown action or unhandled' });
      }
    } catch (error) {
      console.error('Background error:', error);
      sendResponse({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  })();

  return true; // Keep channel open
});

