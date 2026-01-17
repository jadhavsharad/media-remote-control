import { TRIGGERS, CHANNELS } from "./constants.js";


let socket = null;
let reconnect = null;
let userDisconnected = false; // Prevents auto-reconnect after user disconnect
const WS_URL = "wss://media-remote-control-service.onrender.com";

function connect() {
    socket = new WebSocket(WS_URL);

    socket.onopen = () => {
        userDisconnected = false; // Clear flag on successful connection
        chrome.runtime.sendMessage({
            type: TRIGGERS.FROM_SERVER,
            payload: { type: "WS_OPEN" }
        });
    };

    socket.onmessage = (event) => {
        try {
            chrome.runtime.sendMessage({ type: TRIGGERS.FROM_SERVER, payload: JSON.parse(event.data) });
        } catch (e) {
            console.error("Parse error", e);
        }
    };

    socket.onclose = () => {
        chrome.runtime.sendMessage({ type: TRIGGERS.FROM_SERVER, payload: { type: "WS_CLOSED" } });
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
    // Handle forced disconnect command
    if (msg.type === CHANNELS.DISCONNECT_WS) {
        userDisconnected = true;
        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.close();
        }
        return;
    }

    // Handle forced connect command
    if (msg.type === CHANNELS.CONNECT_WS) {
        userDisconnected = false;
        if (!isOpen()) {
            connect();
        }
        return;
    }

    // Handle normal server messages
    if (msg.type !== TRIGGERS.FROM_BACKGROUND) return;
    if (!isOpen()) return;


    socket.send(JSON.stringify(msg.payload));
});


function isOpen() {
    return socket && socket.readyState === WebSocket.OPEN;
}
