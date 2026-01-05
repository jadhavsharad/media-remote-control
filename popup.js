const statusEl = document.getElementById("status");
const sessionEl = document.getElementById("session");
const disconnectBtn = document.getElementById("disconnect");

chrome.runtime.sendMessage(
  { type: "POPUP_GET_STATUS" },
  (response) => {
    if (!response) {
      statusEl.textContent = "Status: Unavailable";
      return;
    }

    const { connected, sessionIdentity } = response;

    if (connected) {
      statusEl.textContent = "Status: Remote control active";
      sessionEl.textContent = `Session: ${sessionIdentity}`;

      disconnectBtn.disabled = false;
      disconnectBtn.classList.remove("inactive");
    } else {
      statusEl.textContent = "Status: Disconnected";
      sessionEl.textContent = "Session: —";
    }
  }
);

disconnectBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "POPUP_DISCONNECT" }, () => {
    window.close();
  });
});
