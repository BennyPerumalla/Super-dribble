// Super Dribble Audio Amplifier - Background Service Worker
// Manages the Offscreen Document for audio processing.

let offscreenCreating = null; // Promise to prevent race conditions

// Ensure the offscreen document exists
async function setupOffscreenDocument(path) {
  // Check if an offscreen document is already open
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [path]
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
      if (!e.message.startsWith('Only a single offscreen')) {
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

// Track active capture state
let activeStreamId = null;
let activeTabId = null;
let currentVolume = 100; // Default to 100 (1.0 gain)
let currentEqValues = new Array(10).fill(0); // Default flat
let currentPreset = 'Flat';

// Handle messages from UI and Content Scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Background received message:', request);

  (async () => {
    try {
      if (request.action === 'start_capture') {
        const offscreenPath = 'offscreen.html';
        await setupOffscreenDocument(offscreenPath);
        
        // Wait a bit for the offscreen document to initialize
        await new Promise(resolve => setTimeout(resolve, 500));

        // Update state
        activeStreamId = request.streamId;
        activeTabId = request.tabId;
        
        // Reset defaults on new capture if you want, or keep previous settings?
        // Usually, if we start a new capture, we might want to reset or apply current UI state.
        // For now, let's NOT reset, assuming the UI will send updates if needed, 
        // OR we assume persistent settings across sessions. 
        // But if the offscreen doc was recreated, it has default 1.0/Flat.
        // So we should probably send our cached values TO the offscreen doc!
        
        // Forward start_capture
        chrome.runtime.sendMessage({
          action: 'start_capture',
          target: 'offscreen',
          streamId: request.streamId
        });

        // Restore cached state to offscreen
        // Allow a small delay for start_capture to process?
        // Or send immediately after.
        setTimeout(() => {
             if (activeStreamId) {
                 chrome.runtime.sendMessage({ action: 'set_volume', value: currentVolume, target: 'offscreen' });
                 // Send EQ if not flat? 
                 // It's easier to just send it.
                 // We can optimize communication later.
                 // For now, offscreen defaults to 0s, so if currentEqValues is 0s, no need.
             }
        }, 100);
        
        sendResponse({ success: true });
      } 
      else if (request.action === 'stop_capture') {
        chrome.runtime.sendMessage({
          action: 'stop_capture', 
          target: 'offscreen'
        });
        
        activeStreamId = null;
        activeTabId = null;
        // Optional: Reset volume/EQ defaults or keep them as "user preferences"?
        // Let's keep them.
        
        sendResponse({ success: true });
      }
      else if (['set_volume', 'update_eq', 'update_eq_preset'].includes(request.action)) {
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
                 currentEqValues = [...request.preset.values];
                 currentPreset = request.preset.name || 'Custom';
             }
         }

         // Forward control messages to offscreen
         chrome.runtime.sendMessage({
             ...request,
             target: 'offscreen'
         });
         sendResponse({ success: true });
      }
      else if (request.action === 'get_status') {
          // Return the actual tracking state
          sendResponse({ 
              isInitialized: !!activeStreamId,
              activeTabId: activeTabId,
              isProcessing: !!activeStreamId,
              volume: currentVolume,
              eqValues: currentEqValues,
              preset: currentPreset
          }); 
      }
      else {
          sendResponse({ success: false, error: 'Unknown action or unhandled' });
      }
    } catch (error) {
      console.error('Background error:', error);
      sendResponse({ success: false, error: error.message });
    }
  })();

  return true; // Keep channel open
});

