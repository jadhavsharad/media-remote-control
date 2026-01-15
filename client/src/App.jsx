import { useEffect, useRef, useState, useCallback } from "react";
import { Html5QrcodeScanner } from "html5-qrcode";

const WS_URL = import.meta.env.VITE_WS_URL || "ws://localhost:3001";
const RECONNECT_DELAY = 2000;

const MSG = {
  EXCHANGE_PAIR_CODE: "EXCHANGE_PAIR_CODE",
  PAIR_SUCCESS: "PAIR_SUCCESS",
  PAIR_FAILED: "PAIR_FAILED",
  VALIDATE_SESSION: "VALIDATE_SESSION",
  SESSION_VALID: "SESSION_VALID",
  SESSION_INVALID: "SESSION_INVALID",
  HOST_DISCONNECTED: "HOST_DISCONNECTED",

  MEDIA_TABS_LIST: "MEDIA_TABS_LIST",
  STATE_UPDATE: "STATE_UPDATE",
  SELECT_ACTIVE_TAB: "SELECT_ACTIVE_TAB",

  CONTROL_EVENT: "CONTROL_EVENT",
  TOGGLE_PLAYBACK: "TOGGLE_PLAYBACK",
};

export default function App() {
  const [, setTrustToken] = useState(() =>
    localStorage.getItem("trust_token")
  );

  // Status: Disconnected | Connecting | Verifying | Scanning | Paired | Waiting
  const [status, setStatus] = useState("Disconnected");
  const [mediaTabs, setMediaTabs] = useState([]);
  const [selectedTabId, setSelectedTabId] = useState(null);
  const [playbackState, setPlaybackState] = useState("Play");

  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const isMounted = useRef(true);
  const scannerRef = useRef(null);

  const send = useCallback((msg) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify(msg));
  }, []);

  const handleMessageRef = useRef(null);

  const handleMessage = (msg) => {
    if (!msg?.type) return;

    switch (msg.type) {
      case MSG.PAIR_SUCCESS:
        localStorage.setItem("trust_token", msg.trustToken);
        setTrustToken(msg.trustToken);
        setStatus("Paired");
        break;

      case MSG.PAIR_FAILED:
        alert("Pairing failed");
        setStatus("Scanning");
        break;

      case MSG.SESSION_VALID:
        setStatus("Paired");
        break;

      case MSG.SESSION_INVALID:
        localStorage.removeItem("trust_token");
        setTrustToken(null);
        setStatus("Scanning");
        break;

      case MSG.HOST_DISCONNECTED:
        setStatus("Waiting");
        setMediaTabs([]);
        setSelectedTabId(null);
        break;

      case MSG.MEDIA_TABS_LIST:
        if (Array.isArray(msg.tabs)) {
          setMediaTabs(msg.tabs);
          if (selectedTabId && !msg.tabs.find((t) => t.tabId === selectedTabId)) setSelectedTabId(null);
        }
        break;

      case MSG.STATE_UPDATE:
        setPlaybackState(msg.state === "PLAYING" ? "Pause" : "Play");
        break;

      default:
        break;
    }
  };

  useEffect(() => {
    handleMessageRef.current = handleMessage;
  });

  useEffect(() => {
    isMounted.current = true;

    const connect = () => {
      if (wsRef.current && (wsRef.current.readyState === WebSocket.CONNECTING || wsRef.current.readyState === WebSocket.OPEN)) return;

      setStatus((prev) => prev === "Scanning" ? "Scanning" : "Connecting");
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!isMounted.current) return;

        const token = localStorage.getItem("trust_token");
        if (token) {
          setStatus("Verifying");
          ws.send(JSON.stringify({ type: MSG.VALIDATE_SESSION, trustToken: token }));
        } else {
          setStatus("Scanning");
        }
      };

      ws.onclose = () => {
        if (!isMounted.current) return;

        setStatus(prev => prev === "Scanning" ? "Scanning" : "Disconnected");
        setMediaTabs([]);
        setSelectedTabId(null);
        reconnectTimeoutRef.current = setTimeout(connect, RECONNECT_DELAY);
      };

      ws.onerror = () => { ws.close(); };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (handleMessageRef.current) handleMessageRef.current(msg);
        } catch (e) {
          console.error("Invalid WS message", e);
        }
      };
    };

    connect();

    return () => {
      isMounted.current = false;
      if (wsRef.current) wsRef.current.close();
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
    };
  }, []);

  const onScanSuccess = useCallback((decodedText) => {
    if (!decodedText) return;

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      send({ type: MSG.EXCHANGE_PAIR_CODE, code: decodedText, });
      setStatus("Verifying");
    }
  }, [send]);

  const handleDisconnect = () => {
    localStorage.removeItem("trust_token");
    setTrustToken(null);
    setStatus("Scanning");
    setMediaTabs([]);
    setSelectedTabId(null);
  };

  const handleSelectTab = (tabId) => {
    setSelectedTabId(tabId);
    send({ type: MSG.SELECT_ACTIVE_TAB, tabId, });
  };

  const handleTogglePlayback = () => {
    send({ type: MSG.CONTROL_EVENT, action: MSG.TOGGLE_PLAYBACK, });
  };

  useEffect(() => {
    if (status === "Scanning") {
      const timer = setTimeout(() => {
        if (!document.getElementById("reader")) return;

        if (scannerRef.current) scannerRef.current.clear();

        const scanner = new Html5QrcodeScanner("reader", { fps: 10, qrbox: { width: 250, height: 250 } }, false);
        scanner.render(onScanSuccess, () => { });
        scannerRef.current = scanner;
      }, 100);

      return () => {
        clearTimeout(timer);
        if (scannerRef.current) scannerRef.current.clear().catch(() => { });
        scannerRef.current = null;
      };
    } else {
      if (scannerRef.current) scannerRef.current.clear().catch(() => { });
      scannerRef.current = null;
    }
  }, [status, onScanSuccess]);

  return (
    <div className="bg-zinc-950 min-h-screen text-white flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-3xl p-8 shadow-2xl flex flex-col gap-6">

        {/* Header */}
        <div className="flex justify-between items-center border-b border-zinc-800 pb-4">
          <h1 className="text-xl font-bold">Remote Control</h1>
          <span className="text-xs text-zinc-400 uppercase" data-testid="status-indicator">{status}</span>
        </div>

        {/* Scanning */}
        {status === "Scanning" && (
          <div className="flex flex-col gap-4" data-testid="scanner-container">
            <div className="text-center text-sm text-zinc-400">
              Scan QR code from extension
            </div>
            <div id="reader" className="rounded-xl overflow-hidden" />
          </div>
        )}

        {/* Connecting / Verifying */}
        {(status === "Connecting" || status === "Verifying") && (
          <div className="flex flex-col items-center gap-4 py-12" data-testid="loading-container">
            <div className="animate-spin h-8 w-8 border-4 border-zinc-700 border-t-zinc-400 rounded-full" />
            <div className="text-sm uppercase">{status}</div>
          </div>
        )}

        {/* Paired */}
        {status === "Paired" && (
          <div className="flex flex-col gap-6" data-testid="paired-container">
            <div className="flex justify-end">
              <button
                onClick={handleDisconnect}
                className="text-xs text-red-400 bg-red-500/10 px-3 py-1 rounded-full"
                data-testid="unpair-btn"
              >
                Unpair
              </button>
            </div>

            {/* Tabs */}
            <div className="flex flex-col gap-2">
              {mediaTabs.map((tab) => (
                <button
                  key={tab.tabId}
                  onClick={() => handleSelectTab(tab.tabId)}
                  className={`p-4 rounded-xl text-left ${selectedTabId === tab.tabId
                    ? "bg-white text-black"
                    : "bg-zinc-800 text-zinc-400"
                    }`}
                >
                  {tab.title}
                </button>
              ))}
            </div>

            {/* Playback */}
            <button
              disabled={!selectedTabId}
              onClick={handleTogglePlayback}
              className="h-14 rounded-xl bg-zinc-800 disabled:opacity-30"
              data-testid="play-pause-btn"
            >
              {playbackState === "Play" ? "▶ Play" : "⏸ Pause"}
            </button>
          </div>
        )}

        {/* Waiting */}
        {status === "Waiting" && (
          <div className="text-center text-zinc-400 text-sm py-8">
            Waiting for host to reconnect…
          </div>
        )}
      </div>
    </div>
  );
}
