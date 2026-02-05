// content.js
let currentMedia = null;
let lastReportedState = {};

const MESSAGE_TYPES = {
  STATE_UPDATE: "control.state_update",
  HOST_RECONNECTED: "session.host_reconnected",
  INTENT: {
    SET: "control.set",
    REPORT: "control.report"
  }
};

const MEDIA_STATE = {
  PLAYBACK: "playback",       // values: "PLAYING", "PAUSED"
  MUTE: "muted",              // values: true, false
  TIME: "currentTime",        // values: number (seconds)
  DURATION: "duration",       // values: number (seconds)
  TITLE: "title",             // values: string
  VOLUME: "volume",           // values: number (0-1)
};

/**
 * Validates that a key is a known MEDIA_STATE property
 */
function isMediaState(key) {
  return Object.values(MEDIA_STATE).includes(key);
}

/**
 * Checks if a media element is valid for control
 */
function isValidMedia(media) {
  return (
    (media instanceof HTMLVideoElement || media instanceof HTMLAudioElement) &&
    media.isConnected &&
    (media.tagName === "AUDIO" || !media.disablePictureInPicture) &&
    media.readyState >= 2
  );
}

/**
 * Generic state reporting function - reports any MEDIA_STATE property
 * Only sends update if value has changed (diffing)
 */
function reportMediaState(key, value) {
  // Skip if value hasn't changed
  if (lastReportedState[key] === value) return;

  lastReportedState[key] = value;

  try {
    chrome.runtime.sendMessage({
      type: "receive.from.content_script",
      payload: {
        type: MESSAGE_TYPES.STATE_UPDATE,
        intent: MESSAGE_TYPES.INTENT.REPORT,
        key,
        value
      }
    }).catch(() => { });
  } catch {
    console.log("Failed to send message to background script");
  }
}

/**
 * Reports all tracked media properties
 */
function reportAllStates(media) {
  reportMediaState(MEDIA_STATE.PLAYBACK, media.paused ? "PAUSED" : "PLAYING");
  reportMediaState(MEDIA_STATE.VOLUME, media.volume);
  reportMediaState(MEDIA_STATE.DURATION, media.duration || 0);
  // Note: currentTime is intentionally not auto-reported to avoid spam
  // It should be reported on-demand or with debouncing for progress updates
}

/**
 * Gets a snapshot of all media properties
 */
function getMediaSnapshot(media) {
  return {
    [MEDIA_STATE.PLAYBACK]: media.paused ? "PAUSED" : "PLAYING",
    [MEDIA_STATE.VOLUME]: media.volume,
    [MEDIA_STATE.MUTE]: media.muted,
    [MEDIA_STATE.DURATION]: media.duration || 0,
    [MEDIA_STATE.TIME]: media.currentTime || 0,
  };
}

// ============================================================================
// EVENT HANDLERS
// ============================================================================

function onPlay() {
  if (currentMedia) reportMediaState(MEDIA_STATE.PLAYBACK, "PLAYING");
}

function onPause() {
  if (currentMedia) reportMediaState(MEDIA_STATE.PLAYBACK, "PAUSED");
}

function onVolumeChange() {
  if (currentMedia) {
    reportMediaState(MEDIA_STATE.VOLUME, currentMedia.volume);
  }
}

function onDurationChange() {
  if (currentMedia) {
    reportMediaState(MEDIA_STATE.DURATION, currentMedia.duration || 0);
  }
}

// ============================================================================
// MEDIA ATTACHMENT / DETACHMENT
// ============================================================================

function detachMedia() {
  if (!currentMedia) return;

  currentMedia.removeEventListener("play", onPlay);
  currentMedia.removeEventListener("pause", onPause);
  currentMedia.removeEventListener("volumechange", onVolumeChange);
  currentMedia.removeEventListener("durationchange", onDurationChange);

  currentMedia = null;
  lastReportedState = {};
  reportMediaState(MEDIA_STATE.PLAYBACK, "IDLE");
}

function attachMedia(media) {
  if (currentMedia === media) return;

  detachMedia();
  currentMedia = media;
  lastReportedState = {};

  // Attach all event listeners
  media.addEventListener("play", onPlay);
  media.addEventListener("pause", onPause);
  media.addEventListener("volumechange", onVolumeChange);
  media.addEventListener("durationchange", onDurationChange);

  // Report initial state for all tracked properties
  reportAllStates(media);
}

// ============================================================================
// MEDIA DISCOVERY
// ============================================================================

function discoverMedia() {
  const mediaElements = Array
    .from(document.querySelectorAll("video, audio"))
    .filter(isValidMedia);

  if (!mediaElements.length) {
    detachMedia();
    return;
  }

  const candidate =
    mediaElements.find(v => !v.paused && v.currentTime > 0) || mediaElements[0];

  attachMedia(candidate);
}

function startPolling() {
  discoverMedia();
  setInterval(() => {
    discoverMedia();
  }, 2000);
}

// ============================================================================
// COMMAND HANDLERS - Execute commands from remote
// ============================================================================

const COMMAND_HANDLERS = {
  [MEDIA_STATE.PLAYBACK]: (media, value) => {
    if (value === "PLAYING") {
      media.play();
    } else {
      media.pause();
    }
  },

  [MEDIA_STATE.VOLUME]: (media, value) => {
    // Clamp value between 0 and 1
    const vol = Math.max(0, Math.min(1, Number(value)));
    media.volume = vol;
  },

  [MEDIA_STATE.TIME]: (media, value) => {
    const time = Number(value);
    if (!Number.isNaN(time) && time >= 0) {
      media.currentTime = time;
    }
  },
};

// ============================================================================
// MESSAGE LISTENER
// ============================================================================

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Handle host reconnection - re-report state
  if (msg.type === MESSAGE_TYPES.HOST_RECONNECTED) {
    discoverMedia();
    if (currentMedia) {
      reportAllStates(currentMedia);
    }
    sendResponse({ ok: true });
    return;
  }

  // Validate message structure
  if (
    !msg ||
    msg?.type !== MESSAGE_TYPES.STATE_UPDATE ||
    typeof msg.type !== "string" ||
    !isMediaState(msg.key)
  ) {
    sendResponse({ ok: false });
    return;
  }

  // Validate media availability
  if (!currentMedia?.isConnected) {
    sendResponse({ ok: false, reason: "No media" });
    return;
  }

  // Execute command
  try {
    const handler = COMMAND_HANDLERS[msg.key];
    if (handler) {
      handler(currentMedia, msg.value);
      sendResponse({ ok: true });
    } else {
      sendResponse({ ok: false, reason: `Unknown key: ${msg.key}` });
    }
  } catch (err) {
    console.error("Control Event Error:", err);
    sendResponse({ error: err.message });
  }
});

// Start the polling loop
startPolling();