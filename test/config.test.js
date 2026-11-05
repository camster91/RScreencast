const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function harness(responses) {
    const source = fs.readFileSync(require.resolve('../public/app.js'), 'utf8');
    const timers = [];
    const created = [];
    const sandbox = {
        console: { warn() {}, error() {} },
        BASE_PATH: '/cast/', DEFAULT_ICE_SERVERS: [],
        window: { location: { protocol: 'https:', hostname: 'room.example', port: '' } },
        isHosting: true, hostRoomCode: 'ABCDE', peerOptions: null, peer: null,
        configRetryTimer: null, configAttempts: 0, configStarting: false,
        fetch: async () => {
            const next = responses.shift();
            if (next instanceof Error) throw next;
            return next;
        },
        setTimeout(fn, delay) { timers.push({ fn, delay }); return timers.length; },
        clearTimeout() {}, showHostStatus() {}, showJoinAddress() {},
        createPeer(id) { created.push({ id, host: sandbox.peerOptions.host }); }
    };
    vm.createContext(sandbox);
    const start = source.indexOf('async function loadConfig()');
    const end = source.indexOf('function createPeer(', start);
    vm.runInContext(source.slice(start, end), sandbox);
    const refresh = source.slice(source.indexOf('async function refreshIceServers()'), source.indexOf('function showJoinAddress('));
    vm.runInContext(refresh, sandbox);
    return { sandbox, timers, created };
}

const ok = (body) => ({ ok: true, json: async () => body });

test('failed initial configuration never creates a peer on another service and retries', async () => {
    const h = harness([{ ok: false, status: 503 }, ok({ peerServer: 'self' })]);
    await h.sandbox.startConfiguredPeer();
    assert.equal(h.created.length, 0);
    assert.equal(h.timers.length, 1);
    await h.timers.shift().fn();
    assert.deepEqual(h.created, [{ id: 'ABCDE', host: 'room.example' }]);
});

test('malformed configuration is retried rather than interpreted as PeerJS Cloud', async () => {
    const h = harness([ok({}), ok({ peerServer: 'cloud' })]);
    await h.sandbox.startConfiguredPeer();
    assert.equal(h.created.length, 0);
    await h.timers.shift().fn();
    assert.equal(h.created.length, 1);
    assert.equal(h.created[0].host, undefined);
});

test('failed credential refresh preserves the configured peer and its last ICE servers', async () => {
    const h = harness([new Error('offline')]);
    h.sandbox.peerOptions = { host: 'room.example', config: { iceServers: ['previous'] } };
    h.sandbox.peer = { options: { config: { iceServers: ['previous'] } } };
    await h.sandbox.refreshIceServers();
    assert.equal(h.sandbox.peerOptions.host, 'room.example');
    assert.deepEqual(h.sandbox.peerOptions.config.iceServers, ['previous']);
    assert.equal(h.created.length, 0);
});

test('repeated failures use bounded backoff and permit a later recovery', async () => {
    const h = harness([...Array.from({ length: 8 }, () => ({ ok: false, status: 503 })), ok({ peerServer: 'self' })]);
    await h.sandbox.startConfiguredPeer();
    for (let i = 0; i < 7; i++) await h.timers.shift().fn();
    assert.equal(h.created.length, 0);
    assert.equal(h.timers.length, 1);
    assert.equal(h.timers[0].delay, 30000);
    await h.timers.shift().fn();
    assert.deepEqual(h.created, [{ id: 'ABCDE', host: 'room.example' }]);
    assert.equal(h.timers.length, 0);
});
