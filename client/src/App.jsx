import React, { useCallback, useEffect, useRef, useState } from 'react'
import GlowDot from "./components/ui/glowDot";
import Html5QrcodePlugin from "./components/Html5QrcodePlugin";
import { match, P } from "ts-pattern";
import { MEDIA_STATE, MESSAGE_TYPES } from './constants/constants';
import { toast } from 'sonner';
import { IoMdPlay, IoMdPause, IoMdVolumeOff, IoMdVolumeHigh, IoMdBulb } from "react-icons/io";

const WS_URL = import.meta.env.VITE_WS_URL || "ws://localhost:3001";
const RECONNECT_DELAY = 2000;


const STATUS_COLORS = {
    [MESSAGE_TYPES.PAIR_SUCCESS]: "bg-green-500 border-green-400",
    [MESSAGE_TYPES.CONNECTING]: "bg-yellow-500 border-yellow-400",
    [MESSAGE_TYPES.CONNECTED]: "bg-zinc-50 border-zinc-50",
    [MESSAGE_TYPES.VERIFYING]: "bg-orange-500 border-orange-400",
    [MESSAGE_TYPES.DISCONNECTED]: "bg-red-500 border-red-400",
    [MESSAGE_TYPES.WAITING]: "bg-zinc-50 border-zinc-50",
};


const App = () => {

    const [status, setStatus] = useState(MESSAGE_TYPES.DISCONNECTED);
    const [tabsById, setTabsById] = useState({});
    const [activeTabId, setActiveTabId] = useState(null);
    const activeTab = activeTabId ? tabsById[activeTabId] : null;
    const [hostInfo, setHostInfo] = useState(null);

    const isConnecting = () => { return wsRef.current?.readyState === WebSocket.CONNECTING }
    const isOpen = () => { return wsRef.current?.readyState === WebSocket.OPEN }
    const setToken = (token) => { token ? (localStorage.setItem("trust_token", token), trustTokenRef.current = token) : (localStorage.removeItem("trust_token"), trustTokenRef.current = null) }
    const getToken = () => { const t = localStorage.getItem("trust_token"); return t && t !== "null" ? t : null; }

    const send = useCallback((msg) => {
        if (!isOpen()) return;
        wsRef.current.send(JSON.stringify(msg));
    }, []);

    const sendToActiveTab = useCallback((key, value) => {
        if (!isOpen()) return;
        if (!activeTabId) { toast.error("Select a tab first"); return }

        send({
            type: MESSAGE_TYPES.STATE_UPDATE,
            intent: MESSAGE_TYPES.INTENT.SET,
            key,
            value,
            tabId: activeTabId
        });
    }, [activeTabId]);

    const activateTab = (tabId) => { setActiveTabId(tabId); send({ type: MESSAGE_TYPES.SELECT_ACTIVE_TAB, tabId }); }
    const deactivateTab = () => { setActiveTabId(null); }
    const handleDisconnect = () => {
        setToken(null);
        setStatus(MESSAGE_TYPES.DISCONNECTED);
        window.location.reload();
    }

    const handleTogglePlayback = () => {
        if (!activeTab) return;
        sendToActiveTab(MEDIA_STATE.PLAYBACK, activeTab.playback === "PLAYING" ? "PAUSED" : "PLAYING");
    };

    const handleToggleMute = () => {
        if (!activeTab) return;
        sendToActiveTab(MEDIA_STATE.MUTE, !activeTab.muted);
    };


    const trustTokenRef = useRef(getToken());
    const wsRef = useRef(null);
    const isMounted = useRef(true);
    const reconnectTimeoutRef = useRef(null);
    const handleMessageRef = useRef(null);

    useEffect(() => {
        isMounted.current = true;
        const connect = () => {
            if (isOpen() || isConnecting()) return;

            setStatus(MESSAGE_TYPES.CONNECTING);

            const ws = new WebSocket(WS_URL);

            ws.onopen = () => {
                if (!isMounted.current) return;

                const token = trustTokenRef.current;

                if (token) {
                    setStatus(MESSAGE_TYPES.VERIFYING);
                    send({ type: MESSAGE_TYPES.VALIDATE_SESSION, trustToken: token });
                } else {
                    setStatus(MESSAGE_TYPES.CONNECTED);
                }
            };

            ws.onclose = () => {
                if (!isMounted.current) return;
                setStatus(MESSAGE_TYPES.DISCONNECTED);
                reconnectTimeoutRef.current = setTimeout(connect, RECONNECT_DELAY);
            };

            ws.onerror = (e) => {
                log("onerror", e);
            };

            ws.onmessage = (event) => {
                try {
                    const msg = JSON.parse(event.data);
                    handleMessageRef.current?.(msg);
                } catch (e) {
                    console.error("Invalid WS message", e);
                }
            };
            wsRef.current = ws;
        };

        connect();

        return () => {
            isMounted.current = false;
            wsRef.current?.close();
            clearTimeout(reconnectTimeoutRef.current);
        };
    }, []);

    useEffect(() => {
        handleMessageRef.current = handleMessage;
    });

    const handleMessage = (msg) => {
        if (!msg?.type) return;

        match(msg)
            .with({ type: MESSAGE_TYPES.PAIR_SUCCESS }, (m) => {
                setToken(m.trustToken); // set the token in the ref
                setHostInfo(m.hostInfo);
                setStatus(MESSAGE_TYPES.PAIR_SUCCESS); // set the status to PAIR_SUCCESS
                toast.success("Pairing successful");
            })
            .with({ type: MESSAGE_TYPES.PAIR_FAILED }, () => {
                toast.error("Pairing failed");
                setStatus(MESSAGE_TYPES.DISCONNECTED); // set the status to DISCONNECTED
            })
            .with({ type: MESSAGE_TYPES.SESSION_VALID }, (m) => {
                setHostInfo(m.hostInfo);
                setStatus(MESSAGE_TYPES.PAIR_SUCCESS); // set the status to PAIR_SUCCESS
                toast.success("Session valid");
            })
            .with({ type: MESSAGE_TYPES.SESSION_INVALID }, () => {
                setToken(null); // set the token in the ref to null
                setStatus(MESSAGE_TYPES.DISCONNECTED); // set the status to DISCONNECTED
                toast.error("Session invalid");
            })
            .with({ type: MESSAGE_TYPES.HOST_DISCONNECTED }, () => {
                setStatus(MESSAGE_TYPES.WAITING); // set the status to WAITING
                toast.error("Host disconnected");
            })
            .with({ type: MESSAGE_TYPES.MEDIA_LIST, tabs: P.array() }, (m) => {
                setTabsById(prev => {
                    const next = {}; // create a new object, copy the previous state
                    for (const tab of m.tabs) { // update each tab in the new object
                        next[tab.tabId] = { // update the tab in the new object
                            ...prev[tab.tabId], // keep playback state if exists
                            ...tab // update the tab
                        };
                    }

                    return next;
                });
            })

            .with({ type: MESSAGE_TYPES.STATE_UPDATE }, (m) => {
                setTabsById(prev => {
                    const tab = prev[m.tabId]; // get the tab from the previous state
                    if (!tab) return prev; // if the tab does not exist, return the previous state

                    return {
                        ...prev, // spread the previous state, do not mutate the previous state
                        [m.tabId]: {
                            ...tab, // spread the previous tab, do not mutate the previous state
                            playback: m.state // update the playback state
                        }
                    };
                });
            })
            .otherwise(() => { }); // do nothing
    };

    // Handle QR code scan
    const onScanSuccess = useCallback((decodedText) => {
        if (!decodedText) return;

        if (isOpen()) {
            send({ type: MESSAGE_TYPES.EXCHANGE_PAIR_KEY, code: decodedText }); // send the pair key to the server
            setStatus(MESSAGE_TYPES.VERIFYING);
        }
    }, [send]);

    return (
        <div className=" min-h-screen flex items-center justify-center text-white antialiased px-4 font-sans">
            <div className="w-full max-w-2xl bg-zinc-950 p-4 border border-zinc-800">
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
                        .with(MESSAGE_TYPES.CONNECTED, () => "Connected to server. Waiting to pair")
                        .with(MESSAGE_TYPES.DISCONNECTED, () => "Disconnected with server.")
                        .with(MESSAGE_TYPES.PAIR_SUCCESS, () => "Successfully paired with device.")
                        .with(MESSAGE_TYPES.CONNECTING, () => "Connecting with server.")
                        .otherwise(() => null)}
                </small>

                <div className="w-full h-px bg-zinc-700 my-2"></div>

                <div>
                    {match(status)
                        .with(MESSAGE_TYPES.CONNECTED, () => (
                            <div className="flex flex-col gap-4" data-testid="scanner-container">
                                <Html5QrcodePlugin
                                    fps={10}
                                    qrbox={250}
                                    disableFlip={false}
                                    qrCodeSuccessCallback={onScanSuccess}
                                />
                            </div>
                        ))
                        .with(P.union(MESSAGE_TYPES.CONNECTING, MESSAGE_TYPES.VERIFYING), () => (
                            <div className="flex flex-col items-center gap-4 py-12" data-testid="loading-container">
                                <div className="animate-spin h-8 w-8 border-4 border-zinc-700 border-t-zinc-400 rounded-full" />
                                <div className="text-sm uppercase">{status}</div>
                            </div>
                        ))
                        .with(MESSAGE_TYPES.PAIR_SUCCESS, () => (
                            <div className="flex flex-col gap-6" data-testid="paired-container">
                                <div className="flex justify-between">
                                    <p>
                                        <small className="text-zinc-400">Connection information</small>{" "}
                                        <br />
                                        OS: {hostInfo?.os} <br />
                                        Browser: {hostInfo?.browser} <br />
                                        Media Tabs open: {(Object.keys(tabsById).length < 10) ? `0${Object.keys(tabsById).length}` : Object.keys(tabsById).length}
                                    </p>
                                    <button onClick={handleDisconnect} className="text-xs text-red-400 bg-red-500/10 px-4 py-2  cursor-pointer h-fit" data-testid="unpair-btn">{" "} Unpair</button>
                                </div>

                                <div className="max-h-96 overflow-y-auto custom-scrollbar">
                                    <div className="flex flex-col gap-2 w-full">
                                        {Object.values(tabsById).map((tab) => (
                                            <button key={tab.tabId} onClick={() => activateTab(tab.tabId)} className={`w-full flex items-center gap-4 text-left truncate cursor-pointer p-4 ${activeTabId === tab.tabId ? "bg-white text-black" : "bg-zinc-800 text-zinc-400"}`}><img src={tab.favIconUrl} alt={tab.title} className="w-6 h-6" /><small>{tab.title}</small></button>
                                        ))}
                                    </div>
                                </div>

                                <div className="flex gap-4">
                                    <button disabled={!activeTab} onClick={handleTogglePlayback} className="cursor-pointer bg-zinc-900 text-white flex items-center justify-center gap-2 py-2 px-4 w-fit disabled:text-zinc-600">
                                        {activeTab?.playback === "IDLE" ? <><IoMdBulb /> Idle </> : activeTab?.playback === "PLAYING" ? <><IoMdPause /> Pause</> : <><IoMdPlay /> Play</>}
                                    </button>
                                    <button disabled={!activeTab} onClick={handleToggleMute} className="cursor-pointer bg-zinc-900 text-white flex items-center justify-center gap-2 py-2 px-4 w-fit disabled:text-zinc-600">
                                        {activeTab?.muted ? <><IoMdVolumeOff /> Unmute</> : <><IoMdVolumeHigh /> Mute</>}
                                    </button>
                                </div>
                            </div>
                        ))
                        .with(MESSAGE_TYPES.WAITING, () => (
                            <div className="text-center text-zinc-400 text-sm py-8">
                                Waiting for host to reconnect…
                            </div>
                        ))
                        .with(MESSAGE_TYPES.DISCONNECTED, () => (
                            <div className="text-center text-zinc-400 text-sm py-8">
                                Not connected with server.
                            </div>
                        ))
                        .otherwise(() => null)}
                </div>
            </div>
        </div>
    )
}

export default App
