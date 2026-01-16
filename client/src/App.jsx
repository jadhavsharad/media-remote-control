import { useEffect, useRef, useState, useCallback } from "react";
import GlowDot from "./components/ui/glowDot";
import Html5QrcodePlugin from "./components/Html5QrcodePlugin";
import { IoMdPlay, IoMdPause } from "react-icons/io";
import { MSG, CONNECTION_STATUS, PLAYBACK_STATE } from "./constants/constants";
import { match, P } from "ts-pattern";
import { toast } from "sonner"

const WS_URL = import.meta.env.VITE_WS_URL || "ws://localhost:3001";
const RECONNECT_DELAY = 2000;

const STATUS_COLORS = {
  [CONNECTION_STATUS.PAIRED]: "bg-green-500 border-green-400",
  [CONNECTION_STATUS.SCANNING]: "bg-blue-500 border-blue-500",
  [CONNECTION_STATUS.CONNECTING]: "bg-yellow-500 border-yellow-400",
  [CONNECTION_STATUS.CONNECTED]: "bg-zinc-50 border-zinc-50",
  [CONNECTION_STATUS.VERIFYING]: "bg-orange-500 border-orange-400",
  [CONNECTION_STATUS.DISCONNECTED]: "bg-red-500 border-red-400",
  [CONNECTION_STATUS.WAITING]: "bg-zinc-50 border-zinc-50",
};

export default function App() {
  const [, setTrustToken] = useState(() =>
    localStorage.getItem("trust_token")
  );

  const [status, setStatus] = useState(CONNECTION_STATUS.DISCONNECTED);
  const [mediaTabs, setMediaTabs] = useState([]);
  const [selectedTabId, setSelectedTabId] = useState(null);
  const [playbackState, setPlaybackState] = useState(PLAYBACK_STATE.PLAY);

  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const isMounted = useRef(true);
  const handleMessageRef = useRef(null);

  const send = useCallback((msg) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  const handleMessage = (msg) => {
    if (!msg?.type) return;

    match(msg)
      .with({ type: MSG.PAIR_SUCCESS }, (m) => {
        localStorage.setItem("trust_token", m.trustToken);
        setTrustToken(m.trustToken);
        setStatus(CONNECTION_STATUS.PAIRED);
      })
      .with({ type: MSG.PAIR_FAILED }, () => {
        setStatus(CONNECTION_STATUS.CONNECTED);
        alert("Pairing failed");
        toast.error("Pairing failed");
      })
      .with({ type: MSG.SESSION_VALID }, () => {
        setStatus(CONNECTION_STATUS.PAIRED);
      })
      .with({ type: MSG.SESSION_INVALID }, () => {
        localStorage.removeItem("trust_token");
        setTrustToken(null);
        setStatus(CONNECTION_STATUS.CONNECTED);
      })
      .with({ type: MSG.HOST_DISCONNECTED }, () => {
        setStatus(CONNECTION_STATUS.WAITING);
        setMediaTabs([]);
        setSelectedTabId(null);
      })
      .with({ type: MSG.MEDIA_TABS_LIST, tabs: P.array() }, (m) => {
        setMediaTabs(m.tabs);
        if (selectedTabId && !m.tabs.some((t) => t.tabId === selectedTabId)) {
          setSelectedTabId(null);
        }
      })
      .with({ type: MSG.STATE_UPDATE }, (m) => {
        setPlaybackState(m.state === "PLAYING" ? PLAYBACK_STATE.PAUSE : PLAYBACK_STATE.PLAY);
      })
      .otherwise(() => { });
  };

  useEffect(() => {
    handleMessageRef.current = handleMessage;
  });

  useEffect(() => {
    isMounted.current = true;

    const connect = () => {
      if (wsRef.current && (wsRef.current.readyState === WebSocket.CONNECTING || wsRef.current.readyState === WebSocket.OPEN)) {
        return;
      }

      setStatus(CONNECTION_STATUS.CONNECTING);

      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!isMounted.current) return;

        const token = localStorage.getItem("trust_token");
        if (token) {
          setStatus(CONNECTION_STATUS.VERIFYING);
          ws.send(JSON.stringify({ type: MSG.VALIDATE_SESSION, trustToken: token }));
        } else {
          setStatus(CONNECTION_STATUS.CONNECTED);
        }
      };

      ws.onclose = () => {
        if (!isMounted.current) return;

        setStatus(CONNECTION_STATUS.DISCONNECTED);
        setMediaTabs([]);
        setSelectedTabId(null);
        reconnectTimeoutRef.current = setTimeout(connect, RECONNECT_DELAY);
      };

      ws.onerror = () => ws.close();

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          handleMessageRef.current?.(msg);
        } catch {
          console.error("Invalid WS message");
        }
      };
    };

    connect();

    return () => {
      isMounted.current = false;
      wsRef.current?.close();
      clearTimeout(reconnectTimeoutRef.current);
    };
  }, []);

  const onScanSuccess = useCallback((decodedText) => {
    if (!decodedText) return;

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      send({ type: MSG.EXCHANGE_PAIR_CODE, code: decodedText });
      setStatus(CONNECTION_STATUS.VERIFYING);
    }
  },
    [send]
  );

  const handleDisconnect = () => {
    localStorage.removeItem("trust_token");
    setTrustToken(null);
    setStatus(CONNECTION_STATUS.CONNECTED);
    setMediaTabs([]);
    setSelectedTabId(null);
  };

  const handleSelectTab = (tabId) => {
    setSelectedTabId(tabId);
    send({ type: MSG.SELECT_ACTIVE_TAB, tabId });
  };

  const handleTogglePlayback = () => {
    send({ type: MSG.CONTROL_EVENT, action: MSG.TOGGLE_PLAYBACK });
  };

  return (
    <div className=" min-h-screen flex items-center justify-center text-white antialiased px-4">
      <div className="w-full max-w-lg bg-zinc-950 p-4 border border-zinc-800">
        <header className="gap-3 flex flex-row justify-between">
          <h1 className="font-bold ">Media Remote Control</h1>
          <div className="w-px min-h-full bg-zinc-700"></div>
          <div className="flex items-center gap-2 text-sm">
            <GlowDot colorClass={STATUS_COLORS[status]} />
            <span className="z-10">Socket Status : {status}</span>
          </div>
        </header>
        <small className="text-zinc-400 text-right flex justify-end text-xs">
          {match(status)
            .with(CONNECTION_STATUS.CONNECTED, () => "Connected to server. Waiting to pair")
            .with(CONNECTION_STATUS.DISCONNECTED, () => "Disconnected with server.")
            .with(CONNECTION_STATUS.PAIRED, () => "Successfully paired with device.")
            .with(CONNECTION_STATUS.CONNECTING, () => "Connecting with server.")
            .otherwise(() => null)}
        </small>

        <div className="w-full h-px bg-zinc-700 my-2"></div>

        <div>
          {match(status)
            .with(CONNECTION_STATUS.CONNECTED, () => (
              <div className="flex flex-col gap-4" data-testid="scanner-container">
                <Html5QrcodePlugin
                  fps={10}
                  qrbox={250}
                  disableFlip={false}
                  qrCodeSuccessCallback={onScanSuccess}
                />
              </div>
            ))
            .with(P.union(CONNECTION_STATUS.CONNECTING, CONNECTION_STATUS.VERIFYING), () => (
              <div className="flex flex-col items-center gap-4 py-12" data-testid="loading-container">
                <div className="animate-spin h-8 w-8 border-4 border-zinc-700 border-t-zinc-400 rounded-full" />
                <div className="text-sm uppercase">{status}</div>
              </div>
            ))
            .with(CONNECTION_STATUS.PAIRED, () => (
              <div className="flex flex-col gap-6" data-testid="paired-container">
                <div className="flex justify-between">
                  <p>
                    <small className="text-zinc-400">Device information</small>{" "}
                    <br />
                    OS: Mac / Linux / Windows <br />
                    Browser: Chrome / Firefox / Edge <br />
                    Tabs open: 24
                  </p>
                  <button onClick={handleDisconnect} className="text-xs text-red-400 bg-red-500/10 px-4 py-2  cursor-pointer h-fit" data-testid="unpair-btn">{" "} Unpair</button>
                </div>

                <div className="max-h-96 overflow-y-auto custom-scrollbar">
                  <div className="flex flex-col gap-2 w-full">
                    {mediaTabs.map((tab) => (
                      <button key={tab.tabId} onClick={() => handleSelectTab(tab.tabId)} className={`w-full text-left truncate cursor-pointer p-4 ${selectedTabId === tab.tabId ? "bg-white text-black" : "bg-zinc-800 text-zinc-400"}`}><small>{tab.title}</small></button>
                    ))}
                  </div>
                </div>

                <button disabled={!selectedTabId} onClick={handleTogglePlayback} className="bg-zinc-900 text-white flex items-center justify-center gap-2 py-2 px-4 w-fit disabled:text-zinc-600" data-testid="play-pause-btn">
                  {playbackState === PLAYBACK_STATE.PLAY ? <><IoMdPlay /> Play</> : <><IoMdPause /> Pause</>}
                </button>
              </div>
            ))
            .with(CONNECTION_STATUS.WAITING, () => (
              <div className="text-center text-zinc-400 text-sm py-8">
                Waiting for host to reconnect…
              </div>
            ))
            .with(CONNECTION_STATUS.DISCONNECTED, () => (
              <div className="text-center text-zinc-400 text-sm py-8">
                Not connected with server.
              </div>
            ))
            .otherwise(() => null)}
        </div>
      </div>
    </div>
  );
}
