/**
 * PopupManager
 * Handles the logic, state, and UI updates for the extension popup.
 */
class PopupManager {
  constructor() {
    // Centralized State
    this.state = {
      connected: false,
      generatingKey: false,
      reconnecting: false,
      sessionIdentity: null,
    };

    // Constants & Configuration
    this.CHANNELS = {
      TO_POPUP: "send.to.popup",
      FROM_POPUP: "receive.from.popup",
    };

    this.MESSAGE_TYPES = {
      SCRIPT_INJECTION_FAIL: "script.injection.failed",
      PAIRING_KEY_REQUEST: "init.pairing_key_request",
      PAIRING_KEY: "init.pairing_key",
      HOST_DISCONNECT: "session.host_disconnect",
      HOST_RECONNECT: "session.host_reconnect",
      POPUP_GET_STATUS: "POPUP_GET_STATUS",
    };

    // DOM Elements Cache
    this.els = {
      status: document.getElementById("status"),
      session: document.getElementById("session"),
      disconnectBtn: document.getElementById("disconnect"),
      pairBtn: document.getElementById("pair-btn"),
      reconnectBtn: document.getElementById("reconnect"),
      pairContainer: document.getElementById("pair-container"),
      qrcode: document.getElementById("qrcode"),
      codeText: document.getElementById("code-text"),
      body: document.body,
      // A11y: Live region for announcements
      liveRegion: document.getElementById("a11y-live-region") || this.createLiveRegion(),
    };

    this.init();
  }

  /**
   * Initialize listeners and fetch initial status
   */
  init() {
    this.bindEvents();
    this.listenToBackground();
    // Fetch status immediately
    this.fetchStatus();
  }

  /**
   * Bind DOM events
   */
  bindEvents() {
    this.els.pairBtn.addEventListener("click", () => this.handlePairingRequest());
    this.els.disconnectBtn.addEventListener("click", () => this.handleDisconnect());
    this.els.reconnectBtn.addEventListener("click", () => this.handleReconnect());
  }

  /**
   * Listen for messages from the background script
   */
  listenToBackground() {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (!msg || !msg.type || msg.type !== this.CHANNELS.TO_POPUP) return;

      switch (msg.payload.type) {
        case this.MESSAGE_TYPES.PAIRING_KEY:
          this.renderQRCode(msg.payload.code);
          break;
        case this.MESSAGE_TYPES.SCRIPT_INJECTION_FAIL:
          this.handleInjectionFailure(msg.payload.failedTabs);
          break;
      }
    });
  }

  /**
   * Fetch current connection status from background
   * FIXED: Ensures UI renders even if the request fails
   */
  async fetchStatus() {
    try {
      const response = await this.sendMessage({ type: this.MESSAGE_TYPES.POPUP_GET_STATUS });

      if (!response) {
        // If no response, assume disconnected and update UI
        this.updateState({ connected: false });
        return;
      }

      this.updateState({
        connected: response.connected,
        sessionIdentity: response.sessionIdentity
      });
    } catch (error) {
      console.warn("Status fetch failed, defaulting to disconnected:", error);
      this.updateUIStatus("Status: Unavailable (Error)");
      this.updateState({ connected: false });
      this.updateUIStatus("Status: Disconnected");
    }
  }

  /**
   * Handle Pairing Request
   */
  async handlePairingRequest() {
    this.updateState({ generatingKey: true });

    try {
      await this.sendMessage({ type: this.MESSAGE_TYPES.PAIRING_KEY_REQUEST });
    } catch (error) {
      console.error("Pairing request failed", error);
      this.updateState({ generatingKey: false });
      this.announce("Failed to generate pairing key. Please try again.");
    }
  }

  /**
   * Handle Disconnect
   */
  async handleDisconnect() {
    try {
      await this.sendMessage({ type: this.MESSAGE_TYPES.HOST_DISCONNECT });
      window.close();
    } catch (error) {
      console.error("Disconnect failed", error);
    }
  }

  /**
   * Handle Reconnect
   */
  async handleReconnect() {
    this.updateState({ reconnecting: true });

    try {
      await this.sendMessage({ type: this.MESSAGE_TYPES.HOST_RECONNECT });

      // Close popup after delay to allow background to process
      setTimeout(() => {
        window.close();
      }, 1000);
    } catch (error) {
      console.error("Reconnect failed", error);
      this.updateState({ reconnecting: false });
      this.announce("Reconnection failed. Please check your connection.");
    }
  }

  /**
   * Render QR Code
   */
  renderQRCode(code) {
    this.updateState({ generatingKey: false });

    this.els.pairContainer.style.display = "block";
    this.els.pairBtn.style.display = "none";
    this.els.qrcode.innerHTML = "";
    this.els.codeText.textContent = code;

    this.announce(`Pairing code generated: ${code.split('').join(' ')}`);

    try {
      new QRCode(this.els.qrcode, {
        text: code,
        width: 128,
        height: 128,
        colorDark: "#000000",
        colorLight: "#ffffff",
        correctLevel: QRCode.CorrectLevel.H
      });

      const qrImage = this.els.qrcode.querySelector("img");
      if (qrImage) qrImage.alt = `QR Code for pairing key ${code}`;

    } catch (e) {
      console.error("QR Library missing", e);
      this.els.qrcode.textContent = "QR Library Error";
    }
  }

  /**
   * Handle Injection Failures
   */
  handleInjectionFailure(failedTabs) {
    if (!failedTabs || failedTabs.length === 0) return;

    const count = failedTabs.length;
    const warningDiv = document.createElement("div");
    warningDiv.classList.add("warning-banner");
    warningDiv.textContent = `⚠️ ${count} tab${count > 1 ? 's' : ''} need refresh. Please reload affected media tabs.`;
    warningDiv.setAttribute("role", "alert");

    this.els.body.insertBefore(warningDiv, this.els.body.firstChild);
  }

  /**
   * Update internal state and trigger UI render
   */
  updateState(newState) {
    this.state = { ...this.state, ...newState };
    this.render();
  }

  /**
   * Render UI based on current state
   */
  render() {
    const { connected, sessionIdentity, generatingKey, reconnecting } = this.state;

    if (connected) {
      this.updateUIStatus("Status: Host Active");
      this.els.session.textContent = "Session: Active";

      // Show Disconnect, Hide Reconnect
      this.toggleButton(this.els.disconnectBtn, true);
      this.toggleButton(this.els.pairBtn, true);
      this.els.reconnectBtn.style.display = "none";
    } else {
      this.updateUIStatus("Status: Disconnected");
      this.els.session.textContent = "Session: —";

      // Disable Pair, Show Reconnect
      this.toggleButton(this.els.pairBtn, false);
      this.els.reconnectBtn.style.display = "block";
    }

    // Handle "Generating..." state
    if (generatingKey) {
      this.els.pairBtn.textContent = "Generating Code...";
      this.els.pairBtn.disabled = true;
    } else {
      this.els.pairBtn.textContent = "Pair Device";
    }

    // Handle "Connecting..." state
    if (reconnecting) {
      this.els.reconnectBtn.textContent = "Connecting...";
      this.els.reconnectBtn.disabled = true;
    } else {
      this.els.reconnectBtn.textContent = "Reconnect Host";
      this.els.reconnectBtn.disabled = false;
    }

  }

  updateUIStatus(text) {
    if (this.els.status.textContent !== text) {
      this.els.status.textContent = text;
    }
  }

  toggleButton(btn, isEnabled) {
    btn.disabled = !isEnabled;
    if (isEnabled) {
      btn.classList.remove("inactive");
      btn.setAttribute("aria-disabled", "false");
    } else {
      btn.classList.add("inactive");
      btn.setAttribute("aria-disabled", "true");
    }
  }

  sendMessage(payload) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { type: this.CHANNELS.FROM_POPUP, payload },
        (response) => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            resolve(response);
          }
        }
      );
    });
  }

  createLiveRegion() {
    const el = document.createElement("div");
    el.id = "a11y-live-region";
    el.style.cssText = "position: absolute; width: 1px; height: 1px; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap;";
    el.setAttribute("aria-live", "polite");
    document.body.appendChild(el);
    return el;
  }

  announce(text) {
    if (this.els.liveRegion) {
      this.els.liveRegion.textContent = text;
    }
  }
}

document.addEventListener("DOMContentLoaded", () => {
  new PopupManager();
});