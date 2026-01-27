// Background.js
import { MESSAGE_TYPES, CHANNELS, BASE_DOMAINS, MEDIA_STATE } from "./libs/constants.js";
import { MediaStateStore } from "./libs/mediaStateStore.js";

const OFFSCREEN_PATH = 'offscreen.html';

/**
 * -----------------------------------------------------------------------------
 * 1. STATE MANAGEMENT (Persisted & Rehydrated)
 * Solves: Service Worker termination causing state loss.
 * -----------------------------------------------------------------------------
 */
class StateManager {
  constructor() {
    this.localState = {
      connected: false,
      sessionIdentity: null,
      hostToken: null,
      // Map<remoteId, { tabId: number | null }>
      // We store this as an Object for storage serialization
      remoteContext: {},
    };
  }

  /** Initialize state from storage on startup */
  async init() {
    const stored = await chrome.storage.local.get(null);
    this.localState = { ...this.localState, ...stored };
    this.updateBadge(this.localState.connected);
    return this.localState;
  }

  get(key) {
    return this.localState[key];
  }

  /** Atomic update for memory + storage */
  async set(updates) {
    this.localState = { ...this.localState, ...updates };

    // Optimistic UI update
    if ('connected' in updates) {
      this.updateBadge(updates.connected);
    }

    await chrome.storage.local.set(updates);
  }

  updateBadge(isConnected) {
    const text = isConnected ? "ON" : "";
    const color = isConnected ? "#16a34a" : "#64748b";

    // Safety check for API availability
    if (chrome.action) {
      chrome.action.setBadgeText({ text });
      chrome.action.setBadgeBackgroundColor({ color });
    }
  }

  // --- Remote Context Helpers ---
  getRemoteContext(remoteId) {
    return this.localState.remoteContext[remoteId] || { tabId: null };
  }

  async updateRemoteContext(remoteId, data) {
    const ctx = { ...this.localState.remoteContext };

    if (data === null) {
      delete ctx[remoteId]; // Remove remote
    } else {
      ctx[remoteId] = { ...(ctx[remoteId] || {}), ...data };
    }

    await this.set({ remoteContext: ctx });
  }

  async clearAllRemoteContexts() {
    await this.set({ remoteContext: {} });
  }
}

const state = new StateManager();
const mediaStore = new MediaStateStore(state);

/**
 * -----------------------------------------------------------------------------
 * 2. COMMAND REGISTRY (Scalable Feature Expansion)
 * To add new features (e.g., Volume, Seek), just add a handler here.
 * -----------------------------------------------------------------------------
 */
const COMMAND_REGISTRY = {
  /**
   * Mute is special because it uses the chrome.tabs API directly
   */
  [MEDIA_STATE.MUTE]: async (tabId, value) => {
    await chrome.tabs.update(tabId, { muted: value });
    // Return the confirm value to send back to server
    const updatedTab = await chrome.tabs.get(tabId);
    return updatedTab.mutedInfo?.muted ?? value;
  },

  /**
   * Playback is handled by the Content Script
   */
  [MEDIA_STATE.PLAYBACK]: async (tabId, value) => {
    return await sendToTabSafe(tabId, {
      type: MESSAGE_TYPES.STATE_UPDATE,
      intent: MESSAGE_TYPES.INTENT.SET,
      key: MEDIA_STATE.PLAYBACK,
      value
    });
  },

  /**
   * Time/Seek handled by Content Script
   */
  [MEDIA_STATE.TIME]: async (tabId, value) => {
    return await sendToTabSafe(tabId, {
      type: MESSAGE_TYPES.STATE_UPDATE,
      intent: MESSAGE_TYPES.INTENT.SET,
      key: MEDIA_STATE.TIME,
      value
    });
  }
};


/**
 * -----------------------------------------------------------------------------
 * 3. LIFECYCLE & INITIALIZATION
 * -----------------------------------------------------------------------------
 */

// Initialize immediately
(async () => {
  await state.init();
  await mediaStore.load();
  await ensureOffscreen();
  // Clean up stale contexts on boot
  refreshMediaList();
})();

// Event Listeners
chrome.runtime.onStartup.addListener(async () => {
  await state.init();
  await ensureOffscreen();
  injectContentScript(); // Ensure scripts are present after browser restart
});

chrome.runtime.onInstalled.addListener(async () => {
  await state.init();
  await ensureOffscreen();
  injectContentScript();
});

// Tab Listeners (Debounced where appropriate)
const refreshMediaList = debouncedScheduler(async () => {
  const tabs = await sendMediaList(); // already returns enriched snapshot
  const validTabIds = new Set(tabs.map(t => t.tabId));

  const mediaState = mediaStore.getAll(), remoteContext = state.get("remoteContext");
  let mediaDirty = false, contextDirty = false;

  // Cleanup mediaState
  for (const tabId in mediaState) {
    if (!validTabIds.has(Number(tabId))) {
      delete mediaState[tabId];
      mediaDirty = true;
    }
  }

  // Cleanup remote contexts
  for (const remoteId in remoteContext) {
    const ctx = remoteContext[remoteId];
    if (ctx.tabId && !validTabIds.has(ctx.tabId)) {
      ctx.tabId = null;
      contextDirty = true;
    }
  }

  if (mediaDirty) {
    await state.set({ mediaStateByTab: mediaState });
  }

  if (contextDirty) {
    await state.set({ remoteContext });
  }
});

chrome.tabs.onRemoved.addListener(() => refreshMediaList());
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  refreshMediaList();
});
chrome.tabs.onCreated.addListener(() => refreshMediaList());


/**
 * -----------------------------------------------------------------------------
 * 4. MESSAGE ROUTING (The Nervous System)
 * -----------------------------------------------------------------------------
 */

// Route: Server -> Background
receiveMessage(CHANNELS.FROM_SERVER, async (payload) => {
  await handleServerMessage(payload);
});

// Route: Content Script -> Background
receiveMessage(CHANNELS.FROM_CONTENT_SCRIPT, async (payload, sender) => {
  if (!isValidMessageType(payload.type)) return;

  // REPORT means the video state changed (e.g. user paused manually)
  // We forward this to the server so the remote UI updates
  if (payload.type === MESSAGE_TYPES.STATE_UPDATE && payload.intent === MESSAGE_TYPES.INTENT.REPORT) {
    if (sender && sender.tab) {
      const tabId = sender.tab.id;
      await mediaStore.set(tabId, { playback: payload.state });
      sendToServer({ ...payload, tabId });
    }
  }
});

// Route: Popup -> Background
receiveMessage(CHANNELS.FROM_POPUP, (payload, _, sendResponse) => {
  handlePopup(payload, sendResponse);
  return true; // Keep channel open for async response
});


/**
 * -----------------------------------------------------------------------------
 * 5. CORE LOGIC HANDLERS
 * -----------------------------------------------------------------------------
 */

async function handleServerMessage(msg) {
  if (!msg?.type) return;

  switch (msg.type) {
    case "WS_CLOSED":
      await state.set({ connected: false });
      break;

    case "WS_OPEN":
      await handleWSOpen();
      break;

    case MESSAGE_TYPES.HOST_REGISTERED:
      await state.set({
        connected: true,
        sessionIdentity: msg.SESSION_IDENTITY,
        hostToken: msg.hostToken
      });
      sendMediaList();
      break;

    case MESSAGE_TYPES.PAIRING_KEY:
      // Forward to Popup
      sendMessage(CHANNELS.TO_POPUP, {
        type: MESSAGE_TYPES.PAIRING_KEY,
        code: msg.code,
        ttl: msg.ttl
      });
      break;

    case MESSAGE_TYPES.REMOTE_JOINED:
      // Reset context for this remote
      await state.updateRemoteContext(msg.remoteId, { tabId: null });
      sendMediaList({ remoteId: msg.remoteId });
      break;

    case MESSAGE_TYPES.SELECT_ACTIVE_TAB:
      await handleSelectTab(msg.remoteId, msg.tabId);
      break;

    case MESSAGE_TYPES.STATE_UPDATE:
      if (msg.intent === MESSAGE_TYPES.INTENT.SET) {
        await executeRemoteCommand(msg);
      }
      break;

    case MESSAGE_TYPES.HOST_DISCONNECTED:
      await state.set({ connected: false });
      break;
  }
}

async function handleWSOpen() {
  // Re-register if we have a token
  const hostToken = state.get("hostToken");
  const os = await getOS();
  const browser = getBrowser();

  // Re-inject/Wakeup tabs on reconnect
  const tabs = await getMediaList();
  tabs.forEach(t => injectContentScriptSingle(t.tabId));

  sendToServer({
    type: MESSAGE_TYPES.HOST_REGISTER,
    hostToken: hostToken,
    info: { os, browser }
  });
}

async function handleSelectTab(remoteId, tabId) {
  const isValid = await validateTab(tabId);
  if (!isValid) return;

  await state.updateRemoteContext(remoteId, { tabId });
}

/**
 * Executes a command from the registry.
 * Robustness: Handles invalid tabs and missing handlers gracefully.
 */
async function executeRemoteCommand(msg) {
  const { remoteId, key, value } = msg;

  // 1. Validate Context
  const ctx = state.getRemoteContext(remoteId);
  if (!ctx || !ctx.tabId) {
    console.warn(`Command ignored: No active tab for remote ${remoteId}`);
    return;
  }

  // 2. Validate Tab existence
  if (!(await validateTab(ctx.tabId))) {
    console.warn(`Command ignored: Tab ${ctx.tabId} is gone.`);
    await state.updateRemoteContext(remoteId, { tabId: null });
    return;
  }

  // 3. Dispatch Command
  const handler = COMMAND_REGISTRY[key];
  if (handler) {
    try {
      const resultValue = await handler(ctx.tabId, value);

      // 4. Report Success back to Server (Optional, but good for UI sync)
      // We only report if the handler returned a value
      if (resultValue !== undefined) {
        // Optimization: The content script usually reports back via onMessage
        // so we might not need to duplicate it here, but it's safe.
      }
    } catch (err) {
      console.error(`Command execution failed:`, err);
    }
  } else {
    console.warn(`Unknown command key: ${key}`);
  }
}

function handlePopup(req, sendResponse) {
  const connected = state.get("connected");
  const sessionIdentity = state.get("sessionIdentity");

  switch (req.type) {
    case "POPUP_GET_STATUS":
      sendResponse({ connected, sessionIdentity });
      break;

    case MESSAGE_TYPES.PAIRING_KEY_REQUEST:
      sendToServer({ type: MESSAGE_TYPES.PAIRING_KEY_REQUEST });
      sendResponse({ ok: true });
      break;

    case MESSAGE_TYPES.HOST_DISCONNECT:
      sendToServer({ type: MESSAGE_TYPES.HOST_DISCONNECT });
      state.set({ connected: false, sessionIdentity: null }).then(() => {
        sendResponse({ ok: true });
      });
      break;

    case MESSAGE_TYPES.HOST_RECONNECT:
      // Force offscreen recreation to trigger WS connect
      sendToServer({ type: MESSAGE_TYPES.HOST_RECONNECT });
      break;

    default:
      sendResponse({ error: "Unknown request" });
  }
}


/**
 * -----------------------------------------------------------------------------
 * 6. UTILITIES & HELPERS
 * -----------------------------------------------------------------------------
 */

// --- Network / Offscreen ---

let creating;

async function ensureOffscreen() {
  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_PATH);

  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [offscreenUrl]
  });

  if (contexts.length > 0) return;

  if (creating) {
    await creating;
    return;
  }

  creating = (async () => {
    try {
      await chrome.offscreen.createDocument({
        url: OFFSCREEN_PATH,
        reasons: ['BLOBS'],
        justification: 'WebSocket background connection',
      });
    } catch (e) {
      if (!e.message.includes("Only a single offscreen")) {
        throw e;
      }
    }
  })();

  await creating;
  creating = null;
}


async function sendToServer(payload) {
  // We can only send if we have a way to talk to the offscreen doc
  // If not connected yet (registering), strictly allow REGISTER type
  const connected = state.get("connected");
  if (!connected && payload.type !== MESSAGE_TYPES.HOST_REGISTER) return;

  await ensureOffscreen();
  sendMessage(CHANNELS.FROM_BACKGROUND, payload);
}

// --- Tab & Script Management ---

async function validateTab(tabId) {
  if (!tabId) return false;
  try {
    await chrome.tabs.get(tabId);
    return true;
  } catch {
    return false;
  }
}

/**
 * Safely send a message to a content script.
 * Catches errors if the script is missing or the tab is busy.
 */
async function sendToTabSafe(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (error) {
    // Common error: "Could not establish connection. Receiving end does not exist."
    // This implies the content script is not loaded.
    console.warn(`Tab ${tabId} unreachable. Attempting reinjection...`);
    try {
      await injectContentScriptSingle(tabId);
      // Retry once
      return await chrome.tabs.sendMessage(tabId, message);
    } catch (retryErr) {
      console.error(`Failed to recover tab ${tabId}:`, retryErr);
      return null;
    }
  }
}

async function injectContentScriptSingle(tabId) {
  try {
    // First try pinging the content script
    await chrome.tabs.sendMessage(tabId, { type: MESSAGE_TYPES.HOST_RECONNECT });
    return; // already injected
  } catch {
    // Not present → inject
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content.js"],
      });
    } catch { }
  }
}

async function injectContentScript() {
  const mediaTabs = await getMediaList();
  for (const tab of mediaTabs) {
    await injectContentScriptSingle(tab.tabId);
  }
}

async function getMediaList() {
  const tabs = await chrome.tabs.query({});
  return tabs
    .filter(tab => isMediaUrl(tab.url))
    .map(tab => ({
      tabId: tab.id,
      title: tab.title || "Untitled",
      url: tab.url,
      favIconUrl: tab.favIconUrl || "",
      muted: tab.mutedInfo?.muted ?? false,
    }));
}

async function sendMediaList(extra = {}) {
  const tabs = await getMediaList();
  const mediaState = mediaStore.getAll();

  const enriched = tabs.map(tab => ({
    ...tab,
    playback: mediaState[tab.tabId]?.playback || "IDLE",
    currentTime: mediaState[tab.tabId]?.currentTime || 0,
    duration: mediaState[tab.tabId]?.duration || 0
  }));

  const payload = { type: MESSAGE_TYPES.MEDIA_LIST, tabs: enriched, ...extra };
  sendToServer(payload);
  return enriched;
}

function isMediaUrl(url) {
  if (!url) return false;
  try {
    const { hostname } = new URL(url);
    return BASE_DOMAINS.some(domain => hostname === domain || hostname.endsWith("." + domain));
  } catch {
    return false;
  }
}

// --- Generic Messaging Wrappers ---

function sendMessage(channel, payload) {
  // Fire and forget, but catch errors
  chrome.runtime.sendMessage({ type: channel, payload }).catch(() => {
    // Expected error if no popup is open to receive this
  });
}

function receiveMessage(channel, handler) {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    // Security: Only accept messages from our own extension
    if (sender.id !== chrome.runtime.id) return false;

    // Protocol Check
    if (!msg || msg.type !== channel) return false;

    // Content Script Security: Verify sender is a tab
    if (channel === CHANNELS.FROM_CONTENT_SCRIPT && (!sender.tab || !sender.tab.id)) {
      return false;
    }

    // Execute Handler
    return handler(msg.payload, sender, sendResponse);
  });
}

function isValidMessageType(type) {
  return Object.values(MESSAGE_TYPES).includes(type);
}

// --- Utils ---

function debouncedScheduler(fn, delay = 300) {
  let timer = null;
  return () => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn().catch(e => console.warn("Scheduled task failed", e));
    }, delay);
  };
}

function getBrowser() {
  // Simple heuristic, userAgentData is preferred if available
  if (navigator.userAgentData?.brands) {
    const brands = navigator.userAgentData.brands.map(b => b.brand);
    if (brands.includes("Brave")) return "Brave";
    if (brands.includes("Microsoft Edge")) return "Edge";
    return "Chrome";
  }
  return "Chrome"; // Default
}

function getOS() {
  return new Promise((resolve) => {
    chrome.runtime.getPlatformInfo((info) => {
      resolve(info.os || "Unknown");
    });
  });
}