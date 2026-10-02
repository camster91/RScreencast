const test = require('node:test');
const assert = require('node:assert');
const { getTurnServers, resetTurnCache } = require('../turn');

const realFetch = global.fetch;
const CF_ENV = { CLOUDFLARE_TURN_KEY_ID: 'key123', CLOUDFLARE_TURN_API_TOKEN: 'secret' };

function mockFetch(handler) {
    const calls = [];
    global.fetch = async (url, options) => {
        calls.push({ url, options });
        return handler(url, options);
    };
    return calls;
}

function jsonResponse(status, body) {
    return { ok: status >= 200 && status < 300, status, json: async () => body };
}

test.afterEach(() => {
    global.fetch = realFetch;
    resetTurnCache();
});

test('no TURN settings returns an empty list', async () => {
    assert.deepStrictEqual(await getTurnServers({}), []);
});

test('fixed TURN settings are passed through', async () => {
    const servers = await getTurnServers({
        TURN_URLS: 'turn:a.example:3478, turns:a.example:5349',
        TURN_USERNAME: 'u',
        TURN_CREDENTIAL: 'p'
    });
    assert.deepStrictEqual(servers, [{
        urls: ['turn:a.example:3478', 'turns:a.example:5349'],
        username: 'u',
        credential: 'p'
    }]);
});

test('Cloudflare credentials are requested, port 53 URLs dropped, and cached', async () => {
    const calls = mockFetch(() => jsonResponse(201, {
        iceServers: [
            { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53'] },
            {
                urls: [
                    'turn:turn.cloudflare.com:3478?transport=udp',
                    'turn:turn.cloudflare.com:53?transport=udp',
                    'turns:turn.cloudflare.com:443?transport=tcp'
                ],
                username: 'user',
                credential: 'cred'
            }
        ]
    }));

    const servers = await getTurnServers(CF_ENV);
    assert.deepStrictEqual(servers, [
        { urls: ['stun:stun.cloudflare.com:3478'] },
        {
            urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turns:turn.cloudflare.com:443?transport=tcp'],
            username: 'user',
            credential: 'cred'
        }
    ]);

    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].url, 'https://rtc.live.cloudflare.com/v1/turn/keys/key123/credentials/generate-ice-servers');
    assert.strictEqual(calls[0].options.headers.Authorization, 'Bearer secret');
    assert.deepStrictEqual(JSON.parse(calls[0].options.body), { ttl: 21600 });

    // Second call uses the cache
    await getTurnServers(CF_ENV);
    assert.strictEqual(calls.length, 1);
});

test('concurrent requests share one Cloudflare call', async () => {
    const calls = mockFetch(() => jsonResponse(201, { iceServers: [{ urls: 'turn:x:3478', username: 'a', credential: 'b' }] }));
    await Promise.all([getTurnServers(CF_ENV), getTurnServers(CF_ENV), getTurnServers(CF_ENV)]);
    assert.strictEqual(calls.length, 1);
});

test('Cloudflare failure falls back to fixed TURN settings', async () => {
    mockFetch(() => jsonResponse(401, {}));
    const servers = await getTurnServers({ ...CF_ENV, TURN_URLS: 'turn:backup:3478' });
    assert.deepStrictEqual(servers, [{ urls: ['turn:backup:3478'], username: undefined, credential: undefined }]);
});

test('Cloudflare failure with no fallback returns an empty list', async () => {
    mockFetch(() => { throw new Error('network down'); });
    assert.deepStrictEqual(await getTurnServers(CF_ENV), []);
});
