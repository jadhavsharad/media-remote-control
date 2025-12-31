let currentVideo = null;

function onPlay() {
  SendState("PLAYING");
}

function onPause() {
  SendState("PAUSED");
}

function SendState(state) {
  try {
    chrome.runtime.sendMessage({
      type: "STATE_UPDATE",
      state
    });
  } catch {
    console.warn("Failed to send state update to background script");
  }
}

function attachVideo(video) {
  if (currentVideo === video) return;
  if (currentVideo) {
    currentVideo.removeEventListener("play", onPlay);
    currentVideo.removeEventListener("pause", onPause);
  }
  currentVideo = video;
  video.addEventListener("play", onPlay);
  video.addEventListener("pause", onPause);
}

function observeVideoElement() {
  const observer = new MutationObserver(() => {
    const video = document.querySelector("video");
    if (video) attachVideo(video);
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}

observeVideoElement();

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action !== "TOGGLE_PLAYBACK") return;
  if (!currentVideo) return;

  try {
    currentVideo.paused ? currentVideo.play() : currentVideo.pause();
  } catch {
    console.warn("Failed to toggle video playback");
  }
});
