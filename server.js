const express = require('express');
const http = require('http');
const { ExpressPeerServer } = require('peer');
const path = require('path');
const { getTurnServers } = require('./turn');

const app = express();
const port = process.env.PORT || 3000;

// Enable trust proxy for Nginx/reverse proxy environments
app.set('trust proxy', true);

// Security headers
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
});

// Request logging
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
});

// Health check and favicon
app.get('/health', (req, res) => res.send('OK'));
app.get('/favicon.ico', (req, res) => res.status(204).end());

// Client settings: which signaling server to use and extra ICE servers
app.get('/config', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({
        peerServer: process.env.PEER_SERVER === 'self' ? 'self' : 'cloud',
        iceServers: await getTurnServers(),
        debug: process.env.PEERJS_DEBUG === 'true'
    });
});

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
    proxied: true
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
