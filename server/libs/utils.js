const crypto = require("crypto");
const { MESSAGE_TYPES, MEDIA_STATE } = require("./constants");

const RATE_LIMIT_MS = 200;

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
  return ws.readyState === ws.OPEN;
}

function safeSend(ws, payload) {
  try {
    if (ws && isOpen(ws)) {
      ws.send(JSON.stringify(payload));
    }
  } catch (e) {
    console.error("[WS_SEND_ERROR]", e);
  }
}

function isValidMessage(msg) {
  if (!msg || typeof msg !== "object") return false;
  // Basic validation that type exists in our protocol
  const allTypes = [...Object.values(MESSAGE_TYPES), ...Object.values(MEDIA_STATE)].filter(v => typeof v === 'string');
  return allTypes.includes(msg.type);
}

function isRateLimited(ws) {
  const t = now();
  if (t - (ws.lastSeenAt || 0) < RATE_LIMIT_MS) return true;
  ws.lastSeenAt = t;
  return false;
}

module.exports = {
  generateUUID,
  generatePairCode,
  now,
  isOpen,
  safeSend,
  isValidMessage,
  isRateLimited
};