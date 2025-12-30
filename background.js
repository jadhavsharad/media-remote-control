
let webSocket = null;

const pairCode = Math.random().toString(36).slice(2, 8).toUpperCase();
console.log("🔑 Pair code:", pairCode);

function connect() {
  webSocket = new WebSocket('ws://localhost:3000');

  webSocket.onopen = () => {
    webSocket.send(
      JSON.stringify({
        type: "PAIR",
        pairCode
      })
    );
  };

  webSocket.onmessage = (event) => {
    console.log(`websocket received message: ${event.data}`);
    forwardToTab(JSON.parse(event.data));
  };

  webSocket.onclose = (event) => {
    console.log('websocket connection closed');
    webSocket = null;
  };
}

function disconnect() {
  if (webSocket == null) {
    return;
  }
  webSocket.close();
}

connect();

chrome.runtime.onMessage.addListener((msg) => {
  console.log("Background received message: ", msg);
  if (msg.type === "STATE_UPDATE") {
    if (webSocket && webSocket.readyState === WebSocket.OPEN) {
      webSocket.send(JSON.stringify(msg));
    }
  }

  forwardToTab(msg);
});


const forwardToTab = (msg) => {
  if (!isAllowed(msg)) return;
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs.length) return;
    chrome.tabs.sendMessage(tabs[0].id, msg);
  });
}

function isAllowed(msg) {
  console.log("isAllowed check for message: ", msg);
  return msg.action === "TOGGLE_PLAYBACK";
}
