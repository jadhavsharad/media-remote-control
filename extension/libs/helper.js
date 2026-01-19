import { isMediaUrl } from "@/utils/utils";
import { CHANNELS, CONTROL_EVENTS, MESSAGE_TYPES } from "./constants";
import { warn } from "@/utils/log";

/** * @typedef {import('./constants').Channel} Channel
 * @typedef {import('./constants').MessagePayload} MessagePayload 
 */

let connected = false;
let sessionIdentity = null;
let hostToken = null;

const offscreenPath = "content.tsx";
const remoteContext = new Map();

// State helpers
export function setConnectionState(state) {
    connected = state;
}

export function getConnectionState() {
    return connected;
}

export function getSessionIdentity() {
    return sessionIdentity;
}

export function getHostToken() {
    return hostToken;
}

// Lifecycle hooks
export function onStart(fn) {
    chrome.runtime.onStartup.addListener(fn);
}

export function onInstall(fn) {
    chrome.runtime.onInstalled.addListener(fn);
}

export function onTabCreated(fn) {
    chrome.tabs.onCreated.addListener(() => void fn());
}

export function onTabRemoved(fn) {
    chrome.tabs.onRemoved.addListener((tabId) => void fn(tabId));
}

export function onTabUpdated(fn) {
    chrome.tabs.onUpdated.addListener((tabId) => void fn(tabId));
}

// Connection management
export function onConnected(newSessionIdentity, newHostToken) {
    sessionIdentity = newSessionIdentity;
    hostToken = newHostToken;
    connected = true;

    chrome.storage.local.set({ sessionIdentity, hostToken, connected });
}

export function onDisconnected() {
    connected = false;
}

export function onDestroy() {
    connected = false;
    sessionIdentity = null;
    hostToken = null;
    remoteContext.clear();
    chrome.storage.local.set({ sessionIdentity: null, hostToken: null, connected });
}

// Tabs & media
export async function getMediaList() {
    const tabs = await chrome.tabs.query({});
    return tabs
        .filter(tab => isMediaUrl(tab.url))
        .map(tab => ({
            tabId: tab.id,
            title: tab.title ?? "",
            url: tab.url,
            favIconUrl: tab.favIconUrl ?? null,
            muted: tab.mutedInfo?.muted ?? false,
        }));
}

export async function validateTab(tabId) {
    try {
        await chrome.tabs.get(tabId);
        return true;
    } catch {
        return false;
    }
}

export async function getTab(ctx) {
    if (!ctx.tabId) throw new Error("No tab");

    try {
        return await chrome.tabs.get(ctx.tabId);
    } catch {
        ctx.tabId = null;
        throw new Error("Tab not found");
    }
}

// Script injection
export async function executeScript(tabId) {
    await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content.js"],
        injectImmediately: true
    });
}

export async function injectContentScript() {
    const mediaTabs = await getMediaList();
    const failedTabs = [];

    for (const tab of mediaTabs) {
        try {
            await executeScript(tab.tabId);
        } catch (err) {
            warn(`Failed to inject into tab ${tab.tabId}: ${err}`);
            failedTabs.push(tab);
        }
    }

    if (failedTabs.length > 0) {
        sendMessage(CHANNELS.TO_POPUP, {
            type: MESSAGE_TYPES.SCRIPT_INJECTION_FAIL,
            failedTabs,
        });
    }
}

// Messaging
/**
 * @param {Channel} channel
 * @param {MessagePayload} payload
 */
export async function sendMessage(channel, payload) {
    try {
        await chrome.runtime.sendMessage({ type: channel, payload });
    } catch {
        // receiver might be gone
    }
}

export function receiveMessage(channel, handler) {
    chrome.runtime.onMessage.addListener((msg, _, sendResponse) => {
        if (!msg || msg.type !== channel) return;
        return handler(msg.payload, sendResponse);
    });
}

// Offscreen document
async function ensureOffscreen() {
    if (await chrome.offscreen.hasDocument()) return;

    await chrome.offscreen.createDocument({
        url: offscreenPath,
        reasons: ["BLOBS"],
        justification: "Persistent WebSocket connection",
    });
}

export async function sendToServer(payload) {
    await ensureOffscreen();
    await sendMessage(CHANNELS.TO_OFFSCREEN, payload);
}

// Context cleanup
export function clearTabContext(tabId) {
    for (const ctx of remoteContext.values()) {
        if (ctx.tabId === tabId) {
            ctx.tabId = null;
        }
    }
}

// Control handlers
export const CONTROL_HANDLERS = {
    [CONTROL_EVENTS.TOGGLE_MUTE]: async (ctx) => {
        const tab = await getTab(ctx);
        const muted = !tab.mutedInfo?.muted;
        await chrome.tabs.update(ctx.tabId, { muted });
        sendToServer({ type: CONTROL_EVENTS.STATE_UPDATE, muted });
    },
};

export async function handleControlEvent(ctx, payload) {
    if (!ctx.tabId) return;

    const handler = CONTROL_HANDLERS[payload.type];
    try {
        if (handler) {
            await handler(ctx);
        } else {
            await chrome.tabs.sendMessage(ctx.tabId, payload);
        }
    } catch (err) {
        console.warn("Control event failed:", payload.type, err);
        ctx.tabId = null;
    }
}