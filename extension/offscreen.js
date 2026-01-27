import { CHANNELS, MESSAGE_TYPES } from "./libs/constants.js";



let socket = null;
let reconnect = null;
let userDisconnected = false; // Prevents auto-reconnect after user disconnect
const WS_URL = "ws://localhost:3000";

function connect() {
    socket = new WebSocket(WS_URL);

    socket.onopen = () => {
        userDisconnected = false;
        chrome.runtime.sendMessage({
            type: CHANNELS.FROM_SERVER,
            payload: { type: "WS_OPEN" }
        });
    };

    socket.onmessage = (event) => {
        try {
            chrome.runtime.sendMessage({ type: CHANNELS.FROM_SERVER, payload: JSON.parse(event.data) });
        } catch (e) {
            console.error("Parse error", e);
        }
    };

    socket.onclose = () => {
        chrome.runtime.sendMessage({ type: CHANNELS.FROM_SERVER, payload: { type: "WS_CLOSED" } });
        socket = null;
        clearTimeout(reconnect);

        // Only auto-reconnect if not a user-initiated disconnect
        if (!userDisconnected) {
            reconnect = setTimeout(connect, 2000);
        }
    };

    socket.onerror = (err) => {
        console.error("Offscreen: WS Error", err);
        socket.close();
    };
}
connect();
chrome.runtime.onMessage.addListener((msg) => {
    
    if (msg.payload.type === MESSAGE_TYPES.HOST_DISCONNECT) {
        userDisconnected = true;
        if (isOpen()) socket.close();
    }
    
    if (msg.payload.type === MESSAGE_TYPES.HOST_RECONNECT) {
        userDisconnected = false;
        if (!isOpen()) connect();
    }
        if (msg.type !== CHANNELS.FROM_BACKGROUND)  return;
        if (!isOpen()) return;


    socket.send(JSON.stringify(msg.payload));
});


function isOpen() {
    return socket && socket.readyState === WebSocket.OPEN;
}

