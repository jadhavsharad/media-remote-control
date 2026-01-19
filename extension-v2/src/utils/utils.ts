import { BASE_DOMAINS } from "@/utils/constants";
import { MessageType, MESSAGE_TYPES } from "@/utils/constants";


// Type guards / validators
export function isValidMessageType(action: unknown): action is MessageType {
    return Object.values(MESSAGE_TYPES).includes(action as MessageType);
}

// Media Helpers
export function isMediaUrl(url?: string): boolean {
    if (!url) return false;

    try {
        const { hostname } = new URL(url);
        return BASE_DOMAINS.some(domain => hostname === domain || hostname.includes(`.${domain}`));
    } catch {
        return false;
    }
}
// Browser Detection
export function getBrowser(): string {
    const brands = (navigator as any).userAgentData?.brands?.map((b: any) => b.brand) ?? [];
    if (brands.includes("Microsoft Edge")) return "Edge";
    if (brands.includes("Brave")) return "Brave";
    if (brands.includes("Google Chrome")) return "Chrome";
    if (brands.includes("Chromium")) return "Chromium";
    return "Unknown";
}

// Debounce
export function debouncedScheduler(fn: () => void, delay = 300) {
    let timer: number | null = null;
    return () => {
        if (timer !== null) return;

        timer = window.setTimeout(() => { timer = null; fn(); }, delay);
    };
}
