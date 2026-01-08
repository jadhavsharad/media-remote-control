const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const crypto = require("crypto");
const PROTOCOL = require("./constants.js");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PAIR_TTL_MS = 5 * 60 * 1000;
const RATE_LIMIT_MS = 400;

const sessions = new Map();

function generateSessionId() {
  return crypto.randomUUID();
}

function generateRemoteId() {
  return crypto.randomUUID();
}

function now() {
  return Date.now();
}

function isOpen(ws) {
  return ws.readyState === WebSocket.OPEN;
}

function isValidMessage(msg) {
  if (!msg || typeof msg !== "object") return false;

  const ALL_TYPES = [
    ...Object.values(PROTOCOL.SESSION),
    ...Object.values(PROTOCOL.CONTROL),
    ...Object.values(PROTOCOL.MEDIA),
  ];

  if (!ALL_TYPES.includes(msg.type)) return false;
  return true;
}

setInterval(() => {
  const t = now();
  for (const [id, session] of sessions.entries()) {
    if (t > session.expiresAt) {
      session.remotes.forEach(r => {
        if (isOpen(r.socket)) {
          r.socket.send(JSON.stringify({
            type: PROTOCOL.SESSION.PAIR_INVALID,
            reason: "SESSION_EXPIRED"
          }));
          r.socket.close();
        }
      });
      if (isOpen(session.host.socket)) {
        session.host.socket.close();
      }
      sessions.delete(id);
    }
  }
}, 30_000);

wss.on("connection", (ws) => {
  ws.role = null;
  ws.sessionId = null;
  ws.remoteId = null;
  ws.lastSeenAt = 0;

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (!isValidMessage(msg)) return;
    if (handlePairing(ws, msg)) return;
    if (!ws.sessionId) return;
    if (isRateLimited(ws)) return;

    routeMessage(ws, msg);
  });

  ws.on("close", () => cleanupSocket(ws));
});

function isRateLimited(ws) {
  const t = now();
  if (t - ws.lastSeenAt < RATE_LIMIT_MS) return true;
  ws.lastSeenAt = t;
  return false;
}

function handlePairing(ws, msg) {
  const t = now();

  if (msg.type === PROTOCOL.SESSION.REGISTER_HOST) {
    const sessionId = generateSessionId();
    ws.role = PROTOCOL.ROLE.HOST;
    ws.sessionId = sessionId;

    sessions.set(sessionId, {
      host: { socket: ws },
      remotes: new Map(),
      expiresAt: t + PAIR_TTL_MS
    });

    ws.send(JSON.stringify({
      type: PROTOCOL.SESSION.HOST_REGISTERED,
      SESSION_IDENTITY: sessionId
    }));
    return true;
  }

  if (msg.type === PROTOCOL.SESSION.JOIN_PAIR) {
    const session = sessions.get(msg.SESSION_IDENTITY);
    if (!session || t > session.expiresAt) {
      ws.send(JSON.stringify({ type: PROTOCOL.SESSION.PAIR_INVALID }));
      ws.close();
      return true;
    }

    const remoteId = generateRemoteId();
    ws.role = PROTOCOL.ROLE.REMOTE;
    ws.sessionId = msg.SESSION_IDENTITY;
    ws.remoteId = remoteId;

    session.remotes.set(remoteId, { socket: ws });
    session.expiresAt = t + PAIR_TTL_MS;

    ws.send(JSON.stringify({
      type: PROTOCOL.SESSION.PAIR_JOINED,
      remoteId
    }));

    if (isOpen(session.host.socket)) {
      session.host.socket.send(JSON.stringify({
        type: PROTOCOL.SESSION.REMOTE_JOINED,
        remoteId
      }));
    }
    return true;
  }

  return false;
}

function routeMessage(ws, msg) {
  const session = sessions.get(ws.sessionId);
  if (!session) return;

  session.expiresAt = now() + PAIR_TTL_MS;

  if (
    ws.role === PROTOCOL.ROLE.REMOTE &&
    msg.type === PROTOCOL.CONTROL.EVENT
  ) {
    if (isOpen(session.host.socket)) {
      session.host.socket.send(JSON.stringify({
        ...msg,
        remoteId: ws.remoteId
      }));
    }
  }

  if (
    ws.role === PROTOCOL.ROLE.HOST &&
    msg.type === PROTOCOL.CONTROL.STATE_UPDATE
  ) {
    session.remotes.forEach(r => {
      if (isOpen(r.socket)) {
        r.socket.send(JSON.stringify(msg));
      }
    });
  }

  if (
    ws.role === PROTOCOL.ROLE.HOST &&
    msg.type === PROTOCOL.MEDIA.TABS_LIST
  ) {
    const remote = session.remotes.get(msg.remoteId);
    remote.socket.send(JSON.stringify(msg));
  }

  if (
    msg.type === PROTOCOL.MEDIA.SELECT_ACTIVE_TAB &&
    ws.role === PROTOCOL.ROLE.REMOTE
  ) {
    if (isOpen(session.host.socket)) {
      session.host.socket.send(JSON.stringify({
        ...msg,
        remoteId: ws.remoteId
      }));
    }
  }
}

function cleanupSocket(ws) {
  if (!ws.sessionId) return;
  const session = sessions.get(ws.sessionId);
  if (!session) return;

  if (ws.role === PROTOCOL.ROLE.HOST) {
    session.remotes.forEach(r => r.socket.close());
    sessions.delete(ws.sessionId);
    return;
  }

  if (ws.role === PROTOCOL.ROLE.REMOTE) {
    session.remotes.delete(ws.remoteId);
  }
}

app.get("/", (_, res) => res.send("Server running"));

server.listen(3001, () => {
  console.log("🚀 Secure server listening on :3001");
});
