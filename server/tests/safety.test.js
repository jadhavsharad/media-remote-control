const WebSocket = require('ws');
const { server, wss, stopCleanup } = require('../index');

let TEST_PORT;
let TEST_URL;
const clients = [];

beforeAll((done) => {
    server.listen(0, () => {
        TEST_PORT = server.address().port;
        TEST_URL = `ws://localhost:${TEST_PORT}`;
        done();
    });
});

afterAll((done) => {
    clients.forEach(c => c.terminate());
    stopCleanup();
    wss.close(() => {
        server.close(done);
    });
});

const createClient = () => {
    const ws = new WebSocket(TEST_URL);
    clients.push(ws);
    return ws;
};

const waitForOpen = (socket) => new Promise((resolve) => {
    if (socket.readyState === WebSocket.OPEN) return resolve();
    socket.on('open', resolve);
});

const waitForMessage = (socket, type, timeout = 2000) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
        socket.off('message', handler);
        reject(new Error(`Timeout waiting for ${type}`));
    }, timeout);

    const handler = (data) => {
        try {
            const msg = JSON.parse(data.toString());
            if (!type || msg.type === type) {
                clearTimeout(timer);
                socket.off('message', handler);
                resolve(msg);
            }
        } catch (e) {
            // Ignore parse errors here
        }
    };
    socket.on('message', handler);
});

describe('Safety & Security Tests', () => {

    describe('A. INPUT SAFETY & CRASH RESISTANCE', () => {
        test('A1. Invalid JSON Does Not Crash Server', async () => {
            const client = createClient();
            await waitForOpen(client);

            client.send('This is not JSON');
            client.send('{ "truncated": true');

            const checkClient = createClient();
            await waitForOpen(checkClient);
            checkClient.terminate();

            client.terminate();
        });

        test('A2. Empty Message Ignored', async () => {
            const client = createClient();
            await waitForOpen(client);

            client.send('{}');
            client.send('null');

            const checkClient = createClient();
            await waitForOpen(checkClient);
            checkClient.terminate();
            client.terminate();
        });

        test('A3. Unknown Message Type Ignored', async () => {
            const client = createClient();
            await waitForOpen(client);

            client.send(JSON.stringify({ type: 'UNKNOWN_EVENT_XYZ' }));

            try {
                await waitForMessage(client, 'ANY', 200);
                fail('Should not receive response for unknown message');
            } catch (e) {
                // Expected timeout
            }
            client.terminate();
        });
    });

    describe('B. PROTOCOL ABUSE & SECURITY', () => {
        test('B1. Remote Cannot Register as Host', async () => {

            const host = createClient();
            await waitForOpen(host);
            host.send(JSON.stringify({ type: 'REGISTER_HOST' }));
            const reg = await waitForMessage(host, 'HOST_REGISTERED');

            host.send(JSON.stringify({ type: 'REQUEST_PAIR_CODE' }));
            const pair = await waitForMessage(host, 'PAIR_CODE');

            const remote = createClient();
            await waitForOpen(remote);
            remote.send(JSON.stringify({ type: 'EXCHANGE_PAIR_CODE', code: pair.code }));
            await waitForMessage(remote, 'PAIR_SUCCESS');

            remote.send(JSON.stringify({ type: 'REGISTER_HOST' }));

            const closed = new Promise(resolve => remote.on('close', resolve));

            const r = await Promise.race([
                closed.then(() => 'closed'),
                waitForMessage(remote, 'HOST_REGISTERED', 500).then(() => 'registered').catch(() => 'timeout')
            ]);

            if (r === 'registered') fail('Remote was allowed to switch to Host role');


            host.terminate();
            remote.terminate();
        });

        test('B2. Remote Cannot Request Pair Code', async () => {
            const client = createClient();
            await waitForOpen(client);
            client.send(JSON.stringify({ type: 'REQUEST_PAIR_CODE' }));

            try {
                await waitForMessage(client, 'PAIR_CODE', 200);
                fail('Should not receive pair code without being host');
            } catch (e) {
                // Expected
            }
            client.terminate();
        });

        test('B3. Remote Cannot Send MEDIA_TABS_LIST', async () => {
            const host = createClient();
            await waitForOpen(host);
            host.send(JSON.stringify({ type: 'REGISTER_HOST' }));
            const reg = await waitForMessage(host, 'HOST_REGISTERED');

            host.send(JSON.stringify({ type: 'REQUEST_PAIR_CODE' }));
            const pair = await waitForMessage(host, 'PAIR_CODE');

            const remote = createClient();
            await waitForOpen(remote);
            remote.send(JSON.stringify({ type: 'EXCHANGE_PAIR_CODE', code: pair.code }));
            await waitForMessage(remote, 'PAIR_SUCCESS');


            remote.send(JSON.stringify({ type: 'MEDIA_TABS_LIST', tabs: [] }));

            try {
                await waitForMessage(host, 'MEDIA_TABS_LIST', 200);
                fail('Host should not receive MEDIA_TABS_LIST from Remote');
            } catch (e) {
                // Expected
            }

            host.terminate();
            remote.terminate();
        });

    });

    describe('C. PAIR CODE EDGE CASES', () => {
        test('C1. Pair Code Is Single-Use', async () => {
            const host = createClient();
            await waitForOpen(host);
            host.send(JSON.stringify({ type: 'REGISTER_HOST' }));
            const reg = await waitForMessage(host, 'HOST_REGISTERED');

            host.send(JSON.stringify({ type: 'REQUEST_PAIR_CODE' }));
            const pairMsg = await waitForMessage(host, 'PAIR_CODE');
            const code = pairMsg.code;
            const r1 = createClient();
            await waitForOpen(r1);
            r1.send(JSON.stringify({ type: 'EXCHANGE_PAIR_CODE', code }));
            await waitForMessage(r1, 'PAIR_SUCCESS');

            const r2 = createClient();
            await waitForOpen(r2);
            r2.send(JSON.stringify({ type: 'EXCHANGE_PAIR_CODE', code }));
            try {
                const msg = await waitForMessage(r2, 'PAIR_FAILED', 1000);
                expect(msg.type).toBe('PAIR_FAILED');
            } catch (e) {
                fail('Should have received PAIR_FAILED for reused code');
            }

            host.terminate();
            r1.terminate();
            r2.terminate();
        });

        test('C3. Invalid Pair Code', async () => {
            const r1 = createClient();
            await waitForOpen(r1);
            r1.send(JSON.stringify({ type: 'EXCHANGE_PAIR_CODE', code: 'INVALID' }));

            const msg = await waitForMessage(r1, 'PAIR_FAILED');
            expect(msg.type).toBe('PAIR_FAILED');
            r1.terminate();
        });
    });

    describe('D. TRUST TOKEN & IDENTITY SAFETY', () => {
        test('D1. Invalid Trust Token', async () => {
            const client = createClient();
            await waitForOpen(client);

            client.send(JSON.stringify({
                type: 'VALIDATE_SESSION',
                trustToken: 'invalid-token-uuid'
            }));

            const msg = await waitForMessage(client, 'SESSION_INVALID');
            expect(msg.type).toBe('SESSION_INVALID');
            client.terminate();
        });

        test('D3. Trust Token Hijack Kicks Old Remote', async () => {
            const host = createClient();
            await waitForOpen(host);
            host.send(JSON.stringify({ type: 'REGISTER_HOST' }));
            await waitForMessage(host, 'HOST_REGISTERED');
            host.send(JSON.stringify({ type: 'REQUEST_PAIR_CODE' }));
            const { code } = await waitForMessage(host, 'PAIR_CODE');

            const r1 = createClient();
            await waitForOpen(r1);
            r1.send(JSON.stringify({ type: 'EXCHANGE_PAIR_CODE', code }));
            const { trustToken } = await waitForMessage(r1, 'PAIR_SUCCESS');

            const r2 = createClient();
            await waitForOpen(r2);
            r2.send(JSON.stringify({ type: 'VALIDATE_SESSION', trustToken }));
            await waitForMessage(r2, 'SESSION_VALID');

            await new Promise(r => setTimeout(r, 500));

            if (r1.readyState === WebSocket.OPEN) {
                fail('Old remote socket should be closed after hijack');
            }

            host.terminate();
            r1.terminate();
            r2.terminate();
        });
    });

    describe('E. SESSION RECOVERY EDGE CASES', () => {
        test('E1. Host Reconnect Takes Over Existing Socket', async () => {
            const h1 = createClient();
            await waitForOpen(h1);
            h1.send(JSON.stringify({ type: 'REGISTER_HOST' }));
            const reg = await waitForMessage(h1, 'HOST_REGISTERED');
            const { hostToken } = reg;

            const h2 = createClient();
            await waitForOpen(h2);
            h2.send(JSON.stringify({ type: 'REGISTER_HOST', hostToken }));
            const reg2 = await waitForMessage(h2, 'HOST_REGISTERED');
            expect(reg2.SESSION_IDENTITY).toBe(reg.SESSION_IDENTITY);

            await new Promise(r => setTimeout(r, 500));

            if (h1.readyState === WebSocket.OPEN) {
                fail('Old host socket should be closed after takeover');
            }

            h1.terminate();
            h2.terminate();
        });

        test('E2. Remote Reconnect While Host Offline', async () => {
            const host = createClient();
            await waitForOpen(host);
            host.send(JSON.stringify({ type: 'REGISTER_HOST' }));
            const reg = await waitForMessage(host, 'HOST_REGISTERED');

            host.send(JSON.stringify({ type: 'REQUEST_PAIR_CODE' }));
            const pair = await waitForMessage(host, 'PAIR_CODE');

            const remote = createClient();
            await waitForOpen(remote);
            remote.send(JSON.stringify({ type: 'EXCHANGE_PAIR_CODE', code: pair.code }));
            const success = await waitForMessage(remote, 'PAIR_SUCCESS');

            host.close();
            await new Promise(r => setTimeout(r, 200));

            const r2 = createClient();
            await waitForOpen(r2);
            r2.send(JSON.stringify({ type: 'VALIDATE_SESSION', trustToken: success.trustToken }));
            const val = await waitForMessage(r2, 'SESSION_VALID');
            expect(val.sessionId).toBe(reg.SESSION_IDENTITY);

            remote.terminate();
            r2.terminate();
        });
    });

    describe('G. RATE LIMITING & FLOOD CONTROL', () => {
        test('G1. Rate Limit Drops Messages', async () => {
            const host = createClient();
            await waitForOpen(host);
            host.send(JSON.stringify({ type: 'REGISTER_HOST' }));
            await waitForMessage(host, 'HOST_REGISTERED');

            host.send(JSON.stringify({ type: 'REQUEST_PAIR_CODE' }));
            const pair = await waitForMessage(host, 'PAIR_CODE');
            const remote = createClient();
            await waitForOpen(remote);
            remote.send(JSON.stringify({ type: 'EXCHANGE_PAIR_CODE', code: pair.code }));
            await waitForMessage(remote, 'PAIR_SUCCESS');

            const events = [
                { type: 'CONTROL_EVENT', id: 1 },
                { type: 'CONTROL_EVENT', id: 2 },
                { type: 'CONTROL_EVENT', id: 3 }
            ];

            events.forEach(e => remote.send(JSON.stringify(e)));

            const received = [];
            const listener = (data) => {
                const msg = JSON.parse(data.toString());
                if (msg.type === 'CONTROL_EVENT') received.push(msg);
            };
            host.on('message', listener);

            await new Promise(r => setTimeout(r, 1000));
            host.off('message', listener);

            expect(received.length).toBeLessThan(3);
            expect(received.length).toBeGreaterThanOrEqual(1);

            host.terminate();
            remote.terminate();
        });
    });

    describe('I. MULTI-SESSION ISOLATION', () => {
        test('I1. Two Hosts Do Not Share State', async () => {
            // Host A
            const hA = createClient();
            await waitForOpen(hA);
            hA.send(JSON.stringify({ type: 'REGISTER_HOST' }));
            const regA = await waitForMessage(hA, 'HOST_REGISTERED');

            // Host B
            const hB = createClient();
            await waitForOpen(hB);
            hB.send(JSON.stringify({ type: 'REGISTER_HOST' }));
            const regB = await waitForMessage(hB, 'HOST_REGISTERED');

            expect(regA.SESSION_IDENTITY).not.toBe(regB.SESSION_IDENTITY);

            // Pair Remote A to Host A
            hA.send(JSON.stringify({ type: 'REQUEST_PAIR_CODE' }));
            const pairA = await waitForMessage(hA, 'PAIR_CODE');
            const rA = createClient();
            await waitForOpen(rA);
            rA.send(JSON.stringify({ type: 'EXCHANGE_PAIR_CODE', code: pairA.code }));
            await waitForMessage(rA, 'PAIR_SUCCESS');

            // Remote A sends message. Host B should NOT receive it.
            rA.send(JSON.stringify({ type: 'CONTROL_EVENT', id: 'A' }));

            // Check Host A receives it
            const msgA = await waitForMessage(hA, 'CONTROL_EVENT');
            expect(msgA.id).toBe('A');

            let bGotMsg = false;
            const hBListener = () => bGotMsg = true;
            hB.on('message', hBListener);

            await new Promise(r => setTimeout(r, 300));
            hB.off('message', hBListener);
            expect(bGotMsg).toBe(false);

            hA.terminate();
            hB.terminate();
            rA.terminate();
        });
    });

    describe('J. REGRESSION SAFETY', () => {
        test('J1. Server Survives Rapid Connect/Disconnect', async () => {
            const iterations = 50;
            const promises = [];
            for (let i = 0; i < iterations; i++) {
                promises.push((async () => {
                    const ws = createClient();
                    await waitForOpen(ws);
                    ws.send(JSON.stringify({ type: 'REGISTER_HOST' }));
             
                    ws.close();
                })());
            }

            await Promise.all(promises);

   
            const check = createClient();
            await waitForOpen(check);
            check.send(JSON.stringify({ type: 'REGISTER_HOST' }));
            await waitForMessage(check, 'HOST_REGISTERED');
            check.terminate();
        });
    });
    describe('K. CONCURRENCY & SCALE', () => {
        test('K1. Mass Concurrency (10 Hosts, 2 Remotes)', async () => {
            const NUM_HOSTS = 10;
            const REMOTES_PER_HOST = 2;
            const sessions = [];

   
            for (let i = 0; i < NUM_HOSTS; i++) {
                const host = createClient();
                await waitForOpen(host);
                host.send(JSON.stringify({ type: 'REGISTER_HOST' }));
                const reg = await waitForMessage(host, 'HOST_REGISTERED');

 
                host.send(JSON.stringify({ type: 'REQUEST_PAIR_CODE' }));
                const pair = await waitForMessage(host, 'PAIR_CODE');

                sessions.push({
                    host,
                    sessionId: reg.SESSION_IDENTITY,
                    pairCode: pair.code,
                    remotes: []
                });
            }


            for (const session of sessions) {
                for (let j = 0; j < REMOTES_PER_HOST; j++) {
      
                    await new Promise(r => setTimeout(r, 500));

   
                    session.host.send(JSON.stringify({ type: 'REQUEST_PAIR_CODE' }));
                    const pair = await waitForMessage(session.host, 'PAIR_CODE', 5000);

                    const remote = createClient();
                    remote.on('error', (e) => { });
                    await waitForOpen(remote);

                    const successProm = waitForMessage(remote, 'PAIR_SUCCESS', 10000);
                    remote.send(JSON.stringify({ type: 'EXCHANGE_PAIR_CODE', code: pair.code }));

                    try {
                        const success = await successProm;
                        expect(success.sessionId).toBe(session.sessionId);
                        session.remotes.push({ socket: remote, trustToken: success.trustToken });
                    } catch (e) {
                        throw e;
                    }
                }
            }

            const messagePromises = [];

            for (const session of sessions) {
                const hostReceived = [];
                const listener = (data) => {
                    const msg = JSON.parse(data.toString());
                    if (msg.type === 'CONTROL_EVENT') hostReceived.push(msg);
                };
                session.host.on('message', listener);
                session.hostListener = listener; 

                session.remotes.forEach((r, index) => {
                    r.socket.send(JSON.stringify({ type: 'CONTROL_EVENT', id: `s${session.sessionId}-r${index}` }));
                });
            }


            await new Promise(r => setTimeout(r, 1000));

            for (const session of sessions) {
                session.host.off('message', session.hostListener);

            }

            const receivedMap = new Map(); 

            sessions.forEach(s => {
                receivedMap.set(s.sessionId, new Set());
                s.host.on('message', (data) => {
                    try {
                        const msg = JSON.parse(data.toString());
                        if (msg.type === 'CONTROL_EVENT') {
                            receivedMap.get(s.sessionId).add(msg.id);
                        }
                    } catch (e) { }
                });
            });

            for (const session of sessions) {
                session.remotes.forEach((r, index) => {
                    r.socket.send(JSON.stringify({ type: 'CONTROL_EVENT', id: `s${session.sessionId}-r${index}` }));
                });
            }

            await new Promise(r => setTimeout(r, 1000));

            for (const session of sessions) {
                const received = receivedMap.get(session.sessionId);
                expect(received.size).toBe(REMOTES_PER_HOST);
                session.remotes.forEach((r, index) => {
                    const expectedId = `s${session.sessionId}-r${index}`;
                    if (!received.has(expectedId)) {
                        fail(`Host ${session.sessionId} missing message ${expectedId}`);
                    }
                });
            }

            sessions.forEach(s => {
                s.host.terminate();
                s.remotes.forEach(r => r.socket.terminate());
            });
        }, 15000); 

    });
});
