const { MESSAGE_TYPES } = require("./constants");
const { now, isOpen, safeSend } = require("./utils");

const PAIR_CODE_TTL_MS = 60 * 1000;
const TRUST_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 30_000;

class SessionStore {
  constructor(wss) {
    this.wss = wss;
    this.hostSessions = new Map();     // sessionId -> Session
    this.pairCodes = new Map();        // code -> sessionId
    this.remoteIdentities = new Map(); // trustToken -> Identity
    this.hostTokenMap = new Map();     // hostToken -> sessionId

    this.startCleanup();
  }

  createSession(id, hostToken, ws, info) {
    const session = {
      socket: ws,
      hostOS: info?.os,
      hostBrowser: info?.browser,
      hostToken: hostToken,
      remotes: new Map(),
      pairCode: null,
      pairCodeExpiresAt: 0,
      hostDisconnectedAt: null
    };
    this.hostSessions.set(id, session);
    this.hostTokenMap.set(hostToken, id);
    return session;
  }

  getSession(sessionId) {
    return this.hostSessions.get(sessionId);
  }

  getSessionByHostToken(token) {
    const id = this.hostTokenMap.get(token);
    return id ? this.hostSessions.get(id) : null;
  }

  setPairCode(code, sessionId) {
    this.pairCodes.set(code, sessionId);
    const session = this.hostSessions.get(sessionId);
    if (session) {
      session.pairCode = code;
      session.pairCodeExpiresAt = now() + PAIR_CODE_TTL_MS;
    }
    return PAIR_CODE_TTL_MS;
  }

  resolvePairCode(code) {
    const sessionId = this.pairCodes.get(code);
    if (!sessionId) return null;

    // Invalidate code after use
    this.pairCodes.delete(code);
    const session = this.hostSessions.get(sessionId);
    if (session) {
      session.pairCode = null;
      session.pairCodeExpiresAt = 0;
    }
    return session;
  }

  registerRemote(trustToken, identity) {
    this.remoteIdentities.set(trustToken, identity);
  }

  getRemote(trustToken) {
    return this.remoteIdentities.get(trustToken);
  }

  removeRemote(trustToken) {
    this.remoteIdentities.delete(trustToken);
  }

  handleHostDisconnect(ws) {
    const session = this.hostSessions.get(ws.sessionId);
    if (!session) return;

    console.log(`[DISCONNECT] Host disconnected from session ${ws.sessionId}`);

    if (session.socket === ws) {
      session.socket = null;
      session.hostDisconnectedAt = now();
    }

    for (const identity of session.remotes.values()) {
      if (identity.socket) {
        safeSend(identity.socket, { type: MESSAGE_TYPES.HOST_DISCONNECTED });
      }
    }
  }

  startCleanup() {
    setInterval(() => {
      const t = now();

      // 1. Expire Pair Codes
      for (const [code, sessionId] of this.pairCodes.entries()) {
        const session = this.hostSessions.get(sessionId);
        if (!session || t > session.pairCodeExpiresAt) {
          this.pairCodes.delete(code);
          if (session && session.pairCode === code) {
            session.pairCode = null;
          }
        }
      }

      // 2. Remove abandoned sessions
      for (const [sessionId, session] of this.hostSessions.entries()) {
        if (!session.socket && session.hostDisconnectedAt) {
          if (t - session.hostDisconnectedAt > SESSION_TTL_MS) {
            console.log(`[CLEANUP] Removing abandoned session ${sessionId}`);
            for (const identity of session.remotes.values()) {
              if (identity.socket && isOpen(identity.socket)) identity.socket.close();
              this.remoteIdentities.delete(identity.trustToken);
            }
            this.hostSessions.delete(sessionId);
            if (session.hostToken) this.hostTokenMap.delete(session.hostToken);
          }
        }
      }

      // 3. Expire remote identities
      for (const [token, identity] of this.remoteIdentities.entries()) {
        if (t > identity.expiresAt || identity.revoked) {
          if (identity.socket && isOpen(identity.socket)) identity.socket.close();
          this.remoteIdentities.delete(token);
        }
      }

      // 4. Terminate dead sockets
      this.wss.clients.forEach((ws) => {
        if (!ws.isAlive) {
          return ws.terminate();
        }
      });
    }, CLEANUP_INTERVAL_MS);
  }
}

module.exports = SessionStore;