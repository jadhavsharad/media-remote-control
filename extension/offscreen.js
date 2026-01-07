import { TRIGGERS } from "./constants.js";


let socket = null;
let reconnect = null;
const WS_URL = "ws://localhost:3001";

function connect() {
    socket = new WebSocket(WS_URL);

    socket.onopen = () => {
        socket.send(JSON.stringify({ type: TRIGGERS.REGISTER_HOST }));
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
        reconnect = setTimeout(connect, 2000);
    };

    socket.onerror = (err) => {
        console.error("Offscreen: WS Error", err);
        socket.close();
    };
}


connect();

chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type !== TRIGGERS.FROM_BACKGROUND) return;
    if (!isOpen()) return;
    
    console.log("This is the payload that will be sent. ", msg.payload)
    socket.send(JSON.stringify(msg.payload));
});


function isOpen() {
    return socket && socket.readyState === WebSocket.OPEN;
}
