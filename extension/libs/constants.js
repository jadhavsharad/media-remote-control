/* -------------------- DOMAINS -------------------- */
export const BASE_DOMAINS = [
  "youtube",
  "netflix",
  "primevideo",
  "hotstar",
  "vimeo",
  "sonyliv",
  "jiosaavn",
  "music.apple",
  "mxplayer",
  "music.amazon",
  "spotify"
];

/* -------------------- MESSAGE TYPES -------------------- */
export const MESSAGE_TYPES = {
  // init / pairing
  HOST_REGISTER: "init.host_register",
  HOST_REGISTERED: "init.host_registered",
  PAIRING_KEY_REQUEST: "init.pairing_key_request",
  PAIRING_KEY: "init.pairing_key",
  PAIRING_KEY_VALID: "init.pairing_key_valid",
  EXCHANGE_PAIR_KEY: "init.exchange_pair_key",
  PAIR_SUCCESS: "init.pair_success",
  PAIR_FAILED: "init.pair_failed",

  // session
  VALIDATE_SESSION: "session.validate",
  SESSION_VALID: "session.valid",
  SESSION_INVALID: "session.invalid",
  REMOTE_JOINED: "session.remote_joined",
  HOST_DISCONNECTED: "session.host_disconnected",
  HOST_DISCONNECT: "session.host_disconnect", // Action from host to disconnect
  HOST_RECONNECTED: "session.host_reconnected",
  HOST_RECONNECT: "session.host_reconnect",
  NEW_TAB: "session.new_tab",

  // connection
  WS_OPEN: "connection.ws_open",
  WS_CLOSED: "connection.ws_closed",
  CONNECT_WS: "connection.connect_ws",
  DISCONNECT_WS: "connection.disconnect_ws",

  // media
  MEDIA_LIST: "media.list",
  SELECT_ACTIVE_TAB: "media.select_tab",

  // controls
  STATE_UPDATE: "control.state_update",
  INTENT: {
    SET: "control.set",
    REPORT: "control.report"
  },

  // script
  SCRIPT_INJECTION_FAIL: "script.injection.failed",
  REINJECTION_FAILED: "script.reinjection.failed" // For popup
};

/* -------------------- CHANNELS -------------------- */
export const CHANNELS = {
  TO_SERVER: "send.to.server",
  TO_BACKGROUND: "send.to.background",
  TO_CONTENT_SCRIPT: "send.to.content_script",
  TO_POPUP: "send.to.popup",
  TO_OFFSCREEN: "send.to.offscreen",

  FROM_SERVER: "receive.from.server",
  FROM_BACKGROUND: "receive.from.background",
  FROM_CONTENT_SCRIPT: "receive.from.content_script",
  FROM_POPUP: "receive.from.popup",
  FROM_OFFSCREEN: "receive.from.offscreen",
};

export const MEDIA_STATE = {
  PLAYBACK: "playback",       // values: "PLAYING", "PAUSED"
  MUTE: "muted",              // values: true, false
  TIME: "currentTime",        // values: number (seconds)
  DURATION: "duration",       // values: number (seconds)
  TITLE: "title",             // values: string
  VOLUME: "volume",           // values: number (0-100)
};

/* -------------------- POPUP ACTIONS -------------------- */
export const POPUP_ACTIONS = {
  GET_STATUS: "popup.get_status",
  REQUEST_CODE: "popup.request_code",
  DISCONNECT: "popup.disconnect",
  RECONNECT: "popup.reconnect",
  PAIR_CODE_RECEIVED: "popup.pair_code_received"
};