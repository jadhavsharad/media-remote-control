const statusEl = document.getElementById("status");
const sessionEl = document.getElementById("session");
const disconnectBtn = document.getElementById("disconnect");
const pairBtn = document.getElementById("pair-btn");
const pairContainer = document.getElementById("pair-container");
const qrcodeEl = document.getElementById("qrcode");
const codeTextEl = document.getElementById("code-text");

let qrcodeObj = null;

chrome.runtime.sendMessage({ type: "FROM_POPUP", popup: { type: "POPUP_GET_STATUS" } },
  (response) => {
    if (!response) {
      statusEl.textContent = "Status: Unavailable";
      return;
    }

    const { connected, sessionIdentity } = response;

    if (connected) {
      statusEl.textContent = "Status: Host Active";
      sessionEl.textContent = `Session: Active`;

      disconnectBtn.disabled = false;
      disconnectBtn.classList.remove("inactive");
      pairBtn.disabled = false;
      pairBtn.classList.remove("inactive");
    } else {
      statusEl.textContent = "Status: Disconnected";
      sessionEl.textContent = "Session: —";
      pairBtn.disabled = true;
      pairBtn.classList.add("inactive");
    }
  }
);

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "TO_POPUP" && msg.payload.type === "PAIR_CODE_RECEIVED") {
    renderQRCode(msg.payload.code);
  }

  // Extension Reload Recovery - notify user of failed reinjections
  if (msg.type === "TO_POPUP" && msg.payload.type === "REINJECTION_FAILED") {
    const failedTabs = msg.payload.failedTabs;
    if (failedTabs.length > 0) {
      showReinjectionWarning(failedTabs.length);
    }
  }
});

pairBtn.addEventListener("click", () => {
  pairBtn.textContent = "Generating Code...";
  pairBtn.disabled = true;

  chrome.runtime.sendMessage({
    type: "FROM_POPUP",
    popup: { type: "POPUP_REQUEST_CODE" }
  }, (res) => {

  });
});

disconnectBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "FROM_POPUP", popup: { type: "POPUP_DISCONNECT" } }, () => {
    window.close();
  });
});

function renderQRCode(code) {
  pairContainer.style.display = "block";
  qrcodeEl.innerHTML = "";
  codeTextEl.textContent = code;

  new QRCode(qrcodeEl, {
    text: code,
    width: 128,
    height: 128,
    colorDark: "#ffffff",
    colorLight: "#0f172a",
    correctLevel: QRCode.CorrectLevel.H
  });

  pairBtn.style.display = "none";
}

// show warning for failed reinjections
function showReinjectionWarning(count) {
  const warningEl = document.createElement("div");
  warningEl.style.cssText = "background: #fef3c7; color: #92400e; padding: 8px; margin: 8px 0; border-radius: 4px; font-size: 12px;";
  warningEl.textContent = `⚠️ ${count} tab${count > 1 ? 's' : ''} need refresh. Please reload affected media tabs.`;

  const container = document.querySelector("body");
  if (container) {
    container.insertBefore(warningEl, container.firstChild);
  }
}
