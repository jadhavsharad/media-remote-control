/* -------------------- DOMAINS -------------------- */
export const BASE_DOMAINS = [
  "youtube.com",
  "netflix.com",
  "primevideo.com",
  "hotstar.com",
  "vimeo.com",
];

/* -------------------- MESSAGE TYPES -------------------- */

export const MESSAGE_TYPES = {
  // init / pairing
  HOST_REGISTER: "init.host_register",
  PAIRING_KEY_REQUEST: "init.pairing_key_request",

  // connection
  HEARTBEAT: "connection.heartbeat",
  RECONNECT: "connection.reconnect",
  DISCONNECT: "connection.disconnect",
  UNPAIR: "connection.unpair",
  DESTROY: "connection.destroy",

  // media
  MEDIA_LIST: "media.list",
  MEDIA_STATE: "media.state",

  // script
  SCRIPT_INJECTION_FAIL: "script.injection.failed"
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

/* -------------------- CONTROL EVENTS -------------------- */

export const CONTROL_EVENTS = {
  // playback
  PLAY: "control.play",
  PAUSE: "control.pause",
  TOGGLE_PLAYBACK: "control.toggle_playback",

  // seek
  SEEK_FORWARD: "control.seek.forward",
  SEEK_BACKWARD: "control.seek.backward",
  SEEK_TO: "control.seek.to",

  // audio
  MUTE: "control.mute",
  UNMUTE: "control.unmute",
  TOGGLE_MUTE: "control.toggle_mute",
  SET_VOLUME: "control.set_volume",

  // state sync
  STATE_UPDATE: "control.state_update",
};
