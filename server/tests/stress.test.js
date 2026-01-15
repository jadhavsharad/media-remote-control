const WebSocket = require('ws');
const { server, wss, stopCleanup } = require('../index');

let TEST_PORT;
let TEST_URL;

beforeAll((done) => {
    server.listen(0, () => {
        TEST_PORT = server.address().port;
        TEST_URL = `ws://localhost:${TEST_PORT}`;
        done();
    });
});

const clients = [];

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

const waitForMessage = (socket, type) => new Promise((resolve) => {
    const handler = (data) => {
        const msg = JSON.parse(data.toString());
        if (!type || msg.type === type) socket.off('message', handler), resolve(msg);
    };
    socket.on('message', handler);
});

describe('Remote Control Server Stress Tests', () => {
    test('Should handle Host registration', async () => {
        const host = createClient();
        await waitForOpen(host);

        host.send(JSON.stringify({ type: 'REGISTER_HOST' }));
        const msg = await waitForMessage(host, 'HOST_REGISTERED');

        expect(msg.type).toBe('HOST_REGISTERED');
        expect(msg.SESSION_IDENTITY).toBeDefined();
        expect(msg.hostToken).toBeDefined();
        host.close();
    });

    test('Should perform full pairing flow', async () => {
        const host = createClient();
        await waitForOpen(host);
        host.send(JSON.stringify({ type: 'REGISTER_HOST' }));
        const hostReg = await waitForMessage(host, 'HOST_REGISTERED');
        const sessionId = hostReg.SESSION_IDENTITY;
        host.send(JSON.stringify({ type: 'REQUEST_PAIR_CODE' }));
        const pairMsg = await waitForMessage(host, 'PAIR_CODE');
        expect(pairMsg.code).toBeDefined();
        const code = pairMsg.code;
        const remote = createClient();
        await waitForOpen(remote);
        remote.send(JSON.stringify({ type: 'EXCHANGE_PAIR_CODE', code }));
        const pairSuccess = await waitForMessage(remote, 'PAIR_SUCCESS');
        expect(pairSuccess.trustToken).toBeDefined();
        expect(pairSuccess.sessionId).toBe(sessionId);
        host.close();
        remote.close();
    });

    test('Should handle Host Reconnection', async () => {
        const host = createClient();
        await waitForOpen(host);
        host.send(JSON.stringify({ type: 'REGISTER_HOST' }));
        const reg1 = await waitForMessage(host, 'HOST_REGISTERED');
        const { hostToken, SESSION_IDENTITY: sessionId } = reg1;
        host.close();
        const host2 = createClient();
        await waitForOpen(host2);
        host2.send(JSON.stringify({ type: 'REGISTER_HOST', hostToken }));
        const reg2 = await waitForMessage(host2, 'HOST_REGISTERED');
        expect(reg2.SESSION_IDENTITY).toBe(sessionId);
        expect(reg2.hostToken).toBe(hostToken);

        host2.close();
    });

    test('Should Load Test with 1000 Remotes', async () => {
        const NUM_REMOTES = 1000;

        const host = createClient();
        await waitForOpen(host);
        host.send(JSON.stringify({ type: 'REGISTER_HOST' }));
        const hostReg = await waitForMessage(host, 'HOST_REGISTERED');

        const remotes = [];

        for (let i = 0; i < NUM_REMOTES; i++) {
            host.send(JSON.stringify({ type: 'REQUEST_PAIR_CODE' }));
            const pairMsg = await waitForMessage(host, 'PAIR_CODE');

            const remote = createClient();
            await waitForOpen(remote);

            remote.send(JSON.stringify({
                type: 'EXCHANGE_PAIR_CODE',
                code: pairMsg.code
            }));

            const msg = await waitForMessage(remote, 'PAIR_SUCCESS');
            remotes.push(remote);
        }


        await new Promise(r => setTimeout(r, 1000));

        const remotePromises = remotes.map((remote, i) => {
            return new Promise(resolve => {
                const payload = { type: 'CONTROL_EVENT', action: 'play', id: i };
                remote.send(JSON.stringify(payload));
                resolve();
            });
        });

        let receivedCount = 0;
        const hostPromise = new Promise(resolve => {
            const handler = (data) => {
                const msg = JSON.parse(data.toString());
                if (msg.type === 'CONTROL_EVENT') {
                    receivedCount++;
                    if (receivedCount === NUM_REMOTES) {
                        host.off('message', handler);
                        resolve();
                    }
                }
            };
            host.on('message', handler);
        });

        await Promise.all([hostPromise, ...remotePromises]);
        expect(receivedCount).toBe(NUM_REMOTES);

    }, 60000); 
});
