import { TRIGGERS, TAB_ACTIVITY, MEDIA_URL_PATTERNS } from "./constants.js"

const hostId = chrome.runtime.id;
let socket = null;
let SESSION_IDENTITY = null
const ACTIVE_TAB = new Map();

function GENERATE_SESSION_IDENTITY() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function GET_SESSION_IDENTITY() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["SESSION_IDENTITY"], (result) => {
      if (result.SESSION_IDENTITY) {
        resolve(result.SESSION_IDENTITY);
      } else {
        const newCode = GENERATE_SESSION_IDENTITY();
        chrome.storage.local.set({ SESSION_IDENTITY: newCode }, () => {
          resolve(newCode);
        });
      }
    });
  });
}


async function GET_MEDIA_TABS() {
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

async function CONNECT_WEBSOCKET() {
  SESSION_IDENTITY = await GET_SESSION_IDENTITY();
  socket = new WebSocket("ws://localhost:3000");

  socket.onopen = () => {
    socket.send(JSON.stringify({
      type: TRIGGERS.REGISTER_HOST,
      SESSION_IDENTITY,
      hostId: hostId
    })
    );
  };

  socket.onmessage = async (event) => {
    let response;
    try {
      response = JSON.parse(event.data);
    } catch {
      return;
    }

    if (!response?.type) return;

    console.log(response)

    if (response.type === TRIGGERS.HOST_REGISTERED) {
      console.log("Pair with the key: ", SESSION_IDENTITY)
    }
    if (response.type === TRIGGERS.REMOTE_JOIN_REQUEST) {
      console.log(response.deviceId)
      socket.send(JSON.stringify({
        type: TRIGGERS.REMOTE_APPROVED,
        deviceId: response.deviceId
      }))
    }
    if (response.type === TRIGGERS.REMOTE_JOINED) {
      const mediaTabs = await GET_MEDIA_TABS();
      socket.send(JSON.stringify({
        type: TRIGGERS.MEDIA_TABS_LIST,
        deviceId: response.deviceId,
        tabs: mediaTabs
      }));
    }
    if (response.type === TRIGGERS.CONTROL_EVENT) {
      const tabId = ACTIVE_TAB.get(response.deviceId);
      if (!tabId) return;
      chrome.tabs.sendMessage(tabId, response);
    }
    if (response.type === TRIGGERS.PAIR_INVALID) {
      console.warn("Pair invalid:", response.reason);
    }
  }

  socket.onclose = () => {
    socket = null;
    setTimeout(CONNECT_WEBSOCKET, 1000);
  };
}

CONNECT_WEBSOCKET();

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === TRIGGERS.STATE_UPDATE) {
    console.log("State update:", msg.state);
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(msg));
    }
  }
  if (msg.type === TRIGGERS.GET_SESSION_IDENTITY) {
    sendResponse({ SESSION_IDENTITY });
    return true;
  }
});

