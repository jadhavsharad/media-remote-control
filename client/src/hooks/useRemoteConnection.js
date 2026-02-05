import { useEffect, useRef, useState, useCallback } from 'react';
import { match, P } from "ts-pattern";
import { toast } from 'sonner';
import { MESSAGE_TYPES } from '../constants/constants'; // Adjust path as needed

const WS_URL = import.meta.env.VITE_WS_URL;
const RECONNECT_DELAY = 2000;
const OPTIMISTIC_LOCK_DURATION = 1000; // Ignore server updates for 1s after user interaction

export const useRemoteConnection = () => {
    const [status, setStatus] = useState(MESSAGE_TYPES.DISCONNECTED);
    const [tabsById, setTabsById] = useState({});
    const [activeTabId, setActiveTabId] = useState(null);
    const [hostInfo, setHostInfo] = useState(null);
    
    // Refs for mutable state that shouldn't trigger re-renders inside callbacks
    const wsRef = useRef(null);
    const isMounted = useRef(true);
    const reconnectTimeoutRef = useRef(null);
    const trustTokenRef = useRef(localStorage.getItem("trust_token") === "null" ? null : localStorage.getItem("trust_token"));

    const setToken = (token) => {
        if (token) {
            localStorage.setItem("trust_token", token);
            trustTokenRef.current = token;
        } else {
            localStorage.removeItem("trust_token");
            trustTokenRef.current = null;
        }
    };

    const isOpen = () => wsRef.current?.readyState === WebSocket.OPEN;

    const send = useCallback((msg) => {
        if (!isOpen()) return;
        wsRef.current.send(JSON.stringify(msg));
    }, []);

    // Message Handler
    const handleMessage = useCallback((msg) => {
        if (!msg?.type) return;

        match(msg)
            .with({ type: MESSAGE_TYPES.PAIR_SUCCESS }, (m) => {
                setToken(m.trustToken);
                setHostInfo(m.hostInfo);
                setStatus(MESSAGE_TYPES.PAIR_SUCCESS);
                toast.success("Pairing successful");
            })
            .with({ type: MESSAGE_TYPES.PAIR_FAILED }, () => {
                toast.error("Pairing failed");
                setStatus(MESSAGE_TYPES.DISCONNECTED);
                setToken(null);
            })
            .with({ type: MESSAGE_TYPES.SESSION_VALID }, (m) => {
                setHostInfo(m.hostInfo);
                setStatus(MESSAGE_TYPES.PAIR_SUCCESS);
                toast.success("Session restored");
            })
            .with({ type: MESSAGE_TYPES.SESSION_INVALID }, () => {
                setToken(null);
                setStatus(MESSAGE_TYPES.DISCONNECTED);
                toast.error("Session expired");
            })
            .with({ type: MESSAGE_TYPES.HOST_DISCONNECTED }, () => {
                setStatus(MESSAGE_TYPES.WAITING);
                toast.warning("Host disconnected");
            })
            .with({ type: MESSAGE_TYPES.MEDIA_LIST, tabs: P.array() }, (m) => {
                setTabsById(prev => {
                    const next = {};
                    m.tabs.forEach(tab => {

                        const existingLock = prev[tab.tabId]?.lockedUntil;
                        next[tab.tabId] = { 
                            ...prev[tab.tabId], 
                            ...tab,
                            lockedUntil: existingLock
                        };
                    });
                    return next;
                });
            })
            .with({ type: MESSAGE_TYPES.STATE_UPDATE }, (m) => {
                setTabsById(prev => {
                    const tab = prev[m.tabId] || {};
                    const now = Date.now();
                    if (tab.lockedUntil && now < tab.lockedUntil) {
                        return prev;
                    }
                    return {
                        ...prev,
                        [m.tabId]: {
                            ...tab,
                            [m.key]: m.value,
                            lastUpdateAt: m.timestamp,
                        }
                    };
                });
            })
            .otherwise(() => { });
    }, []);

    // Connection Logic
    useEffect(() => {
        isMounted.current = true;

        const connect = () => {
            if (isOpen() || wsRef.current?.readyState === WebSocket.CONNECTING) return;

            setStatus(MESSAGE_TYPES.CONNECTING);
            const ws = new WebSocket(WS_URL);

            ws.onopen = () => {
                if (!isMounted.current) return;
                const token = trustTokenRef.current;
                if (token) {
                    setStatus(MESSAGE_TYPES.VERIFYING);
                    ws.send(JSON.stringify({ type: MESSAGE_TYPES.VALIDATE_SESSION, trustToken: token }));
                } else {
                    setStatus(MESSAGE_TYPES.CONNECTED);
                }
            };

            ws.onclose = () => {
                if (!isMounted.current) return;
                setStatus(MESSAGE_TYPES.DISCONNECTED);
                reconnectTimeoutRef.current = setTimeout(connect, RECONNECT_DELAY);
            };

            ws.onmessage = (event) => {
                try { handleMessage(JSON.parse(event.data)); } 
                catch (e) { console.error("Parse error", e); }
            };

            wsRef.current = ws;
        };

        connect();

        return () => {
            isMounted.current = false;
            wsRef.current?.close();
            clearTimeout(reconnectTimeoutRef.current);
        };
    }, [handleMessage]);

    // Actions
    const pair = (code) => {
        if (isOpen()) {
            send({ type: MESSAGE_TYPES.EXCHANGE_PAIR_KEY, code });
            setStatus(MESSAGE_TYPES.VERIFYING);
        }
    };

    const updateTabState = (tabId, key, value) => {

        if (!isOpen()) {
            toast.error("Not connected to host");
            return;
        }


        setTabsById((prev) => {
            const tab = prev[tabId];
            if (!tab) return prev;
            return {
                ...prev,
                [tabId]: {
                    ...tab,
                    [key]: value,
                    lockedUntil: Date.now() + OPTIMISTIC_LOCK_DURATION 
                }
            };
        });

        send({
            type: MESSAGE_TYPES.STATE_UPDATE,
            intent: MESSAGE_TYPES.INTENT.SET,
            key,
            value,
            tabId
        });
    };

    const selectTab = (tabId) => {
        setActiveTabId(tabId);
        send({ type: MESSAGE_TYPES.SELECT_ACTIVE_TAB, tabId });
    };

    const disconnect = () => {
        setToken(null);
        setStatus(MESSAGE_TYPES.DISCONNECTED);
        wsRef.current?.close();
        globalThis.location.reload(); 
    };

    const openNewTab = (url) => send({ type: MESSAGE_TYPES.NEW_TAB, url });

    return {
        status,
        hostInfo,
        tabsById,
        activeTabId,
        activeTab: activeTabId ? tabsById[activeTabId] : null,
        pair,
        updateTabState,
        selectTab,
        disconnect,
        openNewTab
    };
};