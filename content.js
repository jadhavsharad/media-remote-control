let currentVideo = null;
let lastReportedState = null;
let observer = null;

const CONTROL_ACTIONS = new Set([
  "TOGGLE_PLAYBACK"
]);


function isValidVideo(video) {
  return (
    video instanceof HTMLVideoElement &&
    video.isConnected &&
    !video.disablePictureInPicture &&
    video.readyState >= 2
  );
}

function getPlaybackState(video) {
  return video.paused ? "PAUSED" : "PLAYING";
}

function reportState(video) {
  const state = getPlaybackState(video);
  if (state === lastReportedState) return;

  lastReportedState = state;

  try {
    chrome.runtime.sendMessage({
      type: "STATE_UPDATE",
      state
    });
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

function startObserver() {
  if (observer) return;

  observer = new MutationObserver(() => {
    discoverVideo();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });

  discoverVideo();
}

chrome.runtime.onMessage.addListener((msg) => {
  if (
    !msg ||
    msg.type !== "CONTROL_EVENT" ||
    typeof msg.action !== "string" ||
    !CONTROL_ACTIONS.has(msg.action)
  ) {
    return;
  }

  if (!currentVideo || !currentVideo.isConnected) return;

  try {
    switch (msg.action) {
      case "TOGGLE_PLAYBACK":
        currentVideo.paused
          ? currentVideo.play()
          : currentVideo.pause();
        break;
    }
  } catch {
  }
});

startObserver();
