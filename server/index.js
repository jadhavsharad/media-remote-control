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
const hostTokenMap = new Map();

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

const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 Hours

let cleanupInterval;

function startCleanup() {

  cleanupInterval = setInterval(() => {
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

    for (const [sessionId, session] of hostSessions.entries()) {
      if (!session.socket && session.hostDisconnectedAt && (t - session.hostDisconnectedAt > SESSION_TTL_MS)) {
        console.log(`[CLEANUP] Removing abandoned session ${sessionId}`);
        for (const identity of session.remotes.values()) {
          if (identity.socket && isOpen(identity.socket)) {
            identity.socket.close();
          }
          if (identity.trustToken) {
            remoteIdentities.delete(identity.trustToken);
          }
        }
        hostSessions.delete(sessionId);
        if (session.hostToken) {
          hostTokenMap.delete(session.hostToken);
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
}

startCleanup();

wss.on("connection", (ws) => {
  ws.isAlive = true;
  ws.role = null;
  ws.sessionId = null;
  ws.remoteIdentityId = null;
  ws.lastSeenAt = 0;
  ws.trustToken = null;

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
    if (ws.role === PROTOCOL.ROLE.REMOTE) {
      console.warn("Security: Remote attempted to register as Host. Terminating.");
      ws.terminate();
      return true;
    }
    const existingHostToken = msg.hostToken;
    let session = null;
    let sessionId = null;
    let hostToken = null;

    if (existingHostToken) {
      sessionId = hostTokenMap.get(existingHostToken);
      if (sessionId) {
        session = hostSessions.get(sessionId);
      }

      if (session) {
        console.log(`[RECOVERY] Host re-connected to session ${sessionId}`);
        if (session.socket && isOpen(session.socket) && session.socket !== ws) {
          console.warn(`[RECOVERY] Closing old ghost socket for session ${sessionId}`);
          session.socket.close();
        }

        session.socket = ws;
        session.hostDisconnectedAt = null;
        hostToken = existingHostToken;
      } else {
        console.warn("[RECOVERY] Invalid hostToken, creating new session");
      }
    }

    if (!session) {
      sessionId = generateUUID();
      hostToken = generateUUID();
      console.log(`[NEW] Created new host session ${sessionId}`);

      session = {
        socket: ws,
        hostToken,
        remotes: new Map(),
        pairCode: null,
        pairCodeExpiresAt: 0,
        hostDisconnectedAt: null
      };
      hostSessions.set(sessionId, session);
      hostTokenMap.set(hostToken, sessionId);
    }

    ws.role = PROTOCOL.ROLE.HOST;
    ws.sessionId = sessionId;

    ws.send(JSON.stringify({
      type: PROTOCOL.SESSION.HOST_REGISTERED,
      SESSION_IDENTITY: sessionId,
      hostToken: hostToken
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
      trustToken,
    };

    remoteIdentities.set(trustToken, identity);
    attachRemoteSocket(ws, identity, trustToken);

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

    attachRemoteSocket(ws, identity, trustToken);

    ws.send(JSON.stringify({
      type: PROTOCOL.SESSION.SESSION_VALID,
      sessionId: identity.sessionId,
    }));

    return true;
  }

  return false;
}

function attachRemoteSocket(ws, identity, trustToken) {
  if (identity.socket && isOpen(identity.socket)) {
    identity.socket.close();
  }

  identity.socket = ws;

  ws.role = PROTOCOL.ROLE.REMOTE;
  ws.sessionId = identity.sessionId;
  ws.remoteIdentityId = identity.id;
  ws.trustToken = trustToken;

  const session = hostSessions.get(identity.sessionId);
  session.remotes.set(identity.id, identity);

  if (session.socket && isOpen(session.socket)) {
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
    if (!isValidMessage(msg)) return;

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
      if (identity && identity.socket) {
        safeSend(identity.socket, msg);
      }
    } else {
      for (const identity of session.remotes.values()) {
        if (identity.socket) safeSend(identity.socket, msg);
      }
    }
  }
}

function safeSend(ws, payload) {
  try {
    if (isOpen(ws)) {
      ws.send(JSON.stringify(payload));
    }
  } catch (e) {
    console.error("[WS_SEND_ERROR]", e);
  }
}

function cleanupSocket(ws) {
  if (ws.role === PROTOCOL.ROLE.HOST) {
    const session = hostSessions.get(ws.sessionId);
    if (!session) return;

    console.log(`[DISCONNECT] Host disconnected from session ${ws.sessionId}`);

    if (session.socket === ws) {
      session.socket = null;
      session.hostDisconnectedAt = now();
    }

    for (const identity of session.remotes.values()) {
      if (identity.socket && isOpen(identity.socket)) {
        identity.socket.send(JSON.stringify({
          type: PROTOCOL.SESSION.HOST_DISCONNECTED
        }));
      }
    }

  }

  if (ws.role === PROTOCOL.ROLE.REMOTE && ws.trustToken) {
    const identity = remoteIdentities.get(ws.trustToken);
    if (identity && identity.socket === ws) {
      identity.socket = null;
    }
  } else if (ws.role === PROTOCOL.ROLE.REMOTE && !ws.trustToken) {
    // Fallback if somehow trustToken is missing but this shouldn't happen with new logic
    // Keeping this empty or basic logging is fine.
  }
}

app.get("/", (_, res) => res.send("Secure Server Running"));

if (require.main === module) {
  server.listen(3001, () => console.log("🚀 Secure server listening on :3001"));
}

module.exports = {
  server,
  app,
  wss,
  stopCleanup: () => clearInterval(cleanupInterval)
};
