// End-to-end test: a room PC (host) and presenters in headless Chromium.
//
// Starts server.js with self-hosted signaling, unless BASE is set
// (e.g. BASE=http://localhost:8787/cast to test `wrangler dev`).
// Run with: npm run test:e2e

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require('playwright');

const PORT = process.env.E2E_PORT || 3999;
let BASE = process.env.BASE;
let server = null;
let browser = null;

const CODE_SHOWN = () => /^[A-Z0-9]{5}$/.test(document.getElementById('id-display').innerText);
const PARTICIPANTS_ZERO = () => document.getElementById('participants-btn').dataset.count === '0';

async function waitForServer(url, timeoutMs) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
        try {
            if ((await fetch(url)).ok) return;
        } catch (e) { /* not up yet */ }
        await new Promise(r => setTimeout(r, 200));
    }
    throw new Error(`Server did not start: ${url}`);
}

// Fake screen share (animated canvas + audio tone) and a log of page problems
async function newContext({ blockAutoplay = false, phone = false } = {}) {
    const context = await browser.newContext();
    if (phone) {
        // Phone browsers have no screen sharing
        await context.addInitScript(() => { delete MediaDevices.prototype.getDisplayMedia; });
        return context;
    }
    await context.addInitScript(() => {
        navigator.mediaDevices.getDisplayMedia = async () => {
            const canvas = document.createElement('canvas');
            canvas.width = 320;
            canvas.height = 240;
            const ctx = canvas.getContext('2d');
            let n = 0;
            setInterval(() => { ctx.fillStyle = `hsl(${n++ % 360},80%,50%)`; ctx.fillRect(0, 0, 320, 240); }, 50);
            const stream = canvas.captureStream(20);
            const audio = new AudioContext();
            const osc = audio.createOscillator();
            const dest = audio.createMediaStreamDestination();
            osc.connect(dest);
            osc.start();
            stream.addTrack(dest.stream.getAudioTracks()[0]);
            window.__fakeStream = stream;
            return stream;
        };
    });
    if (blockAutoplay) {
        // Headless Chrome doesn't enforce the autoplay policy, so simulate it:
        // unmuted play() fails until the test "unlocks" sound.
        await context.addInitScript(() => {
            const realPlay = HTMLMediaElement.prototype.play;
            HTMLMediaElement.prototype.play = function () {
                if (!this.muted && !window.__soundUnlocked) {
                    return Promise.reject(new DOMException('blocked', 'NotAllowedError'));
                }
                return realPlay.call(this);
            };
        });
    }
    return context;
}

const problems = [];
function watch(page, label) {
    page.on('pageerror', e => problems.push(`${label} page error: ${e.message}`));
    page.on('console', m => {
        if (/Content Security Policy|Refused to/i.test(m.text())) problems.push(`${label} CSP: ${m.text()}`);
    });
    return page;
}

async function newPresenter(room) {
    const page = watch(await (await newContext()).newPage(), 'presenter');
    await page.goto(`${BASE}/?room=${room}`);
    return page;
}

async function approveNext(host) {
    await host.waitForSelector('#approval-modal.active', { timeout: 15000 });
    await host.click('[data-action="approve"]');
}

test('screen sharing end to end', { timeout: 300000 }, async (t) => {
    if (!BASE) {
        server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
            env: { ...process.env, PORT: String(PORT), PEER_SERVER: 'self' },
            stdio: 'ignore'
        });
        BASE = `http://localhost:${PORT}`;
    }
    t.after(async () => {
        if (browser) await browser.close();
        if (server) server.kill();
    });
    await waitForServer(`${BASE}/health`, 15000);

    browser = await chromium.launch({
        executablePath: process.env.CHROMIUM_PATH || undefined,
        args: ['--disable-features=WebRtcHideLocalIpsWithMdns']
    });

    const hostContext = await newContext({ blockAutoplay: true });
    const host = watch(await hostContext.newPage(), 'host');
    let code;

    await t.test('room PC shows a code, QR code and icons', async () => {
        await host.goto(`${BASE}/`);
        await host.waitForFunction(CODE_SHOWN, null, { timeout: 15000 });
        code = await host.locator('#id-display').innerText();
        assert.ok(await host.locator('#qrcode canvas, #qrcode img').count() > 0, 'QR code drawn');
        assert.ok(await host.locator('svg.lucide').count() > 0, 'icons rendered');
    });

    await t.test('reload keeps the same room code', async () => {
        await host.reload();
        await host.waitForFunction(CODE_SHOWN, null, { timeout: 30000 });
        assert.strictEqual(await host.locator('#id-display').innerText(), code);
    });

    const presenter = await newPresenter(code.toLowerCase());

    await t.test('lowercase link works, codes match, and host can approve', async () => {
        await presenter.click('#join-btn');
        await host.waitForSelector('#approval-modal.active', { timeout: 15000 });
        const shown = await presenter.locator('#my-presenter-code').innerText();
        assert.match(shown, /^[A-Z0-9]{4}$/);
        assert.strictEqual(await host.locator('#requester-code').innerText(), shown);
        await host.click('[data-action="approve"]');
        await presenter.waitForSelector('#share-approved', { state: 'visible', timeout: 10000 });
    });

    await t.test('host plays the shared screen, muted if autoplay is blocked', async () => {
        await presenter.click('#select-screen-btn');
        await presenter.waitForSelector('#share-live', { state: 'visible', timeout: 10000 });
        await host.waitForFunction(() => {
            const v = document.getElementById('remote-video');
            return !v.paused && v.readyState >= 2;
        }, null, { timeout: 15000 });
        assert.ok(await host.evaluate(() => document.getElementById('remote-video').muted), 'muted');
        assert.ok(await host.locator('#unmute-btn').isVisible(), 'unmute button shown');
    });

    await t.test('tap for sound unmutes', async () => {
        await host.evaluate(() => { window.__soundUnlocked = true; });
        await host.click('#unmute-btn');
        assert.ok(!(await host.evaluate(() => document.getElementById('remote-video').muted)));
        assert.ok(!(await host.locator('#unmute-btn').isVisible()));
    });

    await t.test('"End share" on the room screen stops the presenter', async () => {
        await host.mouse.move(200, 200);
        await host.click('[data-action="stop-viewing"]');
        await host.waitForSelector('#room-pc-setup', { state: 'visible', timeout: 5000 });
        await presenter.waitForSelector('#share-ended', { state: 'visible', timeout: 5000 });
        assert.match(await presenter.locator('#ended-message').innerText(), /room screen ended/);
        assert.strictEqual(await presenter.evaluate(() => window.__fakeStream.getVideoTracks()[0].readyState), 'ended');
        await presenter.click('#share-ended [data-action="share-screen"]');
        await host.waitForSelector('#media-container', { state: 'visible', timeout: 15000 });
    });

    await t.test('stop sharing returns the host to idle', async () => {
        await presenter.click('[data-action="stop-sharing"]');
        await host.waitForSelector('#room-pc-setup', { state: 'visible', timeout: 5000 });
    });

    await t.test('browser "stop sharing" bar returns the host to idle', async () => {
        await presenter.click('#share-ended [data-action="share-screen"]');
        await host.waitForSelector('#media-container', { state: 'visible', timeout: 15000 });
        await presenter.evaluate(() => window.__fakeStream.getVideoTracks()[0].dispatchEvent(new Event('ended')));
        await host.waitForSelector('#room-pc-setup', { state: 'visible', timeout: 5000 });
    });

    await t.test('closing the presenter tab removes them', async () => {
        await presenter.click('#share-ended [data-action="share-screen"]');
        await host.waitForSelector('#media-container', { state: 'visible', timeout: 15000 });
        await presenter.close({ runBeforeUnload: true });
        await host.waitForFunction(PARTICIPANTS_ZERO, null, { timeout: 30000 });
        assert.ok(await host.locator('#room-pc-setup').isVisible());
    });

    await t.test('denied presenter is told, and cannot choose their own name', async () => {
        const p = await newPresenter(code);
        // Wait for the page to connect before tampering with its connection
        await p.waitForFunction(() => typeof peer !== 'undefined' && peer && peer.open, null, { timeout: 15000 });
        // A modified client tries to pose as someone trustworthy
        await p.evaluate(() => {
            const realConnect = peer.connect.bind(peer);
            peer.connect = (...args) => {
                const conn = realConnect(...args);
                const realSend = conn.send.bind(conn);
                conn.send = (data) => realSend(data && data.type === 'join-request' ? { ...data, name: 'IT Support' } : data);
                return conn;
            };
        });
        await p.click('#join-btn');
        await host.waitForSelector('#approval-modal.active', { timeout: 15000 });
        assert.match(await host.locator('#requester-name').innerText(), /^Presenter [A-Z0-9]{4}$/);
        await host.click('[data-action="deny"]');
        await p.waitForSelector('#share-denied', { state: 'visible', timeout: 5000 });
        await p.context().close();
    });

    await t.test('locked room turns presenters away', async () => {
        await host.click('#floating-controls [data-action="toggle-room-lock"]');
        assert.match(await host.locator('#floating-controls .lock-room-btn').innerText(), /Room locked/);
        const p = await newPresenter(code);
        await p.click('#join-btn');
        await p.waitForSelector('#share-denied', { state: 'visible', timeout: 10000 });
        assert.match(await p.locator('#denied-message').innerText(), /locked/);
        await p.context().close();
        await host.click('#floating-controls [data-action="toggle-room-lock"]');
        assert.match(await host.locator('#floating-controls .lock-room-btn').innerText(), /Lock room/);
    });

    await t.test('security headers are sent', async () => {
        const res = await fetch(`${BASE}/`);
        assert.match(res.headers.get('content-security-policy') || '', /script-src 'self'/);
        assert.match(res.headers.get('permissions-policy') || '', /display-capture=\(self\)/);
        const crossSite = await fetch(`${BASE}/config`, { headers: { 'Sec-Fetch-Site': 'cross-site' } });
        assert.strictEqual(crossSite.status, 403);
    });

    await t.test('removed presenter is told', async () => {
        const p = await newPresenter(code);
        await p.click('#join-btn');
        await approveNext(host);
        await p.click('#select-screen-btn');
        await host.waitForSelector('#media-container', { state: 'visible', timeout: 15000 });
        await host.evaluate(() => document.getElementById('peer-panel').classList.add('visible'));
        await host.click('#peer-list [data-action="kick"]');
        await p.waitForSelector('#share-kicked', { state: 'visible', timeout: 5000 });
        assert.ok(await host.locator('#room-pc-setup').isVisible());
        await p.context().close();
    });

    await t.test('presenter that vanishes (crash, Wi-Fi drop) is removed', async () => {
        const p = await newPresenter(code);
        await p.click('#join-btn');
        await approveNext(host);
        await p.click('#select-screen-btn');
        await host.waitForSelector('#media-container', { state: 'visible', timeout: 15000 });
        await p.context().close();
        await host.waitForFunction(PARTICIPANTS_ZERO, null, { timeout: 45000 });
        assert.ok(await host.locator('#room-pc-setup').isVisible());
    });

    await t.test('presenter is told when the room PC goes away', async () => {
        const p = await newPresenter(code);
        await p.click('#join-btn');
        await approveNext(host);
        await p.click('#select-screen-btn');
        await p.waitForSelector('#share-live', { state: 'visible' });
        await hostContext.close();
        await p.waitForSelector('#share-error', { state: 'visible', timeout: 45000 });
        await p.context().close();
    });

    await t.test('unknown room code shows an error', async () => {
        const p = await newPresenter('ZZZZZ');
        await p.click('#join-btn');
        await p.waitForSelector('#share-error', { state: 'visible', timeout: 15000 });
        assert.match(await p.locator('#error-message').innerText(), /wasn't found/);
        await p.context().close();
    });

    await t.test('/join page takes a code, even from a pasted link', async () => {
        const p = watch(await (await newContext()).newPage(), 'joiner');
        await p.goto(`${BASE}/join`);
        assert.ok(await p.locator('#manual-input').isVisible());
        assert.ok(!(await p.locator('#manual-join-view .phone-note').isVisible()), 'no phone warning on a computer');
        await p.click('#join-submit-btn');
        assert.match(await p.locator('#join-error').innerText(), /code/);
        await p.fill('#manual-input', 'https://example.com/cast/?room=ab2cd');
        assert.strictEqual(await p.inputValue('#manual-input'), 'AB2CD');
        await p.press('#manual-input', 'Enter');
        await p.waitForURL(/\?room=AB2CD$/);
        assert.ok(await p.locator('#join-btn').isVisible());
        await p.context().close();
    });

    await t.test('phones are told to use a computer before asking to join', async () => {
        const p = watch(await (await newContext({ phone: true })).newPage(), 'phone');
        await p.goto(`${BASE}/?room=${code}`);
        assert.ok(await p.locator('#share-unsupported').isVisible());
        assert.ok(!(await p.locator('#join-btn').isVisible()));
        assert.match(await p.locator('#share-unsupported').innerText(), new RegExp(`/join and enter ${code}`));
        await p.context().close();
    });

    await t.test('no page errors or security policy violations', () => {
        assert.deepStrictEqual(problems, []);
    });
});
