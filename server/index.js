const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const crypto = require("crypto");
const PROTOCOL = require("./constants.js");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PAIR_CODE_TTL_MS = 60 * 1000;
const TRUST_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const RATE_LIMIT_MS = 400;
const CLEANUP_INTERVAL_MS = 30_000;

const hostSessions = new Map();
const pairCodes = new Map();
const remoteIdentities = new Map();

function generateUUID() {
  return crypto.randomUUID();
}

function generatePairCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
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
  return ALL_TYPES.includes(msg.type);
}

setInterval(() => {
  const t = now();
  for (const [code, sessionId] of pairCodes.entries()) {
    const session = hostSessions.get(sessionId);
    if (!session || t > session.pairCodeExpiresAt) {
      pairCodes.delete(code);
      if (session && session.pairCode === code) {
        session.pairCode = null;
        session.pairCodeExpiresAt = 0;
      }
    }
  }

  for (const [token, identity] of remoteIdentities.entries()) {
    if (t > identity.expiresAt || identity.revoked) {
      if (identity.socket && isOpen(identity.socket)) {
        identity.socket.close();
      }
      remoteIdentities.delete(token);
    }
  }

  wss.clients.forEach((ws) => {
    if (!ws.isAlive) {
      cleanupSocket(ws);
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });
}, CLEANUP_INTERVAL_MS);

wss.on("connection", (ws) => {
  ws.isAlive = true;
  ws.role = null;
  ws.sessionId = null;
  ws.remoteIdentityId = null;
  ws.lastSeenAt = 0;

  ws.on("pong", () => (ws.isAlive = true));

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (!isValidMessage(msg)) return;
    if (handleAuth(ws, msg)) return;
    if (ws.sessionId && isRateLimited(ws)) return;

    routeMessage(ws, msg);
  });

  ws.on("close", () => cleanupSocket(ws));
  ws.on("error", () => cleanupSocket(ws));
});

function isRateLimited(ws) {
  const t = now();
  if (t - ws.lastSeenAt < RATE_LIMIT_MS) return true;
  ws.lastSeenAt = t;
  return false;
}

function handleAuth(ws, msg) {
  const t = now();

  if (msg.type === PROTOCOL.SESSION.REGISTER_HOST) {
    const sessionId = generateUUID();
    ws.role = PROTOCOL.ROLE.HOST;
    ws.sessionId = sessionId;

    hostSessions.set(sessionId, {
      socket: ws,
      remotes: new Map(), 
      pairCode: null,
      pairCodeExpiresAt: 0,
    });

    ws.send(JSON.stringify({
      type: PROTOCOL.SESSION.HOST_REGISTERED,
      SESSION_IDENTITY: sessionId,
    }));
    return true;
  }

  if (msg.type === PROTOCOL.SESSION.REQUEST_PAIR_CODE) {
    if (ws.role !== PROTOCOL.ROLE.HOST) return true;

    const session = hostSessions.get(ws.sessionId);
    if (!session) return true;

    if (session.pairCode) pairCodes.delete(session.pairCode);

    const code = generatePairCode();
    session.pairCode = code;
    session.pairCodeExpiresAt = t + PAIR_CODE_TTL_MS;
    pairCodes.set(code, ws.sessionId);

    ws.send(JSON.stringify({
      type: PROTOCOL.SESSION.PAIR_CODE,
      code,
      ttl: PAIR_CODE_TTL_MS,
    }));
    return true;
  }

  if (msg.type === PROTOCOL.SESSION.EXCHANGE_PAIR_CODE) {
    const { code } = msg;

    const sessionId = pairCodes.get(code);
    if (!sessionId) {
      ws.send(JSON.stringify({ type: PROTOCOL.SESSION.PAIR_FAILED }));
      return true;
    }

    pairCodes.delete(code);
    const session = hostSessions.get(sessionId);
    if (!session) {
      ws.send(JSON.stringify({ type: PROTOCOL.SESSION.PAIR_FAILED }));
      return true;
    }

    const trustToken = generateUUID();
    const remoteIdentityId = generateUUID();

    const identity = {
      id: remoteIdentityId,
      sessionId,
      socket: null,
      expiresAt: t + TRUST_TOKEN_TTL_MS,
      revoked: false,
    };

    remoteIdentities.set(trustToken, identity);
    attachRemoteSocket(ws, identity);

    ws.send(JSON.stringify({
      type: PROTOCOL.SESSION.PAIR_SUCCESS,
      trustToken,
      sessionId,
    }));

    return true;
  }

  if (msg.type === PROTOCOL.SESSION.VALIDATE_SESSION) {
    const { trustToken } = msg;
    const identity = remoteIdentities.get(trustToken);

    if (!identity || identity.revoked || t > identity.expiresAt) {
      ws.send(JSON.stringify({ type: PROTOCOL.SESSION.SESSION_INVALID }));
      return true;
    }

    if (!hostSessions.has(identity.sessionId)) {
      ws.send(JSON.stringify({ type: PROTOCOL.SESSION.SESSION_INVALID }));
      return true;
    }

    attachRemoteSocket(ws, identity);

    ws.send(JSON.stringify({
      type: PROTOCOL.SESSION.SESSION_VALID,
      sessionId: identity.sessionId,
    }));

    return true;
  }

  return false;
}

function attachRemoteSocket(ws, identity) {
  if (identity.socket && isOpen(identity.socket)) {
    identity.socket.close();
  }

  identity.socket = ws;

  ws.role = PROTOCOL.ROLE.REMOTE;
  ws.sessionId = identity.sessionId;
  ws.remoteIdentityId = identity.id;

  const session = hostSessions.get(identity.sessionId);
  session.remotes.set(identity.id, identity);

  if (isOpen(session.socket)) {
    session.socket.send(JSON.stringify({
      type: PROTOCOL.SESSION.REMOTE_JOINED,
      remoteId: identity.id,
    }));
  }
}

function routeMessage(ws, msg) {
  const session = hostSessions.get(ws.sessionId);
  if (!session) return;

  if (ws.role === PROTOCOL.ROLE.REMOTE) {

    if (isOpen(session.socket)) {
      session.socket.send(JSON.stringify({
        ...msg,
        remoteId: ws.remoteIdentityId,
      }));
    }
  }

  if (ws.role === PROTOCOL.ROLE.HOST) {
    if (msg.remoteId) {
      const identity = session.remotes.get(msg.remoteId);
      if (identity && identity.socket && isOpen(identity.socket)) {
        identity.socket.send(JSON.stringify(msg));
      }
    } else {
      for (const identity of session.remotes.values()) {
        if (identity.socket && isOpen(identity.socket)) {
          identity.socket.send(JSON.stringify(msg));
        }
      }
    }
  }
}

function cleanupSocket(ws) {
  if (ws.role === PROTOCOL.ROLE.HOST) {
    const session = hostSessions.get(ws.sessionId);
    if (!session) return;

    for (const identity of session.remotes.values()) {
      if (identity.socket && isOpen(identity.socket)) {
        identity.socket.close();
      }
    }

    for (const identity of remoteIdentities.values()) {
      if (identity.sessionId === ws.sessionId) {
        identity.revoked = true;
      }
    }

    hostSessions.delete(ws.sessionId);
  }

  if (ws.role === PROTOCOL.ROLE.REMOTE && ws.remoteIdentityId) {
    for (const identity of remoteIdentities.values()) {
      if (identity.id === ws.remoteIdentityId) {
        identity.socket = null;
      }
    }
  }
}

app.get("/", (_, res) => res.send("Secure Server Running"));
server.listen(3001, () => console.log("🚀 Secure server listening on :3001"));
