const express = require('express');
const http = require('http');
const { ExpressPeerServer } = require('peer');
const path = require('path');

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

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Create the HTTP server
const server = http.createServer(app);

// Initialize the PeerServer
// Note: Client uses PeerJS Cloud by default; this server handles self-hosted signaling
const peerServer = ExpressPeerServer(server, {
    debug: process.env.NODE_ENV !== 'production',
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
