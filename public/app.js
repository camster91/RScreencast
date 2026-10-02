renderIcons();
const params = new URLSearchParams(window.location.search);
const rawRoomId = params.get('room');
const isJoinMode = params.get('mode') === 'join';
// Folder the app is served from ("/" or e.g. "/cast/"); server URLs are relative to it
const BASE_PATH = window.location.pathname.replace(/[^/]*$/, '');

// Validate room code format - only allow alphanumeric, max 10 chars
if (rawRoomId && !/^[A-Za-z0-9]{1,10}$/.test(rawRoomId)) {
    window.location.search = '?mode=join';
}

// Room codes are uppercase, so ?room=abcde still finds room ABCDE
const roomId = rawRoomId ? rawRoomId.toUpperCase() : null;

// Escape HTML to prevent XSS when inserting user-controlled data
function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// Room state
let connectedPeers = new Map(); // peerId -> { conn, call, stream, name, approved }
let currentViewingPeer = null;
let pendingApprovals = [];
let modalPeerId = null; // peer whose request is shown in the approval modal
const MAX_PENDING_APPROVALS = 10;

// Generate a short 5-character room code
function generateRoomCode() {
    // 32 characters, so each random byte maps evenly (256 % 32 === 0)
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = crypto.getRandomValues(new Uint8Array(5));
    return Array.from(bytes, b => chars[b % chars.length]).join('');
}

// Keep the same room code when this tab reloads
function getHostRoomCode() {
    try {
        const saved = sessionStorage.getItem('quickshare-room-code');
        if (saved && /^[A-Z0-9]{5}$/.test(saved)) return saved;
    } catch (e) { /* storage blocked */ }
    return saveHostRoomCode(generateRoomCode());
}

function saveHostRoomCode(code) {
    try { sessionStorage.setItem('quickshare-room-code', code); } catch (e) { /* storage blocked */ }
    return code;
}

// Determine mode
const isHosting = !roomId && !isJoinMode;
let hostRoomCode = isHosting ? getHostRoomCode() : undefined;

console.log('Mode:', isHosting ? 'HOST' : (roomId ? 'CLIENT' : 'JOIN'));

// ========== PEER CONNECTION ==========
const DEFAULT_ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478' }
];

let peer = null;
let peerOptions = null;
let reconnectAttempts = 0;
let reconnectTimer = null;
let peerRestarting = false;
let idTakenAttempts = 0;

// Server settings (signaling server, TURN relay). If /config can't be
// loaded, fall back to PeerJS Cloud with STUN only.
async function loadConfig() {
    try {
        const res = await fetch(BASE_PATH + 'config', { cache: 'no-store' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return await res.json();
    } catch (e) {
        console.warn('Could not load /config, using defaults:', e);
        return {};
    }
}

function buildPeerOptions(config) {
    const options = {
        debug: config.debug ? 2 : 1,
        config: {
            iceServers: DEFAULT_ICE_SERVERS.concat(Array.isArray(config.iceServers) ? config.iceServers : [])
        }
    };
    if (config.peerServer === 'self') {
        const secure = window.location.protocol === 'https:';
        options.host = window.location.hostname;
        options.port = window.location.port ? parseInt(window.location.port, 10) : (secure ? 443 : 80);
        options.path = BASE_PATH;
        options.secure = secure;
    }
    return options;
}

function createPeer(id) {
    if (peer && !peer.destroyed) peer.destroy();
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
    peerRestarting = false;

    const p = new Peer(id, peerOptions);
    peer = p;
    // Ignore events from a peer object that has been replaced
    p.on('open', (newId) => { if (p === peer) onPeerOpen(newId); });
    p.on('error', (err) => { if (p === peer) onPeerError(err); });
    p.on('disconnected', () => { if (p === peer) scheduleReconnect(); });
    p.on('close', () => { if (p === peer) scheduleReconnect(); });
    if (isHosting) {
        p.on('connection', onHostConnection);
        p.on('call', onHostCall);
    }
}

function onPeerOpen(id) {
    reconnectAttempts = 0;
    idTakenAttempts = 0;
    console.log('Connected with ID:', id);
    if (isHosting) setupHostDisplay(id);
}

function onPeerError(err) {
    console.error('Peer error:', err.type, err);

    if (err.type === 'unavailable-id' && isHosting) {
        // Code is taken: an old session may still be closing, so retry
        // the same code a couple of times before picking a new one.
        peerRestarting = true;
        idTakenAttempts++;
        if (idTakenAttempts > 2) {
            hostRoomCode = saveHostRoomCode(generateRoomCode());
            idTakenAttempts = 0;
        }
        showHostStatus('Getting a room code...');
        setTimeout(() => createPeer(hostRoomCode), idTakenAttempts ? 3000 : 0);
        return;
    }

    // PeerJS fires this on the Peer object, not the connection
    if (err.type === 'peer-unavailable' && roomId) {
        showClientError('Room "' + roomId + '" not found. Check the code and try again.');
    }
}

// Reconnect to the signaling server with backoff (max 30s), forever.
// Existing screen shares keep working while this happens.
function scheduleReconnect() {
    if (reconnectTimer || peerRestarting) return;
    reconnectAttempts++;
    const delay = Math.min(30000, 1000 * Math.pow(2, reconnectAttempts - 1));
    console.log(`Reconnecting (attempt ${reconnectAttempts}) in ${delay}ms...`);
    if (isHosting) showHostStatus('Reconnecting to server...');

    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        if (peer.destroyed) {
            recoverPeer();
        } else if (peer.disconnected) {
            try {
                peer.reconnect();
            } catch (e) {
                console.error('Reconnect failed:', e);
                scheduleReconnect();
            }
        }
    }, delay);
}

// The peer object is gone for good; start a new one
function recoverPeer() {
    if (isHosting) {
        createPeer(hostRoomCode);
    } else {
        showClientError('Lost connection to the server. Please try again.');
    }
}

// Retry straight away when the network comes back
window.addEventListener('online', () => {
    if (!peer || peer.destroyed || !peer.disconnected) return;
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
    try { peer.reconnect(); } catch (e) { scheduleReconnect(); }
});

// Call back when a WebRTC connection fails, closes, or stays
// disconnected (other device crashed, lost Wi-Fi or went to sleep)
function onConnectionFailed(connection, callback) {
    const pc = connection.peerConnection;
    if (!pc) return;
    let disconnectTimer = null;
    pc.addEventListener('iceconnectionstatechange', () => {
        const state = pc.iceConnectionState;
        clearTimeout(disconnectTimer);
        if (state === 'failed' || state === 'closed') {
            callback();
        } else if (state === 'disconnected') {
            // Short drops can recover by themselves
            disconnectTimer = setTimeout(callback, 8000);
        }
    });
}

// Send a final message, then close once it has had time to arrive
function sendThenClose(conn, message) {
    try { conn.send(message); } catch (e) { console.warn('Send failed:', e); }
    setTimeout(() => conn.close(), 1000);
}

function stopStream(stream) {
    if (stream) stream.getTracks().forEach(track => track.stop());
}

// Route to correct view
if (roomId) {
    showView('client-view');
    document.getElementById('target-room-text').innerText = "Room: " + roomId;
} else if (isJoinMode) {
    showView('manual-join-view');
} else {
    showView('room-view');
}

if (isHosting || roomId) {
    loadConfig().then((config) => {
        peerOptions = buildPeerOptions(config);
        createPeer(hostRoomCode);
    });
    // TURN credentials expire, and a room PC can stay open for days.
    // New connections pick up the refreshed list.
    setInterval(refreshIceServers, 60 * 60 * 1000);
}

// Keep the room PC's screen from sleeping while it shows the code.
// The browser drops the lock when the tab is hidden, so take it again on return.
let wakeLock = null;

async function keepScreenAwake() {
    if (wakeLock || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
    try {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
    } catch (e) {
        console.warn('Screen wake lock unavailable:', e.message);
    }
}

if (isHosting) {
    keepScreenAwake();
    document.addEventListener('visibilitychange', keepScreenAwake);
}

async function refreshIceServers() {
    const config = await loadConfig();
    if (!peerOptions || !Array.isArray(config.iceServers)) return;
    const iceServers = buildPeerOptions(config).config.iceServers;
    peerOptions.config.iceServers = iceServers;
    if (peer && peer.options.config) peer.options.config.iceServers = iceServers;
}

function showView(id) {
    ['room-view', 'client-view', 'manual-join-view'].forEach(v => {
        document.getElementById(v).style.display = 'none';
    });
    document.getElementById(id).style.display = 'flex';
    renderIcons();
}

function validateJoinInput(event) {
    const input = document.getElementById('manual-input');
    const errorEl = document.getElementById('join-error');

    // Auto-uppercase and filter invalid characters
    input.value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '');

    // Hide error while typing
    errorEl.style.display = 'none';

    // Submit on Enter key
    if (event && event.key === 'Enter') {
        submitJoin();
    }
}

function submitJoin() {
    const val = document.getElementById('manual-input').value.toUpperCase().trim();
    const errorEl = document.getElementById('join-error');

    if (!val) {
        errorEl.innerText = 'Please enter a room code';
        errorEl.style.display = 'block';
        return;
    }

    if (val.length < 5) {
        errorEl.innerText = 'Room codes are 5 characters long';
        errorEl.style.display = 'block';
        return;
    }

    // Valid code, redirect to join
    window.location.search = '?room=' + val;
}

function togglePeerPanel() {
    document.getElementById('peer-panel').classList.toggle('visible');
}

// ========== HOST FUNCTIONS ==========
let qrCodeText = null;

function setupHostDisplay(id) {
    document.getElementById('id-display').innerText = id;
    const joinUrl = window.location.origin + window.location.pathname + '?room=' + id;
    document.getElementById('url-helper').innerHTML = `Go to <strong>${escapeHtml(window.location.host)}</strong> and enter code`;
    // Redraw the QR code only when the room code changes
    if (qrCodeText !== joinUrl) {
        const qrEl = document.getElementById("qrcode");
        qrEl.innerHTML = '';
        new QRCode(qrEl, { text: joinUrl, width: 180, height: 180 });
        qrCodeText = joinUrl;
    }
    renderIcons();
}

function showHostStatus(text) {
    document.getElementById('url-helper').innerText = text;
}

// Handle data connections (for approval)
function onHostConnection(conn) {
    console.log('Data connection from:', conn.peer);
    conn.on('data', (data) => handlePeerMessage(conn, data));
    conn.on('close', () => removePeer(conn.peer, conn));
    conn.on('error', (err) => {
        console.error('Data connection error:', err);
        removePeer(conn.peer, conn);
    });
    onConnectionFailed(conn, () => removePeer(conn.peer, conn));
}

// Handle media calls
function onHostCall(call) {
    console.log('Incoming call from:', call.peer);

    const peerData = connectedPeers.get(call.peer);
    if (!peerData || !peerData.approved) {
        console.log('Call from unapproved peer, rejecting');
        call.close();
        return;
    }

    // A new share from the same presenter replaces the old one
    if (peerData.call && peerData.call !== call) {
        const oldCall = peerData.call;
        peerData.call = null;
        oldCall.close();
    }
    peerData.call = call;
    call.answer();

    call.on('stream', (stream) => {
        if (peerData.call !== call) return;
        console.log('Stream received from:', call.peer);
        if (peerData.stream && peerData.stream !== stream) stopStream(peerData.stream);
        peerData.stream = stream;
        stream.getVideoTracks().forEach(track => {
            track.addEventListener('ended', () => endCall(call.peer, call));
        });
        updatePeerList();

        // Auto-view if nobody else is on screen
        if (!currentViewingPeer || currentViewingPeer === call.peer) {
            viewPeer(call.peer);
        }
    });

    // PeerJS doesn't always fire 'close' when the remote side stops,
    // so also watch the connection state and the presenter's message.
    call.on('close', () => endCall(call.peer, call));
    call.on('error', (err) => {
        console.error('Call error:', err);
        endCall(call.peer, call);
    });
    onConnectionFailed(call, () => endCall(call.peer, call));
}

function endCall(peerId, call) {
    const peerData = connectedPeers.get(peerId);
    if (!peerData || peerData.call !== call) return;
    console.log('Call ended:', peerId);

    peerData.call = null;
    stopStream(peerData.stream);
    peerData.stream = null;
    call.close();

    if (currentViewingPeer === peerId) {
        handleViewedStreamGone();
    }
    updatePeerList();
}

// Presenter left, was kicked or the connection failed
function removePeer(peerId, conn) {
    const peerData = connectedPeers.get(peerId);
    if (!peerData || (conn && peerData.conn !== conn)) return;
    console.log('Peer left:', peerId);

    connectedPeers.delete(peerId);
    if (peerData.call) peerData.call.close();
    stopStream(peerData.stream);
    removePendingApproval(peerId);

    if (currentViewingPeer === peerId) {
        handleViewedStreamGone();
    }
    updatePeerList();
}

function handlePeerMessage(conn, data) {
    console.log('Message from', conn.peer, ':', data);
    if (!data || typeof data !== 'object') return;

    const existing = connectedPeers.get(conn.peer);

    if (data.type === 'join-request') {
        // Repeat request: don't queue it twice
        if (existing) {
            existing.conn = conn;
            if (existing.approved) conn.send({ type: 'approved' });
            return;
        }

        if (pendingApprovals.length >= MAX_PENDING_APPROVALS) {
            sendThenClose(conn, { type: 'denied' });
            return;
        }

        // Add to connected peers as pending
        connectedPeers.set(conn.peer, {
            conn: conn,
            name: String(data.name || 'Presenter').slice(0, 40),
            approved: false,
            stream: null,
            call: null
        });

        // Add to pending approvals and show dialog
        pendingApprovals.push(conn.peer);
        updatePendingBadge();
        showNextApproval();
        updatePeerList();
    } else if (data.type === 'stopped-sharing') {
        if (existing && existing.call && existing.call.connectionId === data.callId) {
            endCall(conn.peer, existing.call);
        }
    }
}

function showNextApproval() {
    if (pendingApprovals.length === 0) return;
    if (modalPeerId) return;

    const peerId = pendingApprovals[0];
    const peerData = connectedPeers.get(peerId);
    if (peerData) {
        modalPeerId = peerId;
        document.getElementById('requester-name').innerText = peerData.name;
        document.getElementById('approval-modal').classList.add('active');
    }
}

function closeApprovalModal() {
    modalPeerId = null;
    document.getElementById('approval-modal').classList.remove('active');
}

function removePendingApproval(peerId) {
    pendingApprovals = pendingApprovals.filter(id => id !== peerId);
    if (modalPeerId === peerId) {
        closeApprovalModal();
        setTimeout(showNextApproval, 300);
    }
    updatePendingBadge();
}

function handleApproval(approved) {
    const peerId = modalPeerId;
    closeApprovalModal();
    if (!peerId) return;

    pendingApprovals = pendingApprovals.filter(id => id !== peerId);
    const peerData = connectedPeers.get(peerId);

    if (peerData) {
        if (approved) {
            peerData.approved = true;
            peerData.conn.send({ type: 'approved' });
        } else {
            connectedPeers.delete(peerId);
            sendThenClose(peerData.conn, { type: 'denied' });
        }
        updatePeerList();
    }

    updatePendingBadge();
    // Show next approval if any
    setTimeout(showNextApproval, 300);
}

function updatePendingBadge() {
    const badge = document.getElementById('pending-badge');
    const count = pendingApprovals.length;
    if (count > 0) {
        badge.style.display = 'flex';
        badge.innerText = count;
    } else {
        badge.style.display = 'none';
    }
}

function updatePeerList() {
    const list = document.getElementById('peer-list');

    let html = '';
    let count = 0;
    let streamCount = 0;

    connectedPeers.forEach((data, peerId) => {
        count++;
        const isActive = currentViewingPeer === peerId;
        const isPending = !data.approved;
        const hasStream = !!data.stream;
        if (hasStream) streamCount++;

        let statusText = 'Connected';
        if (isPending) {
            statusText = 'Waiting for approval...';
        } else if (hasStream) {
            statusText = isActive ? '● Currently viewing' : 'Click to view screen';
        }

        const safePeerId = escapeHtml(peerId);
        const safeName = escapeHtml(data.name);

        // Peer IDs go in data attributes, never inline JS
        html += `
            <div class="peer-item ${isActive ? 'active' : ''} ${isPending ? 'pending' : ''}"
                 data-peer-id="${safePeerId}" data-action="${hasStream ? 'view' : ''}"
                 style="${hasStream && !isActive ? 'cursor: pointer;' : ''}">
                <div class="peer-info">
                    <div class="peer-name">${safeName}</div>
                    <div class="peer-status">${statusText}</div>
                </div>
                <div class="peer-actions">
                    <button class="btn btn-danger btn-small" data-peer-id="${safePeerId}" data-action="kick" title="Remove">
                        <i data-lucide="x" style="width:14px;height:14px;"></i>
                    </button>
                </div>
            </div>
        `;
    });

    if (count === 0) {
        html = '<div style="padding: 1rem; color: var(--text-dim); text-align: center;">No participants yet</div>';
    } else if (streamCount > 1) {
        html = '<div style="padding: 0.5rem 1rem; background: rgba(34, 197, 94, 0.1); color: var(--primary); font-size: 0.8rem; text-align: center;">Click a presenter to switch view</div>' + html;
    }

    list.innerHTML = html;

    // Update button text
    document.querySelector('#participants-btn').innerHTML = `
        <i data-lucide="users"></i> Participants (${count})
        <span class="notification-badge" id="pending-badge" style="display: ${pendingApprovals.length ? 'flex' : 'none'};">${pendingApprovals.length}</span>
    `;
    updateViewingInfo();
    renderIcons();
}

document.getElementById('peer-list').addEventListener('click', (event) => {
    const target = event.target.closest('[data-action]');
    if (!target || !target.dataset.action) return;
    const peerId = target.dataset.peerId;
    if (target.dataset.action === 'kick') {
        kickPeer(peerId);
    } else if (target.dataset.action === 'view') {
        viewPeer(peerId);
    }
});

function kickPeer(peerId) {
    const peerData = connectedPeers.get(peerId);
    if (peerData) {
        connectedPeers.delete(peerId);
        if (peerData.call) peerData.call.close();
        stopStream(peerData.stream);
        sendThenClose(peerData.conn, { type: 'kicked' });

        // Remove from pending if there
        removePendingApproval(peerId);

        if (currentViewingPeer === peerId) {
            handleViewedStreamGone();
        }
        updatePeerList();
    }
}

// The screen on display went away: show another presenter or go idle
function handleViewedStreamGone() {
    for (const [peerId, data] of connectedPeers) {
        if (data.stream && peerId !== currentViewingPeer) {
            viewPeer(peerId);
            return;
        }
    }
    stopViewing();
}

function viewPeer(peerId) {
    const peerData = connectedPeers.get(peerId);
    if (!peerData || !peerData.stream) return;

    currentViewingPeer = peerId;
    document.getElementById('room-pc-setup').style.display = 'none';
    document.getElementById('floating-controls').style.display = 'none';
    document.getElementById('media-container').style.display = 'block';

    const video = document.getElementById('remote-video');
    if (video.srcObject !== peerData.stream) {
        video.srcObject = peerData.stream;
        playRemoteVideo();
    }

    updatePeerList();
}

function updateViewingInfo() {
    const peerData = currentViewingPeer && connectedPeers.get(currentViewingPeer);
    if (!peerData) return;

    document.getElementById('viewing-name').innerText = 'Viewing: ' + peerData.name;

    // Count presenters with active streams
    let presenterCount = 0;
    connectedPeers.forEach((data) => {
        if (data.stream) presenterCount++;
    });

    // Show switch button only if multiple presenters
    const switchBtn = document.getElementById('switch-presenter-btn');
    const countEl = document.getElementById('presenter-count');
    if (presenterCount > 1) {
        switchBtn.style.display = 'inline-flex';
        countEl.innerText = `(${presenterCount} presenters active)`;
    } else {
        switchBtn.style.display = 'none';
        countEl.innerText = '';
    }
}

// Browsers block video with sound from auto-playing until someone has
// clicked the page. On an unattended room PC, fall back to muted video
// and show a "Tap for sound" button.
function playRemoteVideo() {
    const video = document.getElementById('remote-video');
    const hasAudio = !!video.srcObject && video.srcObject.getAudioTracks().length > 0;
    video.muted = false;
    video.play().then(() => {
        setUnmuteVisible(false);
    }).catch((err) => {
        if (err.name !== 'NotAllowedError') {
            console.warn('Video play interrupted:', err);
            return;
        }
        console.log('Autoplay with sound blocked, playing muted');
        video.muted = true;
        video.play().catch(e => console.error('Video playback failed:', e));
        setUnmuteVisible(hasAudio);
    });
}

function setUnmuteVisible(show) {
    document.getElementById('unmute-btn').style.display = show ? 'inline-flex' : 'none';
    if (show) {
        document.getElementById('viewing-controls').classList.remove('minimized');
        document.getElementById('show-controls-btn').classList.remove('visible');
    }
}

function unmuteVideo() {
    const video = document.getElementById('remote-video');
    video.muted = false;
    video.play().catch(e => console.error('Video playback failed:', e));
    setUnmuteVisible(false);
}

// Tapping the video also turns the sound on
document.getElementById('remote-video').addEventListener('click', () => {
    if (document.getElementById('unmute-btn').style.display !== 'none') unmuteVideo();
});

function stopViewing() {
    currentViewingPeer = null;
    document.getElementById('room-pc-setup').style.display = 'flex';
    document.getElementById('floating-controls').style.display = 'flex';
    document.getElementById('media-container').style.display = 'none';
    document.getElementById('remote-video').srcObject = null;
    setUnmuteVisible(false);
    // Reset controls visibility
    document.getElementById('viewing-controls').classList.remove('minimized');
    document.getElementById('show-controls-btn').classList.remove('visible');
    updatePeerList();
}

function toggleViewingControls() {
    const controls = document.getElementById('viewing-controls');
    const showBtn = document.getElementById('show-controls-btn');

    if (controls.classList.contains('minimized')) {
        controls.classList.remove('minimized');
        showBtn.classList.remove('visible');
    } else {
        controls.classList.add('minimized');
        showBtn.classList.add('visible');
    }
    renderIcons();
}

// ========== CLIENT FUNCTIONS ==========
let currentStream = null;
let currentCall = null;
let clientConn = null;
let clientDone = false; // reached a final state (denied, kicked, error)

function showClientState(state) {
    const states = ['share-initial', 'share-waiting', 'share-approved', 'share-live', 'share-ended', 'share-denied', 'share-kicked', 'share-error'];
    states.forEach(s => {
        document.getElementById(s).style.display = s === state ? 'block' : 'none';
    });
    renderIcons();
}

function showClientError(message) {
    if (clientDone) return;
    clientDone = true;
    endShare(false);
    document.getElementById('error-message').innerText = message;
    showClientState('share-error');
}

function waitForPeerOpen(timeoutMs) {
    return new Promise((resolve, reject) => {
        const start = Date.now();
        (function check() {
            if (peer && peer.open) return resolve();
            if (Date.now() - start > timeoutMs) {
                return reject(new Error('Could not reach the server. Check your internet connection and try again.'));
            }
            setTimeout(check, 200);
        })();
    });
}

async function startSharing() {
    document.getElementById('join-btn').disabled = true;
    try {
        await waitForPeerOpen(10000);
    } catch (e) {
        showClientError(e.message);
        return;
    }

    showClientState('share-waiting');

    // First establish data connection
    const conn = peer.connect(roomId, { reliable: true });
    clientConn = conn;
    let opened = false;

    // If the room doesn't exist, the connection never opens
    const openTimeout = setTimeout(() => {
        console.error('Connection timeout - room may not exist');
        showClientError('Room "' + roomId + '" not found. The room may have closed or the code is incorrect.');
        conn.close();
    }, 10000);

    conn.on('open', () => {
        opened = true;
        clearTimeout(openTimeout);
        // No timeout after this: the host may take a while to click Allow,
        // and 'close' tells us if they leave.
        conn.send({
            type: 'join-request',
            name: 'Presenter ' + peer.id.substring(0, 4).toUpperCase()
        });
    });

    conn.on('data', (data) => {
        console.log('Received from host:', data);
        if (!data || clientDone) return;

        if (data.type === 'approved') {
            if (!currentStream) showClientState('share-approved');
        } else if (data.type === 'denied') {
            clientDone = true;
            endShare(false);
            showClientState('share-denied');
        } else if (data.type === 'kicked') {
            clientDone = true;
            endShare(false);
            showClientState('share-kicked');
        }
    });

    conn.on('error', (err) => {
        clearTimeout(openTimeout);
        console.error('Connection error:', err);
        showClientError('Could not connect to the room. Please check the room code and try again.');
    });

    onConnectionFailed(conn, () => {
        clearTimeout(openTimeout);
        showClientError('Lost connection to the room. The host may have left.');
    });

    conn.on('close', () => {
        clearTimeout(openTimeout);
        showClientError(opened
            ? 'The room was closed or the host disconnected.'
            : 'Connection closed. The room may no longer be available.');
    });
}

async function shareScreen() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
        showClientError("This browser can't share its screen. Use Chrome, Edge or Firefox on a computer.");
        return;
    }

    let stream;
    try {
        stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    } catch (e) {
        // User cancelled screen selection - show approved state again
        if (e.name === 'NotAllowedError') {
            showClientState('share-approved');
        } else {
            showClientError(e.message);
        }
        return;
    }

    try {
        await waitForPeerOpen(10000);
    } catch (e) {
        stopStream(stream);
        showClientError(e.message);
        return;
    }
    if (clientDone) {
        stopStream(stream);
        return;
    }

    // Replace any earlier share
    endShare(false);
    currentStream = stream;
    const call = peer.call(roomId, stream);
    if (!call) {
        showClientError('Lost connection to the server. Please try again.');
        return;
    }
    currentCall = call;
    showClientState('share-live');

    // Host ended the call or the connection dropped
    const onCallEnded = () => {
        if (currentCall !== call) return;
        endShare(false);
        if (!clientDone) showClientState('share-ended');
    };
    call.on('close', onCallEnded);
    call.on('error', onCallEnded);

    // User clicked the browser's own "Stop sharing" button
    const [videoTrack] = stream.getVideoTracks();
    if (videoTrack) {
        videoTrack.addEventListener('ended', () => {
            if (currentStream !== stream) return;
            endShare(true);
            if (!clientDone) showClientState('share-ended');
        });
    }
}

// Stop the current share. If notifyHost, tell the host right away
// so it doesn't keep showing a frozen frame.
function endShare(notifyHost) {
    const call = currentCall;
    currentCall = null;
    stopStream(currentStream);
    currentStream = null;
    if (call) {
        if (notifyHost && clientConn && clientConn.open) {
            clientConn.send({ type: 'stopped-sharing', callId: call.connectionId });
        }
        call.close();
    }
}

function stopSharing() {
    endShare(true);
    showClientState('share-ended');
}

// Clean up resources when page unloads
window.addEventListener('beforeunload', () => {
    endShare(true);
    // Close all host connections
    connectedPeers.forEach((data) => {
        stopStream(data.stream);
        if (data.call) data.call.close();
        if (data.conn) data.conn.close();
    });
    if (peer) peer.destroy();
});

// ========== BUTTONS ==========
const ACTIONS = {
    'join-as-presenter': () => { window.location.search = '?mode=join'; },
    'toggle-peer-panel': togglePeerPanel,
    'toggle-viewing-controls': toggleViewingControls,
    'stop-viewing': stopViewing,
    'unmute': unmuteVideo,
    'submit-join': submitJoin,
    'start-sharing': startSharing,
    'share-screen': shareScreen,
    'stop-sharing': stopSharing,
    'reload': () => window.location.reload(),
    'approve': () => handleApproval(true),
    'deny': () => handleApproval(false)
};

document.addEventListener('click', (event) => {
    const target = event.target.closest('[data-action]');
    const action = target && ACTIONS[target.dataset.action];
    if (action) action();
});

document.getElementById('manual-input').addEventListener('keyup', validateJoinInput);
