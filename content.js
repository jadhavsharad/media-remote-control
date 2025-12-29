const video = document.querySelector("video");
if (video) {
  attachVideo(video);
}

function sendState(video) {
  chrome.runtime.sendMessage({
    type: "STATE_UPDATE",
    state: video.paused ? "PAUSED" : "PLAYING"
  });
}

function attachVideo(video) {
  video.addEventListener("play", () => sendState(video));
  video.addEventListener("pause", () => sendState(video));
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === "TOGGLE_PLAYBACK") {
    if (!video) return;
    video.paused ? video.play() : video.pause();
  }
});