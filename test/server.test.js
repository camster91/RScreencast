// Rate limiting and TRUST_PROXY on the Node.js server (server.js)
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { spawn } = require('child_process');

let nextPort = 4100 + Math.floor(Math.random() * 500);

async function startServer(env) {
    const port = nextPort++;
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
        env: { ...process.env, PORT: String(port), ...env },
        stdio: 'ignore'
    });
    const base = `http://127.0.0.1:${port}`;
    const end = Date.now() + 10000;
    while (Date.now() < end) {
        try {
            if ((await fetch(`${base}/health`)).ok) return { base, stop: () => child.kill() };
        } catch (e) { /* not up yet */ }
        await new Promise(r => setTimeout(r, 100));
    }
    child.kill();
    throw new Error('server did not start');
}

async function statuses(url, count, headers = () => ({})) {
    const result = [];
    for (let i = 0; i < count; i++) {
        result.push((await fetch(url, { headers: headers(i) })).status);
    }
    return result;
}

test('too many requests from one IP get 429, health checks never do', async (t) => {
    const server = await startServer({ RATE_LIMIT_PER_MINUTE: '5' });
    t.after(server.stop);

    assert.deepStrictEqual(await statuses(`${server.base}/app.css`, 6), [200, 200, 200, 200, 200, 429]);
    assert.deepStrictEqual(await statuses(`${server.base}/health`, 3), [200, 200, 200]);
});

test('/config has its own lower limit', async (t) => {
    const server = await startServer({ CONFIG_RATE_LIMIT_PER_MINUTE: '2' });
    t.after(server.stop);

    assert.deepStrictEqual(await statuses(`${server.base}/config`, 3), [200, 200, 429]);
    assert.strictEqual((await fetch(`${server.base}/app.css`)).status, 200);
});

test('without TRUST_PROXY, a faked X-Forwarded-For does not get around the limit', async (t) => {
    const server = await startServer({ RATE_LIMIT_PER_MINUTE: '3' });
    t.after(server.stop);

    const fakeIp = (i) => ({ 'X-Forwarded-For': `203.0.113.${i}` });
    assert.deepStrictEqual(await statuses(`${server.base}/app.css`, 4, fakeIp), [200, 200, 200, 429]);
});

test('with TRUST_PROXY=1, visitors behind the proxy are counted separately', async (t) => {
    const server = await startServer({ RATE_LIMIT_PER_MINUTE: '1', TRUST_PROXY: '1' });
    t.after(server.stop);

    const visitor = (i) => ({ 'X-Forwarded-For': `203.0.113.${i}` });
    assert.deepStrictEqual(await statuses(`${server.base}/app.css`, 3, visitor), [200, 200, 200]);
    assert.deepStrictEqual(await statuses(`${server.base}/app.css`, 2, () => visitor(0)), [429, 429]);
});
