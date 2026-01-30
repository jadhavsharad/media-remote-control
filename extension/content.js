// content.js
let currentMedia = null;
let lastReportedState = null;

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
};

function isValidMedia(media) {
  return (
    media instanceof HTMLMediaElement &&
    media.isConnected &&
    (media.tagName === "AUDIO" || !media.disablePictureInPicture) &&
    media.readyState >= 2
  );
}

function isMediaState(key) {
  return Object.values(MEDIA_STATE).includes(key);
}

function getPlaybackState(media) {
  return media.paused ? "PAUSED" : "PLAYING";
}

function reportState(media) {
  const state = getPlaybackState(media);
  if (state === lastReportedState) return;

  lastReportedState = state;

  try {
    chrome.runtime.sendMessage({ type: "receive.from.content_script", payload: { type: MESSAGE_TYPES.STATE_UPDATE, state, intent: MESSAGE_TYPES.INTENT.REPORT, }, }).catch(() => { });
  } catch {
  }
}

function detachMedia() {
  if (!currentMedia) return;

  currentMedia.removeEventListener("play", onPlay);
  currentMedia.removeEventListener("pause", onPause);
  currentMedia = null;
  lastReportedState = null;
}

function attachMedia(media) {
  if (currentMedia === media) return;

  detachMedia();
  currentMedia = media;
  lastReportedState = null;

  media.addEventListener("play", onPlay);
  media.addEventListener("pause", onPause);

  reportState(media);
}

function onPlay() {
  if (currentMedia) reportState(currentMedia);
}

function onPause() {
  if (currentMedia) reportState(currentMedia);
}


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

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === MESSAGE_TYPES.HOST_RECONNECTED) {
    discoverMedia();
    if (currentMedia) {
      reportState(currentMedia);
    }
    sendResponse({ ok: true });
    return;
  }

  if (
    !msg ||
    msg.type !== MESSAGE_TYPES.STATE_UPDATE ||
    typeof msg.type !== "string" ||
    !isMediaState(msg.key)
  ) {
    sendResponse({ ok: false });
    return;
  }

  if (!currentMedia || !currentMedia.isConnected) {
    sendResponse({ ok: false, reason: "No media" });
    return;
  }

  try {
    switch (msg.key) {
      case MEDIA_STATE.PLAYBACK:
        msg.value === "PLAYING" ? currentMedia.play() : currentMedia.pause();
        break;
    }
    sendResponse({ ok: true });
  } catch (err) {
    console.error("Control Event Error:", err);
    sendResponse({ error: err.message });
  }
});

startPolling();