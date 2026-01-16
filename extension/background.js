import { MEDIA_URL_PATTERNS, CHANNELS, SESSION_EVENTS, MEDIA_EVENTS, CONTROL_EVENTS } from "./constants.js";

let sessionIdentity = null;
let connected = false;
const remoteContext = new Map();
const offscreenPath = 'offscreen.html';

function setConnectedState(state) {
  connected = state;
  chrome.action.setBadgeText({ text: state ? "ON" : "" });
  chrome.action.setBadgeBackgroundColor({ color: state ? "#16a34a" : "#64748b" });
}

function onConnected(sessionId, hostToken) {
  sessionIdentity = sessionId;
  setConnectedState(true);
  chrome.storage.local.set({ sessionIdentity, hostToken, connected: true });
}

function onDisconnected() {
  sessionIdentity = null;
  connected = false;
  setConnectedState(false);
  chrome.storage.local.set({ sessionIdentity: null, connected: false });
  remoteContext.clear();
}


function isValidControlAction(action) {
  return action === "TOGGLE_PLAYBACK";
}

async function getMediaTabs() {
  const tabs = await chrome.tabs.query({});
  return tabs
    .filter(tab => tab.url && MEDIA_URL_PATTERNS.some(p => tab.url.includes(p)))
    .map(tab => ({
      tabId: tab.id,
      title: tab.title,
      url: tab.url,
      favIconUrl: tab.favIconUrl || null
    }));
}

// validate tab exists
async function validateTab(tabId) {
  try {
    await chrome.tabs.get(tabId);
    return true;
  } catch {
    return false;
  }
}

// reinject content scripts
async function reinjectContentScripts() {
  const mediaTabs = await getMediaTabs();
  const failedTabs = [];

  for (const tab of mediaTabs) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.tabId },
        files: ["content.js"]
      });
    } catch (err) {
      console.warn(`Failed to reinject into tab ${tab.tabId}:`, err);
      failedTabs.push(tab);
    }
  }

  // Notify popup if any tabs failed
  if (failedTabs.length > 0) {
    chrome.runtime.sendMessage({
      type: "TO_POPUP",
      payload: { type: "REINJECTION_FAILED", failedTabs }
    }).catch(() => { });
  }
}

// Extension Reload Recovery - listeners
chrome.runtime.onStartup.addListener(() => {
  reinjectContentScripts();
});

chrome.runtime.onInstalled.addListener(() => {
  reinjectContentScripts();
});

// cleanup on tab removal
chrome.tabs.onRemoved.addListener((tabId) => {
  for (const [remoteId, ctx] of remoteContext.entries()) {
    if (ctx.tabId === tabId) {
      ctx.tabId = null;
    }
  }
});

// cleanup on navigation
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    for (const [remoteId, ctx] of remoteContext.entries()) {
      if (ctx.tabId === tabId) {
        ctx.tabId = null;
      }
    }
  }
});

chrome.runtime.onMessage.addListener((msg, _, sendResponse) => {
  switch (msg.type) {
    case CHANNELS.FROM_SERVER:
      handleServerMessage(msg.payload);
      break;

    case CHANNELS.FROM_CONTENT_SCRIPT:
      sendToServer(msg.update);
      break;

    case CHANNELS.FROM_POPUP:
      handlePopup(msg.popup, sendResponse);
      return true;
  }
});

async function handleServerMessage(msg) {

  if (!msg?.type) return;
  if (msg.type === "WS_CLOSED") {
    setConnectedState(false);
    return;
  }


  switch (msg.type) {
    case "WS_OPEN": {
      // WebSocket Reconnect Rebind - clear context and rediscover
      remoteContext.clear();

      // Rediscover and notify all content scripts of reconnection
      getMediaTabs().then(tabs => {
        tabs.forEach(tab => {
          chrome.tabs.sendMessage(tab.tabId, {
            type: SESSION_EVENTS.HOST_RECONNECTED
          }).catch(async () => {
            try {
              await chrome.scripting.executeScript({
                target: { tabId: tab.tabId },
                files: ["content.js"]
              });
            } catch { }
          });
        });
      });

      // Reuse existing hostToken for reconnection
      chrome.storage.local.get(["hostToken"], (res) => {
        const hostToken = res.hostToken;
        sendToServer({
          type: SESSION_EVENTS.REGISTER_HOST,
          hostToken: hostToken
        });
      });
      break;
    }

    case SESSION_EVENTS.HOST_REGISTERED: {
      onConnected(msg.SESSION_IDENTITY, msg.hostToken);

      // send tab list to all connected remotes after reconnect
      sendToServer({
        type: MEDIA_EVENTS.MEDIA_TABS_LIST,
        tabs
      });
      break;
    }

    case SESSION_EVENTS.PAIR_CODE: {
      chrome.runtime.sendMessage({
        type: "TO_POPUP",
        payload: { type: "PAIR_CODE_RECEIVED", code: msg.code, ttl: msg.ttl }
      }).catch(() => { });
      break;
    }

    case SESSION_EVENTS.REMOTE_JOINED: {
      remoteContext.delete(msg.remoteId);
      remoteContext.set(msg.remoteId, { tabId: null });
      const tabs = await getMediaTabs()
      sendToServer({
        type: MEDIA_EVENTS.MEDIA_TABS_LIST,
        remoteId: msg.remoteId,
        tabs
      })
      break;
    }

    case MEDIA_EVENTS.SELECT_ACTIVE_TAB: {
      const ctx = remoteContext.get(msg.remoteId);
      if (!ctx) return;

      const tab = await validateTab(msg.tabId);
      if (!tab) return;

      ctx.tabId = msg.tabId;

      break;
    }
    case CONTROL_EVENTS.CONTROL_EVENT: {
      if (!isValidControlAction(msg.action)) return;

      const ctx = remoteContext.get(msg.remoteId);
      if (!ctx?.tabId) return;

      // validate before sending
      const isValid = await validateTab(ctx.tabId);
      if (!isValid) {
        console.warn(`Tab ${ctx.tabId} no longer exists, clearing context`);
        ctx.tabId = null;
        return;
      }

      try {
        await chrome.tabs.sendMessage(ctx.tabId, {
          type: CONTROL_EVENTS.CONTROL_EVENT,
          action: msg.action
        });
      } catch (err) {
        console.warn(`Failed to send message to tab ${ctx.tabId}:`, err);
        ctx.tabId = null; // Clear stale reference
      }
      break;
    }
    case SESSION_EVENTS.HOST_DISCONNECTED: {
      resetSession("host_disconnected");
      break;
    }

    case SESSION_EVENTS.PAIR_INVALID: {
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

  if (req.type === "POPUP_REQUEST_CODE") {
    sendToServer({ type: SESSION_EVENTS.REQUEST_PAIR_CODE });
    sendResponse({ ok: true });
    return;
  }

  if (req.type === "POPUP_DISCONNECT") {
    // Disconnect - notify server about force-close WS
    sendToServer({ type: SESSION_EVENTS.HOST_DISCONNECT });

    // Force-close WebSocket in offscreen
    chrome.runtime.sendMessage({ type: CHANNELS.DISCONNECT_WS }).catch(() => { });

    onDisconnected();
    sendResponse({ ok: true });
    return;
  }
}

async function sendToServer(payload) {
  await ensureOffscreen();
  chrome.runtime.sendMessage({
    type: CHANNELS.FROM_BACKGROUND,
    payload
  }).catch(console.warn);
}

async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;

  await chrome.offscreen.createDocument({
    url: offscreenPath,
    reasons: ["BLOBS"],
    justification: "Persistent WebSocket connection"
  });
}

function resetSession(reason = "unknown") {
  console.warn("Session reset:", reason);
  onDisconnected();
  remoteContext.clear();
}


ensureOffscreen();