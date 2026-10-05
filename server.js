const express = require('express');
const rateLimit = require('express-rate-limit');
const http = require('http');
const { ExpressPeerServer } = require('peer');
const path = require('path');
const { getTurnServers } = require('./turn');
const { SECURITY_HEADERS, isCrossSiteRequest } = require('./headers');

const app = express();

const port = process.env.PORT || 3000;

// Which reverse proxies may tell us the visitor's IP (X-Forwarded-For).
// Off by default, so visitors can't fake their IP to dodge the rate limit.
// Behind one proxy (Nginx, Traefik, Coolify) set TRUST_PROXY=1.
function parseTrustProxy(value) {
    if (!value || value === 'false') return false;
    if (value === 'true') return true;
    if (/^\d+$/.test(value)) return parseInt(value, 10);
    return value; // IPs or subnets, e.g. "loopback, 10.0.0.0/8"
}
const trustProxy = parseTrustProxy(process.env.TRUST_PROXY);
app.set('trust proxy', trustProxy);

// Requests per minute from one IP. A whole office can share one IP, so
// these are generous; /config is lower because it hands out TURN credentials.
function limitPerMinute(name, fallback) {
    const value = parseInt(process.env[name], 10);
    return value > 0 ? value : fallback;
}
function limiter(max) {
    return rateLimit({
        windowMs: 60 * 1000,
        limit: max,
        standardHeaders: 'draft-7',
        legacyHeaders: false,
        message: { error: 'Too many requests. Try again in a minute.' }
    });
}

// Security headers
app.use((req, res, next) => {
    res.set(SECURITY_HEADERS);
    next();
});

// Request logging
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
});

// Health check (not rate limited, so uptime checks always work)
app.get('/health', (req, res) => res.send('OK'));

app.use(limiter(limitPerMinute('RATE_LIMIT_PER_MINUTE', 300)));
app.use('/config', limiter(limitPerMinute('CONFIG_RATE_LIMIT_PER_MINUTE', 60)));

app.get('/favicon.ico', (req, res) => res.status(204).end());

// Client settings: which signaling server to use and extra ICE servers
app.get('/config', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (isCrossSiteRequest(name => req.get(name))) {
        return res.status(403).json({ error: 'Forbidden' });
    }
    res.json({
        peerServer: process.env.PEER_SERVER === 'self' ? 'self' : 'cloud',
        iceServers: await getTurnServers(),
        debug: process.env.PEERJS_DEBUG === 'true'
    });
});

// Presenters type /join to enter a room code
app.get('/join', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Create the HTTP server
const server = http.createServer(app);

// Initialize the PeerServer
// Used by the client when PEER_SERVER=self (needs WebSocket support from the host/proxy).
// Otherwise the client uses PeerJS Cloud.
const peerServer = ExpressPeerServer(server, {
    debug: process.env.PEERJS_DEBUG === 'true',
    path: '/',
    proxied: Boolean(trustProxy)
});

// Mount signaling server
app.use(peerServer);

// Start listening after all middleware is registered
server.listen(port, () => {
    console.log(`================================================`);
    console.log(`QuickShare Hub is running at http://localhost:${port}`);
    console.log(`================================================`);
});

// Handle server errors
server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`Port ${port} is already in use`);
    } else {
        console.error('Server error:', err);
    }
    process.exit(1);
});

// Graceful shutdown
function shutdown() {
    console.log('Shutting down gracefully...');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
    // Force close after 10s if graceful shutdown fails
    setTimeout(() => {
        console.error('Forced shutdown after timeout');
        process.exit(1);
    }, 10000);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
