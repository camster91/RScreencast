// Cloudflare Workers version of server.js.
//
// - Serves the app page and /config (with Cloudflare TURN credentials)
// - Runs PeerJS signaling in a Durable Object, so no PeerJS Cloud is needed.
//   It speaks the same protocol as the `peer` npm package used by server.js.

import { DurableObject } from 'cloudflare:workers';
import indexHtml from '../public/index.html';
import appCss from '../public/app.css';
import appJs from '../public/app.js';
import iconsJs from '../public/icons.js';
import peerJs from '../public/vendor/peerjs.min.js';
import qrcodeJs from '../public/vendor/qrcode.min.js';
import { getTurnServers } from '../turn.js';
import { SECURITY_HEADERS } from '../headers.js';

const PEERJS_KEY = 'peerjs';
// Same ID rule as the PeerJS client
const VALID_ID = /^[A-Za-z0-9]+(?:[ _-][A-Za-z0-9]+)*$/;
// Message types relayed from one peer to another
const RELAYED_TYPES = new Set(['OFFER', 'ANSWER', 'CANDIDATE', 'LEAVE']);
const HEARTBEAT = JSON.stringify({ type: 'HEARTBEAT' });

// Files from public/, bundled into the Worker as text
const JS = 'text/javascript; charset=utf-8';
const STATIC_FILES = {
    '/': { body: indexHtml, type: 'text/html; charset=utf-8' },
    '/index.html': { body: indexHtml, type: 'text/html; charset=utf-8' },
    '/app.css': { body: appCss, type: 'text/css; charset=utf-8' },
    '/app.js': { body: appJs, type: JS },
    '/icons.js': { body: iconsJs, type: JS },
    '/vendor/peerjs.min.js': { body: peerJs, type: JS, cache: 'public, max-age=86400' },
    '/vendor/qrcode.min.js': { body: qrcodeJs, type: JS, cache: 'public, max-age=86400' }
};

function json(data, init = {}) {
    return new Response(JSON.stringify(data), {
        ...init,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...SECURITY_HEADERS, ...init.headers }
    });
}

// The app can also be served from a folder, e.g. rotmanav.ca/cast/
const BASE_PREFIX = '/cast';

export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        if (url.pathname === BASE_PREFIX) {
            return Response.redirect(`${url.origin}${BASE_PREFIX}/${url.search}`, 301);
        }
        const path = url.pathname.startsWith(`${BASE_PREFIX}/`)
            ? url.pathname.slice(BASE_PREFIX.length)
            : url.pathname;

        // Old addresses (REDIRECT_HOSTS) send visitors to CANONICAL_URL
        const redirectHosts = (env.REDIRECT_HOSTS || '').split(',').map(h => h.trim()).filter(Boolean);
        if (env.CANONICAL_URL && redirectHosts.includes(url.hostname) && (path === '/' || path === '/index.html')) {
            return Response.redirect(env.CANONICAL_URL + url.search, 301);
        }

        const file = STATIC_FILES[path];
        if (file) {
            return new Response(file.body, {
                headers: { 'Content-Type': file.type, 'Cache-Control': file.cache || 'no-cache', ...SECURITY_HEADERS }
            });
        }

        if (path === '/health') {
            return new Response('OK');
        }

        if (path === '/favicon.ico') {
            return new Response(null, { status: 204 });
        }

        if (path === '/config') {
            return json({
                peerServer: 'self',
                iceServers: await getTurnServers(env),
                debug: env.PEERJS_DEBUG === 'true'
            });
        }

        // PeerJS client asks for a random ID (presenters)
        if (path === `/${PEERJS_KEY}/id`) {
            return new Response(crypto.randomUUID(), {
                headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' }
            });
        }

        // Peer discovery is turned off, same as the `peer` package default
        if (path === `/${PEERJS_KEY}/peers`) {
            return new Response('Not Found', { status: 404 });
        }

        // PeerJS signaling WebSocket. One Durable Object handles every room.
        if (path === '/peerjs') {
            if (request.headers.get('Upgrade') !== 'websocket') {
                return new Response('Expected WebSocket', { status: 426 });
            }
            const stub = env.SIGNALING.get(env.SIGNALING.idFromName('global'));
            return stub.fetch(request);
        }

        return new Response('Not Found', { status: 404 });
    }
};

export class SignalingServer extends DurableObject {
    constructor(ctx, env) {
        super(ctx, env);
        // Answer heartbeats without waking the object (keeps it cheap)
        this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(HEARTBEAT, HEARTBEAT));
    }

    async fetch(request) {
        const url = new URL(request.url);
        const key = url.searchParams.get('key');
        const id = url.searchParams.get('id');
        const token = url.searchParams.get('token');

        const pair = new WebSocketPair();
        const [client, server] = Object.values(pair);

        const reject = (type, msg) => {
            server.accept();
            server.send(JSON.stringify({ type, payload: { msg } }));
            server.close(1000, msg);
            return new Response(null, { status: 101, webSocket: client });
        };

        if (key !== PEERJS_KEY) return reject('INVALID-KEY', 'Invalid key provided');
        if (!id || !token || !VALID_ID.test(id) || id.length > 64) return reject('ERROR', 'Invalid id or token');

        // Same ID with a different token belongs to someone else.
        // Same token means the same peer reconnecting: replace the old socket.
        for (const existing of this.ctx.getWebSockets(id)) {
            const info = existing.deserializeAttachment();
            if (info && info.token !== token) {
                return reject('ID-TAKEN', 'ID is taken');
            }
            try { existing.close(1000, 'Replaced by new connection'); } catch (e) { /* already closed */ }
        }

        this.ctx.acceptWebSocket(server, [id]);
        server.serializeAttachment({ id, token });
        server.send(JSON.stringify({ type: 'OPEN' }));

        return new Response(null, { status: 101, webSocket: client });
    }

    async webSocketMessage(ws, raw) {
        let message;
        try {
            message = JSON.parse(raw);
        } catch (e) {
            return;
        }
        if (!message || typeof message !== 'object') return;

        const { id: src } = ws.deserializeAttachment() || {};
        const { type, dst, payload } = message;
        if (!src || !RELAYED_TYPES.has(type) || typeof dst !== 'string') return;

        const targets = this.ctx.getWebSockets(dst);
        if (targets.length === 0) {
            // Tell the sender the peer isn't there (client shows "peer-unavailable")
            if (type !== 'LEAVE') {
                ws.send(JSON.stringify({ type: 'EXPIRE', src: dst, dst: src }));
            }
            return;
        }

        const data = JSON.stringify({ type, src, dst, payload });
        for (const target of targets) {
            try { target.send(data); } catch (e) { /* closing */ }
        }
    }

    async webSocketClose(ws, code, reason) {
        try { ws.close(code, reason); } catch (e) { /* already closed */ }
    }

    async webSocketError(ws) {
        try { ws.close(1011, 'Error'); } catch (e) { /* already closed */ }
    }
}
