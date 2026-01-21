
import { MESSAGE_TYPES, CHANNELS, BASE_DOMAINS, MEDIA_STATE } from "./libs/constants.js";
import { log } from "./libs/log.js";

let connected = false;
let sessionIdentity = null;
let hostToken = null;
const remoteContext = new Map();
const offscreenPath = 'offscreen.html';

onStart(injectContentScript)
onInstall(injectContentScript)
onTabRemoved((tabId) => { clearTabContext(tabId); refreshMediaList(); });
onTabUpdated((tabId) => { clearTabContext(tabId); refreshMediaList(); });
const refreshMediaList = debouncedScheduler(() => sendMediaList());
onTabCreated(refreshMediaList)

async function validateTab(tabId) {
  try {
    await chrome.tabs.get(tabId);
    return true;
  } catch {
    return false;
  }
}
// Connection management
function setConnectionState(state) {
  connected = state;
  chrome.action.setBadgeText({ text: state ? "ON" : "" });
  chrome.action.setBadgeBackgroundColor({ color: state ? "#16a34a" : "#64748b" });
}

function onConnected(newSessionIdentity, newHostToken) {
  sessionIdentity = newSessionIdentity;
  hostToken = newHostToken;
  setConnectionState(true)
  chrome.storage.local.set({ sessionIdentity, hostToken, connected });
}

function onDisconnected() {
  connected = false;
}

function onDestroy() {
  connected = false;
  sessionIdentity = null;
  hostToken = null;
  remoteContext.clear();
  chrome.storage.local.set({ sessionIdentity: null, hostToken: null, connected });
}

// // validate Message exists
function isValidMessageType(type) {
  return Object.values(MESSAGE_TYPES).includes(type);
}

receiveMessage(CHANNELS.FROM_SERVER, (payload) => {
  handleServerMessage(payload);
})

receiveMessage(CHANNELS.FROM_CONTENT_SCRIPT, (payload) => {
  if (!isValidMessageType(payload.type)) return;

  if (payload.type === MESSAGE_TYPES.STATE_UPDATE && payload.intent === MESSAGE_TYPES.INTENT.REPORT) {
    sendToServer(payload);
  }
})

receiveMessage(CHANNELS.FROM_POPUP, (payload, sendResponse) => {
  handlePopup(payload, sendResponse);
  return true;
})



async function handleServerMessage(msg) {
  if (!msg?.type) return;

  if (msg.type === "WS_CLOSED") {
    setConnectionState(false);
    return;
  }


  switch (msg.type) {
    case "WS_OPEN": {

      // Rediscover and notify all content scripts of reconnection
      getMediaList().then(tabs => {
        tabs.forEach(tab => {
          chrome.tabs.sendMessage(tab.tabId, {
            type: MESSAGE_TYPES.HOST_RECONNECT
          }).catch(async () => {
            try {
              await executeScript(tab.tabId)
            } catch {
              log("Failed to reinject into tab " + tab.tabId)
            }
          });
        });
      });

      const os = await getOS();
      const browser = getBrowser();

      // Reuse existing hostToken for reconnection
      chrome.storage.local.get(["hostToken"], (res) => {
        const hostToken = res.hostToken;
        sendToServer({
          type: MESSAGE_TYPES.HOST_REGISTER,
          hostToken: hostToken,
          info: {
            os,
            browser
          }
        });
      });
      break;
    }

    case MESSAGE_TYPES.HOST_REGISTERED: {
      onConnected(msg.SESSION_IDENTITY, msg.hostToken);
      sendMediaList();
      break;
    }

    case MESSAGE_TYPES.PAIRING_KEY: {
      chrome.runtime.sendMessage({
        type: CHANNELS.TO_POPUP,
        payload: { type: MESSAGE_TYPES.PAIRING_KEY, code: msg.code, ttl: msg.ttl }
      }).catch(() => { });
      break;
    }

    case MESSAGE_TYPES.REMOTE_JOINED: {
      remoteContext.delete(msg.remoteId);
      remoteContext.set(msg.remoteId, { tabId: null });
      sendMediaList({ remoteId: msg.remoteId });
      break;
    }

    case MESSAGE_TYPES.SELECT_ACTIVE_TAB: {
      const ctx = remoteContext.get(msg.remoteId);
      if (!ctx) return;

      const tab = await validateTab(msg.tabId);
      if (!tab) return;

      ctx.tabId = msg.tabId;

      break;
    }
    case MESSAGE_TYPES.STATE_UPDATE: {
      if (msg.intent !== MESSAGE_TYPES.INTENT.SET) return;

      const ctx = remoteContext.get(msg.remoteId);
      if (!ctx?.tabId) return;

      if (ctx.tabId !== msg.tabId) {
        console.warn("Remote attempted cross-tab control");
        return;
      }

      // validate before sending
      const isValid = await validateTab(ctx.tabId);

      if (!isValid) {
        console.warn(`Tab ${ctx.tabId} no longer exists, clearing context`);
        ctx.tabId = null;
        return;
      }

      try {
        await handleControlEvent(ctx, msg);
      } catch (err) {
        console.warn(`Failed to send message to tab ${ctx.tabId}:`, err);
        ctx.tabId = null; // Clear stale reference
      }
      break;
    }
    case MESSAGE_TYPES.HOST_DISCONNECTED: {
      resetSession("host_disconnected");
      break;
    }

    case MESSAGE_TYPES.PAIRING_KEY_VALID: {
      remoteContext.clear();
      break;
    }
  }
}

function handlePopup(req, sendResponse) {
  if (req.type === "POPUP_GET_STATUS") {
    chrome.storage.local.get(["sessionIdentity", "connected"], res => {
      sendResponse(res);
    });
    return;
  }

  if (req.type === MESSAGE_TYPES.PAIRING_KEY_REQUEST) {
    sendToServer({ type: MESSAGE_TYPES.PAIRING_KEY_REQUEST });
    sendResponse({ ok: true });
    return;
  }

  if (req.type === MESSAGE_TYPES.HOST_DISCONNECT) {
    // Disconnect - notify server about force-close WS
    sendToServer({ type: MESSAGE_TYPES.HOST_DISCONNECT });

    // Force-close WebSocket in offscreen
    chrome.runtime.sendMessage({ type: MESSAGE_TYPES.HOST_DISCONNECT }).catch(() => { });
    onDisconnected();
    sendResponse({ ok: true });
    return;
  }

  if (req.type === MESSAGE_TYPES.HOST_RECONNECT) {
    // Force-connect WebSocket in offscreen
    chrome.runtime.sendMessage({ type: MESSAGE_TYPES.HOST_RECONNECT }).catch(() => { });
    sendResponse({ ok: true });
    return;
  }
}


// Offscreen document
async function startOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  await chrome.offscreen.createDocument({
    url: offscreenPath,
    reasons: ["BLOBS"],
    justification: "Persistent WebSocket connection",
  });
}

// Browser Detection
function getBrowser() {
  const brands = navigator.userAgentData?.brands?.map(b => b.brand) ?? [];
  if (brands.includes("Microsoft Edge")) return "Edge";
  if (brands.includes("Brave")) return "Brave";
  if (brands.includes("Google Chrome")) return "Chrome";
  if (brands.includes("Chromium")) return "Chromium";
  return "Unknown";
}

// OS Detection
function getOS() {
  return new Promise((resolve) => {
    chrome.runtime.getPlatformInfo((info) => {
      const osMap = {
        mac: "macOS",
        win: "Windows",
        linux: "Linux",
        cros: "ChromeOS",
        android: "Android",
        openbsd: "OpenBSD",
      };
      resolve(osMap[info.os] ?? "Unknown");
    });
  });
}


async function getTab(ctx) {
  if (!ctx.tabId) throw new Error("No tab");

  try {
    return await chrome.tabs.get(ctx.tabId);
  } catch {
    ctx.tabId = null;
    throw new Error("Tab not found");
  }
}

async function handleControlEvent(ctx, msg) {
  if (!ctx.tabId) return;
  if (msg.intent !== MESSAGE_TYPES.INTENT.SET) return;

  switch (msg.key) {
    case MEDIA_STATE.MUTE:
      await chrome.tabs.update(ctx.tabId, { muted: msg.value });
      break;

    case MEDIA_STATE.PLAYBACK:
      await chrome.tabs.sendMessage(ctx.tabId, {
        type: MESSAGE_TYPES.STATE_UPDATE,
        intent: MESSAGE_TYPES.INTENT.SET,
        key: MEDIA_STATE.PLAYBACK,
        value: msg.value
      });
      break;

    case MEDIA_STATE.TIME:
      await chrome.tabs.sendMessage(ctx.tabId, {
        type: MESSAGE_TYPES.STATE_UPDATE,
        intent: MESSAGE_TYPES.INTENT.SET,
        key: MEDIA_STATE.TIME,
        value: msg.value
      });
      break;
  }
}

async function sendToServer(payload) {
  await startOffscreen();
  await sendMessage(CHANNELS.FROM_BACKGROUND, payload);
}

// Messaging
async function sendMessage(channel, payload) {
  try {
    await chrome.runtime.sendMessage({ type: channel, payload });
  } catch (e) {
    log("[BACKGROUND SENDING ERROR]: ", e)
  }
}

function receiveMessage(channel, handler) {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

    // 1. Must be a message for this channel
    if (!msg || msg.type !== channel) return false;

    // 2. Must come from THIS extension
    if (sender.id !== chrome.runtime.id) {
      console.warn("Blocked foreign extension message", sender.id);
      return false;
    }

    // 3. Content-script channel must come from a real tab
    if (channel === CHANNELS.FROM_CONTENT_SCRIPT) {
      if (!sender.tab || typeof sender.tab.id !== "number") {
        console.warn("Blocked forged content-script message", msg);
        return false;
      }
    }

    // 4. Payload must exist
    if (!msg.payload || typeof msg.payload !== "object") {
      console.warn("Blocked malformed payload", msg);
      return false;
    }

    // 5. Remote must exist
    if (!remoteContext.has(msg.remoteId)) {
      console.warn("Unknown remote blocked");
      return;
    }

    // 6. Dispatch
    const result = handler(msg.payload, sendResponse); // Return true to keep channel open if async

    if (result === true) return true;

    return false;
  });
}

// Tabs & media
function isMediaUrl(url) {
  if (!url) return false;
  try {
    const { hostname } = new URL(url);
    return BASE_DOMAINS.some(domain => hostname === domain || hostname.includes(`.${domain}`));
  } catch {
    return false;
  }
}

async function getMediaList() {
  const tabs = await chrome.tabs.query({});
  return tabs
    .filter(tab => isMediaUrl(tab.url))
    .map(tab => ({
      tabId: tab.id,
      title: tab.title ?? "",
      url: tab.url,
      favIconUrl: tab.favIconUrl ?? null,
      muted: tab.mutedInfo?.muted ?? false,
    }));
}

async function sendMediaList(extra = {}) {
  const tabs = await getMediaList();
  const payload = { type: MESSAGE_TYPES.MEDIA_LIST, tabs, ...extra }
  sendMessage(CHANNELS.FROM_BACKGROUND, payload)
}

// Debounce
function debouncedScheduler(fn, delay = 300) {
  let timer = null;
  return () => {
    if (timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      fn().catch(e => console.warn("Scheduled task failed", e));
    }, delay);
  };
}

// Lifecycle hooks
function onStart(fn) {
  chrome.runtime.onStartup.addListener(fn);
}

function onInstall(fn) {
  chrome.runtime.onInstalled.addListener(fn);
}

function onTabCreated(fn) {
  chrome.tabs.onCreated.addListener(() => void fn());
}

function onTabRemoved(fn) {
  chrome.tabs.onRemoved.addListener((tabId) => void fn(tabId));
}

function onTabUpdated(fn) {
  chrome.tabs.onUpdated.addListener((tabId) => void fn(tabId));
}

// Script injection
async function executeScript(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content.js"],
    injectImmediately: true
  });
}

async function injectContentScript() {
  const mediaTabs = await getMediaList();
  const failedTabs = [];

  for (const tab of mediaTabs) {
    try {
      await executeScript(tab.tabId);
    } catch (err) {
      warn(`Failed to inject into tab ${tab.tabId}: ${err}`);
      failedTabs.push(tab);
    }
  }

  if (failedTabs.length > 0) {
    sendMessage(CHANNELS.TO_POPUP, {
      type: MESSAGE_TYPES.SCRIPT_INJECTION_FAIL,
      failedTabs,
    });
  }
}

function clearTabContext(tabId) {
  for (const ctx of remoteContext.values()) {
    if (ctx.tabId === tabId) {
      ctx.tabId = null;
    }
  }
}

startOffscreen();
