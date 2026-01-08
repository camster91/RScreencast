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
            console.error('Error getting local media:', err);
            // Continue without camera/mic
        }
    },

    // Initialize as host
    initAsHost() {
        // Display room code
        document.getElementById('id-display').innerText = this.myPeerId;
        const joinUrl = window.location.origin + window.location.pathname + '?room=' + this.myPeerId;
        document.getElementById('url-helper').innerHTML = `Go to <strong>${window.location.host}</strong> and enter code <strong>${this.myPeerId}</strong>`;
        new QRCode(document.getElementById("qrcode"), { text: joinUrl, width: 180, height: 180 });

        // Show local webcam
        if (this.localStream) {
            document.getElementById('room-webcam').srcObject = this.localStream;
        }

        // Show control bar
        document.getElementById('control-bar').style.display = 'flex';
        lucide.createIcons();
    },

    // Initialize as client
    async initAsClient() {
        // Auto-join the room
        await this.joinRoom(this.roomId);

        // Show control bar
        document.getElementById('control-bar').style.display = 'flex';
        lucide.createIcons();
    },

    // Join a room
    async joinRoom(hostPeerId) {
        console.log('Joining room:', hostPeerId);

        if (!this.localStream) {
            await this.getLocalMedia();
        }

        // Call the host
        const call = this.peer.call(hostPeerId, this.localStream);

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
        call.answer(this.localStream);

        call.on('stream', (remoteStream) => {
            console.log('Received stream from:', call.peer);
            this.addPeer(call.peer, call, remoteStream, 'participant');
        });

        call.on('close', () => {
            console.log('Call closed:', call.peer);
            this.removePeer(call.peer);
        });
    },

    // Add a peer
    addPeer(peerId, call, stream, type) {
        this.peers.set(peerId, { call, stream, type });
        this.renderPeer(peerId, stream, type);
    },

    // Remove a peer
    removePeer(peerId) {
        const peer = this.peers.get(peerId);
        if (peer) {
            peer.call.close();
            this.peers.delete(peerId);
            this.removePeerUI(peerId);
        }
    },

    // Render peer video
    renderPeer(peerId, stream, type) {
        if (this.isHost) {
            // Host view: add to participants grid
            this.addToParticipantsGrid(peerId, stream);
        } else {
            // Client view: create floating window for host
            if (type === 'host') {
                this.createFloatingWindow(peerId, stream, 'Room Camera');
            }
        }
    },

    // Add to participants grid
    addToParticipantsGrid(peerId, stream) {
        const grid = document.getElementById('participants-grid');
        const tile = document.createElement('div');
        tile.className = 'participant-tile';
        tile.id = `peer-${peerId}`;

        const video = document.createElement('video');
        video.autoplay = true;
        video.playsinline = true;
        video.srcObject = stream;

        const name = document.createElement('div');
        name.className = 'participant-name';
        name.textContent = peerId.substring(0, 5);

        tile.appendChild(video);
        tile.appendChild(name);
        grid.appendChild(tile);
    },

    // Create floating video window
    createFloatingWindow(peerId, stream, title) {
        const container = document.getElementById('video-windows-container');
        const window = document.createElement('div');
        window.className = 'video-window';
        window.id = `window-${peerId}`;
        window.style.left = '20px';
        window.style.top = '20px';
        window.style.width = '400px';
        window.style.height = '300px';

        window.innerHTML = `
            <div class="video-window-header">
                <div class="video-window-title">${title}</div>
                <div class="video-window-controls">
                    <button class="video-window-btn" onclick="QuickShareConference.minimizeWindow('${peerId}')">−</button>
                    <button class="video-window-btn close" onclick="QuickShareConference.closeWindow('${peerId}')">×</button>
                </div>
            </div>
            <video autoplay playsinline></video>
        `;

        const video = window.querySelector('video');
        video.srcObject = stream;

        container.appendChild(window);
        this.makeDraggable(window);
    },

    // Make window draggable
    makeDraggable(element) {
        const header = element.querySelector('.video-window-header');
        let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;

        header.onmousedown = dragMouseDown;

        function dragMouseDown(e) {
            e.preventDefault();
            pos3 = e.clientX;
            pos4 = e.clientY;
            document.onmouseup = closeDragElement;
            document.onmousemove = elementDrag;
        }

        function elementDrag(e) {
            e.preventDefault();
            pos1 = pos3 - e.clientX;
            pos2 = pos4 - e.clientY;
            pos3 = e.clientX;
            pos4 = e.clientY;
            element.style.top = (element.offsetTop - pos2) + "px";
            element.style.left = (element.offsetLeft - pos1) + "px";
        }

        function closeDragElement() {
            document.onmouseup = null;
            document.onmousemove = null;
        }
    },

    // Window controls
    minimizeWindow(peerId) {
        const window = document.getElementById(`window-${peerId}`);
        window.classList.toggle('minimized');
    },

    closeWindow(peerId) {
        const window = document.getElementById(`window-${peerId}`);
        window.remove();
    },

    // Remove peer UI
    removePeerUI(peerId) {
        const tile = document.getElementById(`peer-${peerId}`);
        if (tile) tile.remove();

        const window = document.getElementById(`window-${peerId}`);
        if (window) window.remove();
    },

    // Toggle microphone
    toggleMic() {
        if (this.localStream) {
            const audioTrack = this.localStream.getAudioTracks()[0];
            if (audioTrack) {
                audioTrack.enabled = !audioTrack.enabled;
                this.isMicEnabled = audioTrack.enabled;
                document.getElementById('mic-btn').classList.toggle('active', this.isMicEnabled);
            }
        }
    },

    // Toggle camera
    toggleCamera() {
        if (this.localStream) {
            const videoTrack = this.localStream.getVideoTracks()[0];
            if (videoTrack) {
                videoTrack.enabled = !videoTrack.enabled;
                this.isCameraEnabled = videoTrack.enabled;
                document.getElementById('camera-btn').classList.toggle('active', this.isCameraEnabled);
            }
        }
    },

    // Toggle screen share
    async toggleScreenShare() {
        if (!this.isScreenSharing) {
            await this.startScreenShare();
        } else {
            this.stopScreenShare();
        }
    },

    // Start screen sharing
    async startScreenShare() {
        try {
            this.screenStream = await navigator.mediaDevices.getDisplayMedia({
                video: { cursor: "always" },
                audio: true
            });

            this.isScreenSharing = true;
            document.getElementById('screen-btn').classList.add('active');

            // Replace video track in all calls
            const videoTrack = this.screenStream.getVideoTracks()[0];
            this.peers.forEach((peer) => {
                const sender = peer.call.peerConnection
                    .getSenders()
                    .find(s => s.track && s.track.kind === 'video');
                if (sender) {
                    sender.replaceTrack(videoTrack);
                }
            });

            // Handle screen share stop
            videoTrack.onended = () => {
                this.stopScreenShare();
            };

        } catch (err) {
            console.error('Screen share error:', err);
        }
    },

    // Stop screen sharing
    stopScreenShare() {
        if (this.screenStream) {
            this.screenStream.getTracks().forEach(track => track.stop());
            this.screenStream = null;
        }

        this.isScreenSharing = false;
        document.getElementById('screen-btn').classList.remove('active');

        // Restore camera track
        if (this.localStream) {
            const videoTrack = this.localStream.getVideoTracks()[0];
            this.peers.forEach((peer) => {
                const sender = peer.call.peerConnection
                    .getSenders()
                    .find(s => s.track && s.track.kind === 'video');
                if (sender) {
                    sender.replaceTrack(videoTrack);
                }
            });
        }
    },

    // Leave room
    leaveRoom() {
        this.peers.forEach((peer, peerId) => {
            this.removePeer(peerId);
        });

        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
        }

        if (this.screenStream) {
            this.screenStream.getTracks().forEach(track => track.stop());
        }

        if (this.peer) {
            this.peer.destroy();
        }

        window.location.reload();
    },

    // Setup UI
    setupUI() {
        // Initialize lucide icons
        lucide.createIcons();
    }
};

// Export for global access
window.QuickShareConference = QuickShareConference;
