const express = require('express');
const { ExpressPeerServer } = require('peer');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// Enable trust proxy for Hostinger/Nginx environments
app.set('trust proxy', true);

// Request logging
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
});

const http = require('http');

// Health check and favicon
app.get('/health', (req, res) => res.send('OK'));
app.get('/favicon.ico', (req, res) => res.status(204).end());

// Create the HTTP server
const server = http.createServer(app);
server.listen(port, () => {
    console.log(`================================================`);
    console.log(`QuickShare Hub is running at http://localhost:${port}`);
    console.log(`================================================`);
});

// Initialize the PeerServer
const peerServer = ExpressPeerServer(server, {
    debug: true,
    path: '/peerjs',
    proxied: true
});

// Mount signaling server BEFORE static files
app.use('/peerjs', peerServer);

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));
