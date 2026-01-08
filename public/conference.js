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
            secure: isSecure
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
            console.log('Got local media stream');
        } catch (err) {
            console.warn('Error getting local media:', err);
            // Continue without camera/mic if blocked
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

        // Call the host with our local stream (if available)
        const call = this.peer.call(hostPeerId, this.localStream || new MediaStream());

        call.on('stream', (remoteStream) => {
            console.log('Received stream from host');
            this.addPeer(hostPeerId, call, remoteStream, 'host');
        });

        call.on('error', (err) => {
            console.error('Call error:', err);
        });
    },

    // Handle incoming call
    handleIncomingCall(call) {
        console.log('Incoming call from:', call.peer);

        // Answer with our local stream
        call.answer(this.localStream || new MediaStream());

        call.on('stream', (remoteStream) => {
            console.log('Received stream from:', call.peer);
            this.addPeer(call.peer, call, remoteStream, 'participant');
        });

        call.on('close', () => {
            console.log('Call closed:', call.peer);
            this.removePeer(call.peer);
        });
    },

    // Add a peer to state and UI
    addPeer(peerId, call, stream, type) {
        if (this.peers.has(peerId)) return;

        this.peers.set(peerId, { call, stream, type });
        this.renderPeer(peerId, stream, type);
    },

    // Remove a peer
    removePeer(peerId) {
        const peerObj = this.peers.get(peerId);
        if (peerObj) {
            if (peerObj.call) peerObj.call.close();
            this.peers.delete(peerId);
            this.removePeerUI(peerId);
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
            <video autoplay playsinline></video>
            <div class="participant-name">${peerId.substring(0, 5)}</div>
        `;

        const video = tile.querySelector('video');
        video.srcObject = stream;
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
            <video autoplay playsinline></video>
        `;

        const video = windowDiv.querySelector('video');
        video.srcObject = stream;

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
                this.screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
                this.isScreenSharing = true;

                const btn = document.getElementById('screen-btn');
                if (btn) btn.classList.add('active');

                // Replace video track in all active calls
                const videoTrack = this.screenStream.getVideoTracks()[0];
                this.peers.forEach(p => {
                    const sender = p.call.peerConnection.getSenders().find(s => s.track.kind === 'video');
                    if (sender) sender.replaceTrack(videoTrack);
                });

                videoTrack.onended = () => this.stopScreenShare();
            } catch (err) {
                console.error('Screen share failed:', err);
            }
        } else {
            this.stopScreenShare();
        }
    },

    stopScreenShare() {
        if (this.screenStream) {
            this.screenStream.getTracks().forEach(t => t.stop());
            this.screenStream = null;
        }
        this.isScreenSharing = false;
        const btn = document.getElementById('screen-btn');
        if (btn) btn.classList.remove('active');

        // Restore camera track
        if (this.localStream) {
            const videoTrack = this.localStream.getVideoTracks()[0];
            this.peers.forEach(p => {
                const sender = p.call.peerConnection.getSenders().find(s => s.track.kind === 'video');
                if (sender) sender.replaceTrack(videoTrack);
            });
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
