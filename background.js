import { TRIGGERS, MEDIA_URL_PATTERNS } from "./constants.js";


let socket = null;
let SESSION_IDENTITY = null;
const REMOTE_CONTEXT = new Map();
let connected = false;

function setConnectedState(state) {
  connected = state;
  chrome.action.setBadgeText({
    text: state ? "ON" : ""
  });
  chrome.action.setBadgeBackgroundColor({
    color: state ? "#16a34a" : "#64748b"
  });
}

function onConnected(sessionId) {
  setConnectedState(true);
  SESSION_IDENTITY = sessionId;
}

function onDisconnected() {
  setConnectedState(false);
  SESSION_IDENTITY = null;
}

chrome.runtime.onMessage.addListener((msg, _, sendResponse) => {
  if (msg.type === "POPUP_GET_STATUS") {
    sendResponse({
      connected,
      sessionIdentity: SESSION_IDENTITY
    });
    return true;
  }

  if (msg.type === "POPUP_DISCONNECT") {
    if (socket) socket.close();
    onDisconnected();
    sendResponse({ ok: true });
    return true;
  }
});


function isValidControlAction(action) {
  return action === "TOGGLE_PLAYBACK";
}

async function getMediaTabs() {
  const tabs = await chrome.tabs.query({});
  return tabs
    .filter(tab =>
      tab.url &&
      MEDIA_URL_PATTERNS.some(p => tab.url.includes(p))
    )
    .map(tab => ({
      tabId: tab.id,
      title: tab.title,
      url: tab.url,
      favIconUrl: tab.favIconUrl || null
    }));
}


function connectWebSocket() {
  socket = new WebSocket("ws://localhost:3001");

  socket.onopen = () => {
    socket.send(JSON.stringify({
      type: TRIGGERS.REGISTER_HOST
    }));
  };

  socket.onmessage = async (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }

    if (!msg?.type) return;

    switch (msg.type) {

      case TRIGGERS.HOST_REGISTERED: {
        onConnected(msg.SESSION_IDENTITY);
        chrome.storage.local.set({ SESSION_IDENTITY: msg.SESSION_IDENTITY });
        break;
      }


      case TRIGGERS.REMOTE_JOINED: {
        const { remoteId } = msg;
        REMOTE_CONTEXT.set(remoteId, { tabId: null });

        const tabs = await getMediaTabs();
        socket.send(JSON.stringify({
          type: TRIGGERS.MEDIA_TABS_LIST,
          remoteId,
          tabs
        }));
        break;
      }

      case TRIGGERS.SELECT_ACTIVE_TAB: {
        const { remoteId, tabId } = msg;
        if (!REMOTE_CONTEXT.has(remoteId)) return;

        const tab = await chrome.tabs.get(tabId).catch(() => null);
        if (!tab) return;

        REMOTE_CONTEXT.get(remoteId).tabId = tabId;
        break;
      }

      case TRIGGERS.CONTROL_EVENT: {
        const { remoteId, action } = msg;
        if (!isValidControlAction(action)) return;

        const ctx = REMOTE_CONTEXT.get(remoteId);
        if (!ctx?.tabId) return;

        chrome.tabs.sendMessage(ctx.tabId, {
          type: TRIGGERS.CONTROL_EVENT,
          action
        });
        break;
      }

      case TRIGGERS.PAIR_INVALID: {
        REMOTE_CONTEXT.clear();
        SESSION_IDENTITY = null;
        break;
      }

    }
  };

  socket.onclose = () => {
    socket = null;
    onDisconnected();
    REMOTE_CONTEXT.clear();
    setTimeout(connectWebSocket, 1000);
  };
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== TRIGGERS.STATE_UPDATE) return;

  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(msg));
  }
});

connectWebSocket();
