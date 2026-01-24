const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const { MESSAGE_TYPES } = require("./libs/constants");
const SessionStore = require("./libs/store");
const { handleAuth, routeMessage } = require("./libs/handlers");
const { isValidMessage, isRateLimited } = require("./libs/utils");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const PORT = process.env.PORT || 3000;

// Initialize Store
const store = new SessionStore(wss);

wss.on("connection", (ws) => {
  ws.isAlive = true;
  ws.role = null;
  ws.sessionId = null;
  ws.remoteIdentityId = null;
  ws.lastSeenAt = Date.now();
  ws.trustToken = null;

  ws.on("message", (raw) => {

    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    console.log("[Message]", msg);

    if (!isValidMessage(msg)) return;

    // Auth Handlers (Register, Pair, Validate)
    if (handleAuth(ws, msg, store)) return;

    const session = store.getSession(ws.sessionId);
    if (!session || session.socket !== ws && ws.role === MESSAGE_TYPES.ROLE.HOST) {
      console.warn("[Host Desync] Killing Socket");
      ws.close();
      return;
    }

    if (ws.role === MESSAGE_TYPES.ROLE.REMOTE) {
      const identity = store.getRemote(ws.trustToken);
      if (!identity || identity.socket !== ws) {
        console.warn("[Remote Desync] Killing Socket");
        ws.close();
        return;
      }
    }


    // Rate Limiting
    if (ws.sessionId && isRateLimited(ws)) return;
    // Message Routing
    routeMessage(ws, msg, store);
  });

  ws.on("close", () => {
    if (ws.role === MESSAGE_TYPES.ROLE.HOST) {
      store.handleHostDisconnect(ws);
    }
  });

  ws.on("error", () => {
    if (ws.role === MESSAGE_TYPES.ROLE.HOST) {
      store.handleHostDisconnect(ws);
    }
  });
});

app.get("/", (_, res) => res.send("Secure Server Running"));

if (require.main === module) {
  server.listen(PORT, () => console.log("🚀 Secure server listening on: ", PORT));
}

module.exports = { server, app, wss };