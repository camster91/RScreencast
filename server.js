const express = require('express');
const { ExpressPeerServer } = require('peer');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// Request logging to see what hits the server
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
});

// Basic route for favicon - PLACED AT TOP
app.get('/favicon.ico', (req, res) => res.status(204).end());

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Create the HTTP server
const server = app.listen(port, () => {
    console.log(`================================================`);
    console.log(`QuickShare Hub is running at http://localhost:${port}`);
    console.log(`================================================`);
});

// Initialize the PeerServer for WebRTC signaling
const peerServer = ExpressPeerServer(server, {
    debug: true,
    path: '/'
});

app.use('/peerjs', peerServer);
