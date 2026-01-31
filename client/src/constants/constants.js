/* -------------------- MESSAGE TYPES -------------------- */
export const MESSAGE_TYPES = {
  // init / pairing
  PAIRING_KEY: "init.pairing_key",
  EXCHANGE_PAIR_KEY: "init.exchange_pair_key",
  PAIR_SUCCESS: "init.pair_success",
  PAIR_FAILED: "init.pair_failed",

  // session
  VALIDATE_SESSION: "session.validate",
  SESSION_VALID: "session.valid",
  SESSION_INVALID: "session.invalid",
  REMOTE_JOINED: "session.remote_joined",
  HOST_DISCONNECTED: "session.host_disconnected",
  HOST_RECONNECTED: "session.host_reconnected",
  NEW_TAB: "session.new_tab",

  // connection
  BLOCKED: "Blocked",
  CONNECTING: "Connecting",
  DISCONNECTED: "Disconnected",
  CONNECTED: "Connected",
  VERIFYING: "Verifying",
  WAITING: "Waiting",

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


export const MEDIA_STATE = {
  PLAYBACK: "playback",       // values: "PLAYING", "PAUSED"
  MUTE: "muted",              // values: true, false
  TIME: "currentTime",        // values: number (seconds)
  DURATION: "duration",       // values: number (seconds)
  TITLE: "title",             // values: string
  VOLUME: "volume",           // values: number (0-1)
};


export const SUPPORTED_SITES = {
  YOUTUBE:{
    name:"Youtube",
    url:"https://www.youtube.com",
    supported:true,
  },
  YOUTUBE_MUSIC:{
    name:"YT Music",
    url:"https://music.youtube.com",
    supported:true,
  },
  SPOTIFY:{
    name:"Spotify",
    url:"https://open.spotify.com",
    supported:false,
  },
  AMAZON_MUSIC:{
    name:"Amazon Music",
    url:"https://music.amazon.in",
    supported:false,
  },
  NETFLIX:{
    name:"Netflix",
    url:"https://www.netflix.com",
    supported:true,
  },
  PRIME_VIDEO:{
    name:"Prime Video",
    url:"https://www.primevideo.com",
    supported:true,
  },
  DISNEY_PLUS:{
    name:"Disney Plus",
    url:"https://www.disneyplus.com",
    supported:true,
  },
  SONY_LIV:{
    name:"Sony Liv",
    url:"https://www.sonyliv.com",
    supported:true,
  },
  MX_PLAYER:{
    name:"MX Player",
    url:"https://www.mxplayer.in",
    supported:true,
  },
  VIMEO:{
    name:"Vimeo",
    url:"https://vimeo.com",
    supported:true,
  },
  JIOSAAVN:{
    name:"JioSaavn",
    url:"https://www.jiosaavn.com",
    supported:true,
  },
  APPLE_MUSIC:{
    name:"Apple Music",
    url:"https://music.apple.com",
    supported:true,
  },
}
