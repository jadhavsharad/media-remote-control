import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { axe } from 'vitest-axe';

// Mock WebSocket
const WS_URL = "ws://10.134.24.59:3001";
let mockWebSocket;

class MockWebSocket {
    constructor(url) {
        this.url = url;
        this.readyState = WebSocket.CONNECTING;
        this.send = vi.fn();
        this.close = vi.fn();
        this.onopen = null;
        this.onclose = null;
        this.onerror = null;
        this.onmessage = null;
        mockWebSocket = this;

        // Simulate async connection
        setTimeout(() => {
            act(() => {
                this.readyState = WebSocket.OPEN;
                if (this.onopen) this.onopen();
            });
        }, 50);
    }
}

globalThis.WebSocket = MockWebSocket;
globalThis.WebSocket.CONNECTING = 0;
globalThis.WebSocket.OPEN = 1;
globalThis.WebSocket.CLOSING = 2;
globalThis.WebSocket.CLOSED = 3;

// Mock Html5QrcodeScanner
const mockScannerRender = vi.fn();
const mockScannerClear = vi.fn().mockResolvedValue(true);

vi.mock("html5-qrcode", () => {
    return {
        Html5QrcodeScanner: vi.fn(function () {
            return {
                render: mockScannerRender,
                clear: mockScannerClear,
            };
        }),
    };
});

// Helper to trigger WS message
const triggerWsMessage = (data) => {
    act(() => {
        if (mockWebSocket && mockWebSocket.onmessage) {
            mockWebSocket.onmessage({ data: JSON.stringify(data) });
        }
    });
};

describe('App Component Comprehensive Tests', () => {
    let user;

    beforeEach(() => {
        user = userEvent.setup(); // Use real timers
        localStorage.clear();
        mockScannerRender.mockClear();
        mockScannerClear.mockClear();

        // Reset mockWebSocket
        mockWebSocket = null;
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe('1. Initial State & Rendering', () => {
        it('should render "Scanning" state initially (no token)', async () => {
            render(<App />);
            expect(screen.getByText("Remote Control")).toBeInTheDocument();

            // Check status indicator
            await waitFor(() => expect(screen.getByTestId("status-indicator")).toHaveTextContent("Scanning"));
            expect(screen.getByTestId("scanner-container")).toBeInTheDocument();

            // Wait for scanner to be initialized
            await waitFor(() => expect(mockScannerRender).toHaveBeenCalled());
        });

        it('should render "Connecting" if token exists', async () => {
            localStorage.setItem("trust_token", "existing-token");
            render(<App />);

            // Use fallback assertion for race condition, checking status indicator specifically
            await waitFor(() => {
                const statusText = screen.getByTestId("status-indicator").textContent;
                expect(statusText).toMatch(/Connecting|Verifying/);
            });
        });
    });

    describe('2. WebSocket Logic & Connection Flow', () => {
        it('should connect and verify session with existing token', async () => {
            localStorage.setItem("trust_token", "valid-token");
            render(<App />);

            await waitFor(() => {
                expect(mockWebSocket).toBeDefined();
                expect(mockWebSocket.send).toHaveBeenCalledWith(JSON.stringify({
                    type: "VALIDATE_SESSION",
                    trustToken: "valid-token"
                }));
                expect(screen.getByTestId("status-indicator")).toHaveTextContent("Verifying");
            });

            // Server responds valid
            triggerWsMessage({ type: "SESSION_VALID" });

            await waitFor(() => expect(screen.getByTestId("status-indicator")).toHaveTextContent("Paired"));
        });

        it('should handle invalid session by clearing token and going to Scanning', async () => {
            localStorage.setItem("trust_token", "invalid-token");
            render(<App />);

            await waitFor(() => {
                expect(screen.getByTestId("status-indicator")).toHaveTextContent("Verifying");
            });

            triggerWsMessage({ type: "SESSION_INVALID" });

            await waitFor(() => {
                expect(localStorage.getItem("trust_token")).toBeNull();
                expect(screen.getByTestId("status-indicator")).toHaveTextContent("Scanning");
            });
        });

        it('should handle Pairing Success flow', async () => {
            render(<App />);

            await waitFor(() => expect(mockScannerRender).toHaveBeenCalled());
            const onScanSuccess = mockScannerRender.mock.calls[0][0];

            act(() => {
                onScanSuccess("some-pair-code");
            });

            await waitFor(() => {
                expect(mockWebSocket.send).toHaveBeenCalledWith(JSON.stringify({
                    type: "EXCHANGE_PAIR_CODE",
                    code: "some-pair-code"
                }));
                expect(screen.getByTestId("status-indicator")).toHaveTextContent("Verifying");
            });

            triggerWsMessage({ type: "PAIR_SUCCESS", trustToken: "new-token" });

            await waitFor(() => {
                expect(localStorage.getItem("trust_token")).toBe("new-token");
                expect(screen.getByTestId("status-indicator")).toHaveTextContent("Paired");
            });
        });

        it('should handle Pairing Failed flow', async () => {
            render(<App />);

            await waitFor(() => expect(mockScannerRender).toHaveBeenCalled());
            const onScanSuccess = mockScannerRender.mock.calls[0][0];

            const alertMock = vi.spyOn(window, 'alert').mockImplementation(() => { });

            act(() => { onScanSuccess("bad-code"); });

            triggerWsMessage({ type: "PAIR_FAILED" });

            await waitFor(() => {
                expect(alertMock).toHaveBeenCalledWith("Pairing failed");
                expect(screen.getByTestId("status-indicator")).toHaveTextContent("Scanning");
            });
            alertMock.mockRestore();
        });

        it('should handle Host Disconnection', async () => {
            localStorage.setItem("trust_token", "valid");
            render(<App />);

            await waitFor(() => expect(screen.getByTestId("status-indicator")).toHaveTextContent("Verifying"));
            triggerWsMessage({ type: "SESSION_VALID" });
            await waitFor(() => expect(screen.getByTestId("status-indicator")).toHaveTextContent("Paired"));

            triggerWsMessage({ type: "HOST_DISCONNECTED" });

            await waitFor(() => {
                expect(screen.getByTestId("status-indicator")).toHaveTextContent("Waiting");
                expect(screen.getByText(/Waiting for host/i)).toBeInTheDocument();
            });
        });
    });

    describe('3. User Interactions & Logic', () => {
        beforeEach(async () => {
            localStorage.setItem("trust_token", "valid");
            render(<App />);
            await waitFor(() => expect(screen.getByTestId("status-indicator")).toHaveTextContent("Verifying"));
            triggerWsMessage({ type: "SESSION_VALID" });
            await waitFor(() => expect(screen.getByTestId("status-indicator")).toHaveTextContent("Paired"));
        });

        it('should display media tabs and allow selection', async () => {
            const tabs = [
                { tabId: 1, title: "YouTube Music" },
                { tabId: 2, title: "Spotify" }
            ];
            triggerWsMessage({ type: "MEDIA_TABS_LIST", tabs });

            await waitFor(() => {
                expect(screen.getByText("YouTube Music")).toBeInTheDocument();
                expect(screen.getByText("Spotify")).toBeInTheDocument();
            });

            await user.click(screen.getByText("YouTube Music"));

            await waitFor(() => {
                expect(mockWebSocket.send).toHaveBeenCalledWith(JSON.stringify({
                    type: "SELECT_ACTIVE_TAB",
                    tabId: 1
                }));
            });
        });

        it('should toggle playback state', async () => {
            const tabs = [{ tabId: 1, title: "Music" }];
            triggerWsMessage({ type: "MEDIA_TABS_LIST", tabs });

            await waitFor(() => expect(screen.getByText("Music")).toBeInTheDocument());
            await user.click(screen.getByText("Music"));

            await user.click(screen.getByTestId("play-pause-btn"));

            await waitFor(() => {
                expect(mockWebSocket.send).toHaveBeenCalledWith(JSON.stringify({
                    type: "CONTROL_EVENT",
                    action: "TOGGLE_PLAYBACK"
                }));
            });
        });

        it('should update playback state from server', async () => {
            expect(screen.getByTestId("play-pause-btn")).toHaveTextContent("▶ Play");

            triggerWsMessage({ type: "STATE_UPDATE", state: "PLAYING" });

            await waitFor(() => expect(screen.getByTestId("play-pause-btn")).toHaveTextContent("⏸ Pause"));
        });

        it('should handle Unpair', async () => {
            await user.click(screen.getByTestId("unpair-btn"));

            await waitFor(() => {
                expect(localStorage.getItem("trust_token")).toBeNull();
                expect(screen.getByTestId("status-indicator")).toHaveTextContent("Scanning");
            });
        });
    });

    describe('4. Security & XSS', () => {
        it('should escape malicious content in tab titles (XSS Prevention)', async () => {
            localStorage.setItem("trust_token", "valid");
            render(<App />);
            await waitFor(() => expect(screen.getByTestId("status-indicator")).toHaveTextContent("Verifying"));
            triggerWsMessage({ type: "SESSION_VALID" });
            await waitFor(() => expect(screen.getByTestId("status-indicator")).toHaveTextContent("Paired"));

            const maliciousTabs = [
                { tabId: 1, title: "<img src=x onerror=alert(1)>" }
            ];

            triggerWsMessage({ type: "MEDIA_TABS_LIST", tabs: maliciousTabs });

            await waitFor(() => {
                expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeInTheDocument();
                const img = document.querySelector('img[onerror="alert(1)"]');
                expect(img).toBeNull();
            });
        });
    });

    describe('5. Error Handling & Edge Cases', () => {
        it('should gracefully handle malformed JSON messages', async () => {
            render(<App />);
            await waitFor(() => expect(mockWebSocket).toBeDefined());

            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { });

            act(() => {
                if (mockWebSocket.onmessage) {
                    mockWebSocket.onmessage({ data: "INVALID_JSON_{{{" });
                }
            });

            expect(consoleSpy).toHaveBeenCalledWith("Invalid WS message", expect.any(Error));
            consoleSpy.mockRestore();
        });

        it('should handle network jitter (disconnect/reconnect)', async () => {
            localStorage.setItem("trust_token", "valid");
            render(<App />);
            await waitFor(() => expect(screen.getByTestId("status-indicator")).toHaveTextContent("Verifying"));

            // Disconnect
            act(() => { mockWebSocket.onclose(); });

            await waitFor(() => expect(screen.getByTestId("status-indicator")).toHaveTextContent("Disconnected"));
        });
    });

    describe('6. Performance & Memory Leaks', () => {
        it('should cleanup WebSocket and Scanner on unmount', async () => {
            const { unmount } = render(<App />);

            await waitFor(() => expect(mockScannerRender).toHaveBeenCalled());

            const wsCloseSpy = mockWebSocket.close;

            unmount();

            expect(wsCloseSpy).toHaveBeenCalled();
            expect(mockScannerClear).toHaveBeenCalled();
        });
    });

    describe('7. Accessibility', () => {
        it('should have no accessibility violations in Paired state', async () => {
            localStorage.setItem("trust_token", "valid");
            const { container } = render(<App />);

            await waitFor(() => expect(screen.getByTestId("status-indicator")).toHaveTextContent("Verifying"));

            triggerWsMessage({ type: "SESSION_VALID" });

            await waitFor(() => expect(screen.getByTestId("status-indicator")).toHaveTextContent("Paired"));

            const results = await axe(container);
            expect(results).toHaveNoViolations();
        });

        it('should have no accessibility violations in Scanning state', async () => {
            const { container } = render(<App />);

            await waitFor(() => expect(screen.getByTestId("status-indicator")).toHaveTextContent("Scanning"));
            await waitFor(() => expect(mockScannerRender).toHaveBeenCalled());

            const results = await axe(container);
            expect(results).toHaveNoViolations();
        });
    });
});
