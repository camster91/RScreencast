const express = require('express');
const { ExpressPeerServer } = require('peer');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Basic route for favicon to prevent 404s
app.get('/favicon.ico', (req, res) => res.status(204).end());

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
