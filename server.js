const express = require('express');
const { ExpressPeerServer } = require('peer');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

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
    path: '/signal'
});

app.use('/peerjs', peerServer);
