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
    isMicEnabled: true,
    isCameraEnabled: true,
    isScreenSharing: false,

    // Main display state (for host)
    activeScreenSharePeerId: null,
    mainDisplayStream: null,

    // Helper to get current active stream (screen if sharing, else camera)
    getActiveStream() {
        if (this.isScreenSharing && this.screenStream) {
            return this.screenStream;
        }
        return this.localStream || new MediaStream();
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

        // Setup peer connection
        await this.setupPeer();

        // Get local media
        await this.getLocalMedia();

        // Setup UI
        this.setupUI();

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

    // Get local camera and microphone
    async getLocalMedia() {
        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({
                video: true,
                audio: true
            });
            console.log('Got local media stream with tracks:', this.localStream.getTracks().map(t => `${t.kind}:${t.label}`));
            return true;
        } catch (err) {
            console.warn('Error getting local media:', err.name, err.message);
            // Create a silent/black stream as fallback
            console.log('Creating empty fallback stream');
            this.localStream = new MediaStream();
            return false;
        }
    },

    // Initialize as host
    initAsHost() {
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
            qrContainer.innerHTML = ''; // Clear previous QR
            new QRCode(qrContainer, { text: joinUrl, width: 180, height: 180 });
        }

        // Show local webcam preview
        const roomWebcam = document.getElementById('room-webcam');
        if (roomWebcam && this.localStream) {
            roomWebcam.srcObject = this.localStream;
        }

        // Show control bar
        const controlBar = document.getElementById('control-bar');
        if (controlBar) controlBar.style.display = 'flex';

        lucide.createIcons();
    },

    // Initialize as client
    async initAsClient() {
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

            // Check if this is a stream change (e.g., screen share toggle)
            if (this.isHost) {
                if (this.isScreenShareStream(stream)) {
                    console.log('Peer started screen sharing:', peerId);
                    this.showInMainDisplay(peerId, stream);
                } else if (this.activeScreenSharePeerId === peerId) {
                    console.log('Peer stopped screen sharing:', peerId);
                    this.clearMainDisplay();
                }
            }
            return;
        }

        this.peers.set(peerId, { call, stream, type });

        // Route to appropriate display
        if (this.isHost) {
            // Check if this is a screen share
            if (this.isScreenShareStream(stream)) {
                console.log('New peer with screen share:', peerId);
                this.showInMainDisplay(peerId, stream);
            }
            // Always add to sidebar (even if screen sharing)
            this.addToParticipantsGrid(peerId, stream);
        } else {
            this.renderPeer(peerId, stream, type);
        }
    },

    // Remove a peer
    removePeer(peerId) {
        const peerObj = this.peers.get(peerId);
        if (peerObj) {
            if (peerObj.call) peerObj.call.close();
            this.peers.delete(peerId);
            this.removePeerUI(peerId);

            // If this peer was screen sharing on main display, clear it
            if (this.isHost && this.activeScreenSharePeerId === peerId) {
                console.log('Screen sharing peer disconnected, clearing main display');
                this.clearMainDisplay();
            }
        }
    },

    // Render peer video based on role
    renderPeer(peerId, stream, type) {
        if (this.isHost) {
            // Host view: add to participants grid
            this.addToParticipantsGrid(peerId, stream);
        } else {
            // Client view: create floating window if it's the host's stream
            if (type === 'host') {
                this.createFloatingWindow(peerId, stream, 'Meeting Room');
            } else {
                // Other participants in grid
                this.addToParticipantsGrid(peerId, stream);
            }
        }
    },

    // UI: Add to participants grid
    addToParticipantsGrid(peerId, stream) {
        const grid = document.getElementById('participants-grid');
        if (!grid) return;

        let tile = document.getElementById(`peer-${peerId}`);
        if (!tile) {
            tile = document.createElement('div');
            tile.className = 'participant-tile';
            tile.id = `peer-${peerId}`;
            grid.appendChild(tile);
        }

        tile.innerHTML = `
            <video autoplay playsinline muted></video>
            <div class="participant-name">${peerId.substring(0, 5)}</div>
        `;

        const video = tile.querySelector('video');
        console.log(`Setting stream for participant ${peerId}, tracks:`, stream.getTracks().map(t => t.kind));

        // Check if stream has tracks
        if (stream.getTracks().length === 0) {
            console.warn(`Stream for ${peerId} has no tracks!`);
            tile.innerHTML += '<div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);color:white;background:rgba(0,0,0,0.7);padding:10px;border-radius:8px;">No media</div>';
        }

        video.srcObject = stream;
        video.muted = true; // Ensure muted for autoplay
        video.onloadedmetadata = () => {
            console.log(`Video metadata loaded for ${peerId}`);
            video.play().then(() => {
                console.log(`Video playing for ${peerId}`);
            }).catch(e => console.error('Autoplay failed:', e));
        };
    },

    // UI: Create floating video window
    createFloatingWindow(peerId, stream, title) {
        const container = document.getElementById('video-windows-container');
        if (!container) return;

        let windowDiv = document.getElementById(`window-${peerId}`);
        if (!windowDiv) {
            windowDiv = document.createElement('div');
            windowDiv.className = 'video-window';
            windowDiv.id = `window-${peerId}`;
            windowDiv.style.left = '20px';
            windowDiv.style.top = '20px';
            windowDiv.style.width = '400px';
            windowDiv.style.height = '300px';
            container.appendChild(windowDiv);
        }

        windowDiv.innerHTML = `
            <div class="video-window-header">
                <div class="video-window-title">${title}</div>
                <div class="video-window-controls">
                    <button class="video-window-btn" id="minimize-${peerId}"><i data-lucide="minus"></i></button>
                    <button class="video-window-btn close" id="close-${peerId}"><i data-lucide="x"></i></button>
                </div>
            </div>
            <video autoplay playsinline muted></video>
        `;

        const video = windowDiv.querySelector('video');
        console.log(`Setting stream for floating window ${peerId}, tracks:`, stream.getTracks().map(t => t.kind));
        video.srcObject = stream;
        video.muted = true; // Ensure muted for autoplay
        video.onloadedmetadata = () => {
            console.log(`Floating window video metadata loaded for ${peerId}`);
            video.play().then(() => {
                console.log(`Floating window video playing for ${peerId}`);
            }).catch(e => console.error('Autoplay failed for floating window:', e));
        };

        lucide.createIcons();

        // Controls
        windowDiv.querySelector(`#minimize-${peerId}`).onclick = () => windowDiv.classList.toggle('minimized');
        windowDiv.querySelector(`#close-${peerId}`).onclick = () => windowDiv.remove();

        this.makeDraggable(windowDiv);
    },

    // UI: Make window draggable
    makeDraggable(element) {
        const header = element.querySelector('.video-window-header');
        let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;

        header.onmousedown = (e) => {
            e.preventDefault();
            pos3 = e.clientX;
            pos4 = e.clientY;
            document.onmouseup = () => {
                document.onmouseup = null;
                document.onmousemove = null;
            };
            document.onmousemove = (e) => {
                e.preventDefault();
                pos1 = pos3 - e.clientX;
                pos2 = pos4 - e.clientY;
                pos3 = e.clientX;
                pos4 = e.clientY;
                element.style.top = (element.offsetTop - pos2) + "px";
                element.style.left = (element.offsetLeft - pos1) + "px";
            };
        };
    },

    // UI: Remove peer elements
    removePeerUI(peerId) {
        const tile = document.getElementById(`peer-${peerId}`);
        if (tile) tile.remove();

        const windowDiv = document.getElementById(`window-${peerId}`);
        if (windowDiv) windowDiv.remove();
    },

    // Media: Toggle Mic
    toggleMic() {
        if (!this.localStream) return;
        const audioTrack = this.localStream.getAudioTracks()[0];
        if (audioTrack) {
            audioTrack.enabled = !audioTrack.enabled;
            this.isMicEnabled = audioTrack.enabled;
            const btn = document.getElementById('mic-btn');
            if (btn) {
                btn.classList.toggle('active', !this.isMicEnabled);
                btn.querySelector('i').setAttribute('data-lucide', this.isMicEnabled ? 'mic' : 'mic-off');
                lucide.createIcons();
            }
        }
    },

    // Media: Toggle Camera
    toggleCamera() {
        if (!this.localStream) return;
        const videoTrack = this.localStream.getVideoTracks()[0];
        if (videoTrack) {
            videoTrack.enabled = !videoTrack.enabled;
            this.isCameraEnabled = videoTrack.enabled;
            const btn = document.getElementById('camera-btn');
            if (btn) {
                btn.classList.toggle('active', !this.isCameraEnabled);
                btn.querySelector('i').setAttribute('data-lucide', this.isCameraEnabled ? 'video' : 'video-off');
                lucide.createIcons();
            }
        }
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
