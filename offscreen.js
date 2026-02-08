// Handles audio processing to keep it alive when the popup closes.

console.log('Super Dribble Audio Engine (Offscreen) v1.1 Loaded');

let audioContext = null;
let sourceNode = null;
let gainNode = null;
let eqNodes = [];
let isProcessing = false;

const FREQUENCY_BANDS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

// Listen for messages from the extension
chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
  if (request.target !== 'offscreen') return;

  switch (request.action) {
    case 'start_capture':
      handleStartCapture(request.streamId, sendResponse);
      return true; // Async response

    case 'stop_capture':
      stopProcessing();
      sendResponse({ success: true });
      break;

    case 'set_volume':
      if (gainNode && audioContext) {
        const volume = request.value / 100;
        gainNode.gain.setValueAtTime(volume, audioContext.currentTime);
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false, error: 'Audio not initialized' });
      }
      break;

    case 'update_eq': // Update single band
        if (isProcessing && audioContext && request.bandIndex >= 0 && request.bandIndex < eqNodes.length) {
            eqNodes[request.bandIndex].gain.setValueAtTime(request.gainDb, audioContext.currentTime);
            sendResponse({ success: true });
        } else {
            sendResponse({ success: false, error: 'Audio not initialized or invalid band' });
        }
       break;

    case 'update_eq_preset': // Update all bands
        if (isProcessing && audioContext && request.preset && request.preset.values) {
             request.preset.values.forEach((gainDb, index) => {
                 if (index < eqNodes.length) {
                    eqNodes[index].gain.setValueAtTime(gainDb, audioContext.currentTime);
                 }
             });
             sendResponse({ success: true });
        } else {
             sendResponse({ success: false, error: 'Audio not initialized or invalid preset' });
        }
        break;
      
    default:
       console.warn('Unknown action in offscreen:', request.action);
       sendResponse({ success: false, error: 'Unknown action' });
  }
});

async function handleStartCapture(streamId, sendResponse) {
    try {
        if (isProcessing) {
            // If already processing, we arguably should stop and restart if the streamId is different,
            // or just ignore. For now, let's stop and restart to be safe.
            stopProcessing();
        }

        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                mandatory: {
                    chromeMediaSource: 'tab',
                    chromeMediaSourceId: streamId
                }
            },
            video: false
        });

        // Initialize Audio Context
        audioContext = new AudioContext();
        
        // Connect graph: Source -> Gain -> EQ Bands -> Destination
        sourceNode = audioContext.createMediaStreamSource(stream);
        gainNode = audioContext.createGain();
        gainNode.gain.value = 1.0; // Default unity gain (volume handled by gainNode)

        // Create EQ Nodes
        eqNodes = FREQUENCY_BANDS.map(frequency => {
            const filter = audioContext.createBiquadFilter();
            filter.type = 'peaking';
            filter.frequency.value = frequency;
            filter.Q.value = 1.0;
            filter.gain.value = 0;
            return filter;
        });

        // Connect Chain
        let currentNode = sourceNode;
        currentNode.connect(gainNode);
        currentNode = gainNode;

        eqNodes.forEach(filter => {
            currentNode.connect(filter);
            currentNode = filter;
        });

        currentNode.connect(audioContext.destination);

        isProcessing = true;
        
        // Handle stream ending (e.g. tab closed)
        stream.addEventListener('inactive', () => {
             stopProcessing();
             chrome.runtime.sendMessage({ action: 'capture_stopped' });
        });

        console.log('Offscreen audio processing started with EQ.');
        sendResponse({ success: true });

    } catch (error) {
        console.error('Failed to start offscreen capture:', error);
        // Notify background/UI of the error
        chrome.runtime.sendMessage({
            action: 'capture_error',
            error: error.message,
            stack: error.stack
        });
        sendResponse({ success: false, error: error.message });
    }
}

function stopProcessing() {
    if (sourceNode) {
        sourceNode.disconnect();
        sourceNode = null;
    }
    if (gainNode) {
        gainNode.disconnect();
        gainNode = null;
    }
    eqNodes.forEach(node => node.disconnect());
    eqNodes = [];

    if (audioContext) {
        audioContext.close();
        audioContext = null;
    }
    isProcessing = false;
}
