// Content script for Super Dribble Audio Amplifier
// This script is injected into web pages to ensure the extension is active

console.log('Super Dribble Audio Amplifier content script loaded');

// --- Media detection and control ---
let mediaObserver = null;
let trackedElements = new Set();
let lastSent = { title: null, artist: null, appName: null, isPlaying: null, duration: null };
let lastTimeUpdateSentAt = 0;

function getAllMediaElements() {
  return Array.from(document.querySelectorAll('video, audio'));
}

function pickPrimaryMedia() {
  const elements = getAllMediaElements();
  if (elements.length === 0) return null;
  // Prefer elements that are currently playing or recently interacted
  const playing = elements.find(el => !el.paused && !el.ended && el.readyState >= 2);
  if (playing) return playing;
  // Fallback: the first media element
  return elements[0];
}

function getAppName() {
  try {
    const host = location.host || location.hostname || '';
    return host || 'This Tab';
  } catch {
    return 'This Tab';
  }
}

function queryText(selectors) {
  for (const sel of selectors) {
    const node = document.querySelector(sel);
    if (node && node.textContent) return node.textContent.trim();
  }
  return '';
}

function getSpotifyMetadata() {
  // Known stable selectors evolve; use a wide net and pick the longest text
  const title = queryText([
    '[data-testid="nowplaying-track-link"]',
    '[data-testid="context-item-info-title"]',
    'footer [data-testid="context-item-info-title"]',
    'footer [data-testid="context-item-link"]',
    'footer a[href^="/track/"]',
    'footer [aria-label^="Now playing"] a[href^="/track/"]',
  ]);
  const artist = queryText([
    '[data-testid="nowplaying-artist"]',
    'footer a[href^="/artist/"]',
    'footer [data-testid="context-item-info-subtitles"] a[href^="/artist/"]',
  ]);
  return { title, artist };
}

function getMediaMetadata() {
  const el = pickPrimaryMedia();
  const ms = navigator.mediaSession || {};
  const md = ms.metadata;

  let title = (md && md.title) || '';
  let artist = (md && md.artist) || '';

  // Fallback: site-specific extraction
  const host = location.host || '';
  if ((!title || title === document.title) && host.includes('spotify.com')) {
    const sp = getSpotifyMetadata();
    if (sp.title) title = sp.title;
    if (sp.artist) artist = sp.artist;
  }

  // Generic fallback to document.title if still empty
  if (!title) title = (document.title || '').trim();

  const meta = {
    isPlaying: !!(el && !el.paused && !el.ended),
    title,
    artist,
    album: (md && md.album) || '',
    appName: getAppName(),
    duration: el && isFinite(el.duration) ? el.duration : undefined,
    position: el && isFinite(el.currentTime) ? el.currentTime : undefined,
  };
  return meta;
}

function sendMediaUpdate(force = false) {
  const info = getMediaMetadata();
  const key = JSON.stringify({
    title: info.title,
    artist: info.artist,
    appName: info.appName,
    isPlaying: info.isPlaying,
    duration: Math.floor(info.duration || 0),
  });

  const now = Date.now();
  const isTimeUpdate = !force && info.position !== undefined;
  const throttleOk = !isTimeUpdate || now - lastTimeUpdateSentAt > 1000; // 1 Hz for time updates

  if (force || key !== JSON.stringify(lastSent) || throttleOk) {
    lastSent = JSON.parse(key);
    if (isTimeUpdate) lastTimeUpdateSentAt = now;
    try {
      chrome.runtime.sendMessage({ action: 'media_state_update', ...info });
    } catch (e) {
      // Extension context invalidated (e.g. extension reloaded/updated)
      if (e.message.includes('Extension context invalidated')) {
        console.log('Extension context invalidated. Stopping content script activity.');
        // Clean up listeners if possible, or just ignore.
        if (mediaObserver) mediaObserver.disconnect();
        // Remove event listeners logic would be here if we tracked them better, 
        // but just stopping outgoing messages is usually enough.
      } else {
        console.error('Failed to send media update:', e);
      }
    }
  }
}

function attachElementListeners(el) {
  if (!el || trackedElements.has(el)) return;
  trackedElements.add(el);
  ['play', 'playing', 'pause', 'ended', 'loadedmetadata', 'durationchange'].forEach(evt => {
    el.addEventListener(evt, () => sendMediaUpdate(true));
  });
  el.addEventListener('timeupdate', () => sendMediaUpdate(false));
}

function setupMediaMonitoring() {
  getAllMediaElements().forEach(attachElementListeners);
  if (mediaObserver) mediaObserver.disconnect();
  mediaObserver = new MutationObserver(() => {
    getAllMediaElements().forEach(attachElementListeners);
  });
  mediaObserver.observe(document.documentElement || document.body, { childList: true, subtree: true });
  // Initial push
  sendMediaUpdate(true);
}

function clickIfExists(selectors) {
  for (const sel of selectors) {
    const btn = document.querySelector(sel);
    if (btn) {
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      return true;
    }
  }
  return false;
}

async function handleCommand(command) {
  try {
    const el = pickPrimaryMedia();
    switch (command) {
      case 'toggle': {
        if (el) {
          if (el.paused || el.ended) await el.play().catch(() => {});
          else el.pause();
          sendMediaUpdate(true);
          return { success: true };
        }
        // Fallback: click site play/pause buttons
        const okToggle = clickIfExists([
          '[data-testid="control-button-playpause"]', // Spotify
          '[data-testid="control-button-play"]',
          '[data-testid="control-button-pause"]',
          'button[aria-label="Play"]',
          'button[aria-label="Pause"]',
          '.ytp-play-button', // YouTube
        ]);
        if (okToggle) { setTimeout(() => sendMediaUpdate(true), 300); return { success: true }; }
        return { success: false, error: 'No media element found' };
      }
      case 'next': {
        // Try common sites
        const ok = clickIfExists([
          // Spotify
          '[data-testid="control-button-skip-forward"]',
          '[data-testid="control-button-next"]',
          // YouTube / YT Music
          '.ytp-next-button',
          'button[aria-label="Next"]',
          // SoundCloud / others
          '.player-controls__next', '.playControls__next',
        ]);
        if (ok) { setTimeout(() => sendMediaUpdate(true), 300); return { success: true }; }
        return { success: false, error: 'Next control not found on this page' };
      }
      case 'previous': {
        const ok = clickIfExists([
          // Spotify
          '[data-testid="control-button-skip-back"]',
          '[data-testid="control-button-previous"]',
          // YouTube
          'button[aria-label="Previous"]',
          // SoundCloud / others
          '.player-controls__prev', '.playControls__prev',
        ]);
        if (ok) { setTimeout(() => sendMediaUpdate(true), 300); return { success: true }; }
        return { success: false, error: 'Previous control not found on this page' };
      }
      default:
        return { success: false, error: 'Unknown command' };
    }
  } catch (e) {
    return { success: false, error: (e && e.message) || 'Command failed' };
  }
}

// Listen for messages from the extension (popup/UI)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // console.log('Content script received message:', request);

  (async () => {
    switch (request.action) {
      case 'ping':
        sendResponse({ success: true, message: 'Content script is active' });
        break;
      case 'media_control': {
        const result = await handleCommand(request.command);
        sendResponse(result);
        break;
      }
      case 'get_media_info':
        sendResponse(getMediaMetadata());
        break;
      default:
        sendResponse({ success: false, error: 'Unknown action' });
    }
  })();

  return true; // keep channel open for async
});

// Initialize monitoring as soon as possible
setupMediaMonitoring();

// Notify background/UI that content script is ready
try {
  chrome.runtime.sendMessage({
    action: 'content_script_ready',
    url: window.location.href,
    title: document.title,
  });
} catch (e) {
  // Ignore invalidation errors on init
}
