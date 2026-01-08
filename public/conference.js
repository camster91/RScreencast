// QuickShare Multi-User Video Conference - JavaScript Module
// This file contains the core logic for multi-peer video conferencing

const QuickShareConference = {
    // State management
    peer: null,
    myPeerId: null,
    roomId: null,
    isHost: false,
    localStream: null,
    screenStream: null,
    peers: new Map(), // peerId -> {call, stream, type}

    // Media state
    isScreenSharing: false,

    // Main display state (for host)
    activeScreenSharePeerId: null,
    mainDisplayStream: null,

    // Helper to get current active stream (screen if sharing)
    getActiveStream() {
        return this.screenStream || new MediaStream();
    },

    // Detect if a stream is a screen share
    isScreenShareStream(stream) {
        if (!stream) return false;
        const videoTrack = stream.getVideoTracks()[0];
        if (!videoTrack) return false;

        // Check track label and settings for screen share indicators
        const label = videoTrack.label.toLowerCase();
        const settings = videoTrack.getSettings();

        console.log('Checking if screen share:', {
            label,
            displaySurface: settings.displaySurface,
            isScreen: label.includes('screen') || settings.displaySurface === 'monitor' || settings.displaySurface === 'window'
        });

        return label.includes('screen') ||
            label.includes('display') ||
            settings.displaySurface === 'monitor' ||
            settings.displaySurface === 'window' ||
            settings.displaySurface === 'browser';
    },

    // Show stream in main display area (host only)
    showInMainDisplay(peerId, stream) {
        if (!this.isHost) return;

        console.log('Showing stream in main display for peer:', peerId);
        this.activeScreenSharePeerId = peerId;
        this.mainDisplayStream = stream;

        const mainVideo = document.getElementById('main-video');
        const welcomeScreen = document.getElementById('welcome-screen');

        if (mainVideo && welcomeScreen) {
            mainVideo.srcObject = stream;
            mainVideo.classList.add('active');
            welcomeScreen.classList.add('hidden');

            mainVideo.onloadedmetadata = () => {
                mainVideo.play().then(() => {
                    console.log('Main display video playing');
                }).catch(e => console.error('Main display autoplay failed:', e));
            };
        }
    },

    // Clear main display and return to welcome screen (host only)
    clearMainDisplay() {
        if (!this.isHost) return;

        console.log('Clearing main display');
        this.activeScreenSharePeerId = null;
        this.mainDisplayStream = null;

        const mainVideo = document.getElementById('main-video');
        const welcomeScreen = document.getElementById('welcome-screen');

        if (mainVideo && welcomeScreen) {
            mainVideo.srcObject = null;
            mainVideo.classList.remove('active');
            welcomeScreen.classList.remove('hidden');
        }
    },


    // Initialize the conference
    async init(roomId, isHost) {
        this.roomId = roomId;
        this.isHost = isHost;

        if (isHost) {
            this.initAsHost();
        } else {
            this.initAsClient();
        }
    },

    // Setup PeerJS connection
    async setupPeer() {
        const isSecure = window.location.protocol === 'https:';
        let customPeerId = undefined;

        if (this.isHost) {
            // Check if we already have an ID or if we should generate one
            // Hosts generate a short ID for easier sharing
            customPeerId = Math.random().toString(36).substring(2, 7).toUpperCase();
            this.myPeerId = customPeerId;
        }

        this.peer = new Peer(customPeerId, {
            host: window.location.hostname,
            port: window.location.port || (isSecure ? 443 : 80),
            path: '/peerjs',
            secure: isSecure,
            debug: 3
        });

        return new Promise((resolve, reject) => {
            this.peer.on('open', (id) => {
                this.myPeerId = id;
                console.log('My peer ID:', id);
                resolve(id);
            });

            this.peer.on('error', (err) => {
                console.error('Peer error:', err);
                reject(err);
            });

            // Handle incoming calls
            this.peer.on('call', (call) => {
                this.handleIncomingCall(call);
            });
        });
    },

    // Get local stream (screen share)
    async getScreenStream() {
        try {
            this.screenStream = await navigator.mediaDevices.getDisplayMedia({
                video: { cursor: "always" },
                audio: true
            });
            this.isScreenSharing = true;
            console.log('Got screen media stream');
            return true;
        } catch (err) {
            console.warn('Error getting screen media:', err);
            return false;
        }
    },

    // Initialize as host
    async initAsHost() {
        await this.setupPeer();
        this.setupUI();

        // Display room code
        const idDisplay = document.getElementById('id-display');
        if (idDisplay) idDisplay.innerText = this.myPeerId;

        const joinUrl = window.location.origin + window.location.pathname + '?room=' + this.myPeerId;
        const urlHelper = document.getElementById('url-helper');
        if (urlHelper) {
            urlHelper.innerHTML = `Go to <strong>${window.location.host}</strong> and enter code <strong>${this.myPeerId}</strong>`;
        }

        const qrContainer = document.getElementById("qrcode");
        if (qrContainer) {
            qrContainer.innerHTML = '';
            new QRCode(qrContainer, { text: joinUrl, width: 180, height: 180 });
        }
    },

    // Initialize as client
    async initAsClient() {
        await this.setupPeer();
        this.setupUI();

        // Auto-join the room
        await this.joinRoom(this.roomId);

        // Show control bar
        const controlBar = document.getElementById('control-bar');
        if (controlBar) controlBar.style.display = 'flex';

        lucide.createIcons();
    },

    // Join a room
    async joinRoom(hostPeerId) {
        console.log('Joining room:', hostPeerId);

        // Call the host with our active stream
        const activeStream = this.getActiveStream();
        console.log('Starting call with stream tracks:', activeStream.getTracks().map(t => t.kind));

        const call = this.peer.call(hostPeerId, activeStream);

        call.on('stream', (remoteStream) => {
            console.log('Received stream from host, tracks:', remoteStream.getTracks().map(t => t.kind));
            this.addPeer(hostPeerId, call, remoteStream, 'host');

            // Listen for track changes (screen share toggle)
            this.setupTrackListeners(hostPeerId, remoteStream);
        });

        call.on('error', (err) => {
            console.error('Call error:', err);
        });
    },

    // Handle incoming call
    handleIncomingCall(call) {
        console.log('Incoming call from:', call.peer);

        // Answer with our current active stream
        const activeStream = this.getActiveStream();
        console.log('Answering call with stream tracks:', activeStream.getTracks().map(t => t.kind));

        call.answer(activeStream);

        call.on('stream', (remoteStream) => {
            console.log('Received stream from:', call.peer, 'tracks:', remoteStream.getTracks().map(t => t.kind));
            this.addPeer(call.peer, call, remoteStream, 'participant');

            // Listen for track changes (screen share toggle)
            this.setupTrackListeners(call.peer, remoteStream);
        });

        call.on('close', () => {
            console.log('Call closed:', call.peer);
            this.removePeer(call.peer);
        });
    },

    // Setup listeners for track changes (screen share toggle)
    setupTrackListeners(peerId, stream) {
        stream.addEventListener('addtrack', (event) => {
            console.log('Track added to stream:', peerId, event.track.kind, event.track.label);
            // Re-evaluate the stream to check if it's now a screen share
            const peerData = this.peers.get(peerId);
            if (peerData) {
                this.addPeer(peerId, peerData.call, stream, peerData.type);
            }
        });

        stream.addEventListener('removetrack', (event) => {
            console.log('Track removed from stream:', peerId, event.track.kind);
            // Re-evaluate the stream
            const peerData = this.peers.get(peerId);
            if (peerData) {
                this.addPeer(peerId, peerData.call, stream, peerData.type);
            }
        });
    },

    // Add a peer to state and UI
    addPeer(peerId, call, stream, type) {
        if (this.peers.has(peerId)) {
            // Update existing peer's stream
            const peerData = this.peers.get(peerId);
            peerData.stream = stream;

            if (this.isHost) {
                console.log('Peer stream updated:', peerId);
                this.showInMainDisplay(peerId, stream);
            }
            return;
        }

        this.peers.set(peerId, { call, stream, type });

        // Route to main display for host
        if (this.isHost) {
            console.log('New peer connected:', peerId);
            this.showInMainDisplay(peerId, stream);
        } else if (type === 'host') {
            // Client view: show host's stream in a simplified way or ignore if host doesn't share
            console.log('Connected to host');
        }
    },

    // Remove a peer
    removePeer(peerId) {
        const peerObj = this.peers.get(peerId);
        if (peerObj) {
            if (peerObj.call) peerObj.call.close();
            this.peers.delete(peerId);

            // If this peer was on main display, clear it
            if (this.isHost && this.activeScreenSharePeerId === peerId) {
                this.clearMainDisplay();
            }
        }
    },

    // UI: Remove peer elements
    removePeerUI(peerId) {
        // No-op in simplified version as we don't have separate tiles
    },


    // Media: Toggle Screen Share
    async toggleScreenShare() {
        if (!this.isScreenSharing) {
            try {
                console.log('Starting screen share...');
                this.screenStream = await navigator.mediaDevices.getDisplayMedia({
                    video: { cursor: "always" },
                    audio: true
                });
                this.isScreenSharing = true;
                console.log('Screen share started with tracks:', this.screenStream.getTracks().map(t => t.kind));

                const btn = document.getElementById('screen-btn');
                if (btn) btn.classList.add('active');

                // Replace video track in all active calls
                const videoTrack = this.screenStream.getVideoTracks()[0];
                if (!videoTrack) {
                    console.error('No video track in screen stream!');
                    this.stopScreenShare();
                    return;
                }

                console.log(`Replacing tracks for ${this.peers.size} peers`);
                this.peers.forEach((p, peerId) => {
                    if (p.call && p.call.peerConnection) {
                        const senders = p.call.peerConnection.getSenders();
                        const sender = senders.find(s => s.track && s.track.kind === 'video');
                        if (sender && sender.track) {
                            console.log('Replacing video track for peer:', peerId);
                            sender.replaceTrack(videoTrack).then(() => {
                                console.log('Track replaced successfully for', peerId);
                            }).catch(err => {
                                console.error('Failed to replace track for', peerId, err);
                            });
                        } else {
                            console.warn('No video sender found for peer:', peerId);
                        }
                    } else {
                        console.warn('Peer connection not available for', peerId);
                    }
                });

                videoTrack.onended = () => {
                    console.log('Screen share ended by user');
                    this.stopScreenShare();
                };
            } catch (err) {
                console.error('Screen share failed:', err);
                alert('Screen sharing failed: ' + err.message);
            }
        } else {
            this.stopScreenShare();
        }
    },

    stopScreenShare() {
        console.log('Stopping screen share...');
        if (this.screenStream) {
            this.screenStream.getTracks().forEach(t => {
                console.log('Stopping track:', t.kind);
                t.stop();
            });
            this.screenStream = null;
        }
        this.isScreenSharing = false;
        const btn = document.getElementById('screen-btn');
        if (btn) btn.classList.remove('active');

        // Restore camera track
        if (this.localStream) {
            const videoTrack = this.localStream.getVideoTracks()[0];
            if (videoTrack) {
                console.log('Restoring camera track to peers');
                this.peers.forEach((p, peerId) => {
                    if (p.call && p.call.peerConnection) {
                        const sender = p.call.peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
                        if (sender) {
                            sender.replaceTrack(videoTrack).then(() => {
                                console.log('Camera track restored for', peerId);
                            }).catch(err => {
                                console.error('Failed to restore camera for', peerId, err);
                            });
                        }
                    }
                });
            } else {
                console.warn('No camera track available to restore');
            }
        }
    },

    // Room: Leave
    leaveRoom() {
        if (this.peer) this.peer.destroy();
        if (this.localStream) this.localStream.getTracks().forEach(t => t.stop());
        if (this.screenStream) this.screenStream.getTracks().forEach(t => t.stop());
        window.location.href = '/';
    },

    setupUI() {
        lucide.createIcons();
    }
};

window.QuickShareConference = QuickShareConference;
