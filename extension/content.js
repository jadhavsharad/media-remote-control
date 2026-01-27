// content.js
let currentVideo = null;
let lastReportedState = null;
let observer = null;


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

function isValidVideo(video) {
  return (
    video instanceof HTMLVideoElement &&
    video.isConnected &&
    !video.disablePictureInPicture &&
    video.readyState >= 2
  );
}

function isMediaState(key) {
  return Object.values(MEDIA_STATE).includes(key);
}

function getPlaybackState(video) {
  return video.paused ? "PAUSED" : "PLAYING";
}

function reportState(video) {
  const state = getPlaybackState(video);
  if (state === lastReportedState) return;

  lastReportedState = state;

  try {
    chrome.runtime.sendMessage({ type: "receive.from.content_script", payload: { type: MESSAGE_TYPES.STATE_UPDATE, state, intent: MESSAGE_TYPES.INTENT.REPORT, }, }).catch(() => { });
  } catch {
  }
}

function detachVideo() {
  if (!currentVideo) return;

  currentVideo.removeEventListener("play", onPlay);
  currentVideo.removeEventListener("pause", onPause);
  currentVideo = null;
  lastReportedState = null;
}

function attachVideo(video) {
  if (currentVideo === video) return;

  detachVideo();
  currentVideo = video;
  lastReportedState = null;

  video.addEventListener("play", onPlay);
  video.addEventListener("pause", onPause);

  reportState(video);
}

function onPlay() {
  if (currentVideo) reportState(currentVideo);
}

function onPause() {
  if (currentVideo) reportState(currentVideo);
}


function discoverVideo() {
  const videos = Array
    .from(document.querySelectorAll("video"))
    .filter(isValidVideo);

  if (!videos.length) {
    detachVideo();
    return;
  }

  const candidate =
    videos.find(v => !v.paused && v.currentTime > 0) || videos[0];

  attachVideo(candidate);
}

function startPolling() {
  discoverVideo();

  setInterval(() => {
    discoverVideo();
  }, 2000);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === MESSAGE_TYPES.HOST_RECONNECTED) {
    discoverVideo();
    if (currentVideo) {
      reportState(currentVideo);
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

  if (!currentVideo || !currentVideo.isConnected) {
    sendResponse({ ok: false, reason: "No video" });
    return;
  }

  try {
    switch (msg.key) {
      case MEDIA_STATE.PLAYBACK:
        if (msg.value === "PLAYING") currentVideo.play();
        else currentVideo.pause();
        break;
    }
    sendResponse({ ok: true });
  } catch (err) {
    console.error("Control Event Error:", err);
    sendResponse({ error: err.message });
  }
});

startPolling();