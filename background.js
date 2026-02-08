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
    offscreenCreating = chrome.offscreen.createDocument({
      url: path,
      reasons: ['AUDIO_PLAYBACK'],
      justification: 'Processing audio for equalization and effects',
    });
    await offscreenCreating;
    offscreenCreating = null;
  }
}

// Close offscreen document to save resources
async function closeOffscreenDocument() {
  await chrome.offscreen.closeDocument();
}

// Handle messages from UI and Content Scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Background received message:', request);

  (async () => {
    try {
      if (request.action === 'start_capture') {
        const offscreenPath = 'offscreen.html';
        await setupOffscreenDocument(offscreenPath);
        
        // Wait a bit for the offscreen document to initialize listeners
        // A more robust way would be for offscreen to send a "ready" message, but a delay helps the race condition.
        await new Promise(resolve => setTimeout(resolve, 500));

        // Forward the stream ID to the offscreen document
        chrome.runtime.sendMessage({
          action: 'start_capture',
          target: 'offscreen',
          streamId: request.streamId
        }, (response) => {
             if (chrome.runtime.lastError) {
                 console.error('Failed to send start_capture to offscreen:', chrome.runtime.lastError);
             } else {
                 console.log('Sent start_capture to offscreen, response:', response);
             }
        });
        
        sendResponse({ success: true });
      } 
      else if (request.action === 'stop_capture') {
        chrome.runtime.sendMessage({
          action: 'stop_capture', 
          target: 'offscreen'
        });
        // We might want to close the document after some timeout or immediately
        // For now, keep it open to be responsive, or close it if you want to save RAM strictly.
        // closeOffscreenDocument(); 
        sendResponse({ success: true });
      }
      else if (['set_volume', 'update_eq', 'set_spatializer'].includes(request.action)) {
         // Forward control messages to offscreen
         chrome.runtime.sendMessage({
             ...request,
             target: 'offscreen'
         });
         sendResponse({ success: true });
      }
      else if (request.action === 'get_status') {
          // You might need to query offscreen for status
          sendResponse({ isInitialized: true }); // Placeholder
      }
    } catch (error) {
      console.error('Background error:', error);
      sendResponse({ success: false, error: error.message });
    }
  })();

  return true; // Keep channel open
});

