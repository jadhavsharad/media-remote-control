
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
  // state coming from content script
  console.log("Background received message: ", msg);
  if (msg.type === "STATE_UPDATE") {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
    return;
  }

  forwardToTab(msg);
});


const forwardToTab = (msg) => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    console.log(tabs)
    chrome.tabs.sendMessage(tabs[0].id, msg, () => {
      if (chrome.runtime.lastError) {
        console.log("❌ No content script to notify about tab update");
      }
    })
  });
}