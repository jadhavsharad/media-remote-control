import { BASE_DOMAINS, MESSAGE_TYPES } from "@/utils/constants";

// Type guards / validators
export function isValidMessageType(action) {
    return Object.values(MESSAGE_TYPES).includes(action);
}

// Media Helpers
export function isMediaUrl(url) {
    if (!url) return false;

    try {
        const { hostname } = new URL(url);
        return BASE_DOMAINS.some(domain => hostname === domain || hostname.includes(`.${domain}`));
    } catch {
        return false;
    }
}

// Browser Detection
export function getBrowser() {
    const brands = navigator.userAgentData?.brands?.map(b => b.brand) ?? [];
    if (brands.includes("Microsoft Edge")) return "Edge";
    if (brands.includes("Brave")) return "Brave";
    if (brands.includes("Google Chrome")) return "Chrome";
    if (brands.includes("Chromium")) return "Chromium";
    return "Unknown";
}

// Debounce
export function debouncedScheduler(fn, delay = 300) {
    let timer = null;
    return () => {
        if (timer !== null) return;
        timer = window.setTimeout(() => { timer = null; fn(); }, delay);
    };
}