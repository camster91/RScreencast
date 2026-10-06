renderIcons();
const params = new URLSearchParams(window.location.search);
const rawRoomId = params.get('room');
// Folder the app is served from ("/" or e.g. "/cast/"); server URLs are relative to it
const BASE_PATH = window.location.pathname.replace(/[^/]*$/, '');
// Presenters type ".../join"; ?mode=join is the older address
const isJoinMode = /\/join$/.test(window.location.pathname) || params.get('mode') === 'join';
// Address shown to presenters; /config can give a shorter one (e.g. rotmanav.ca/join)
const JOIN_ADDRESS = window.location.host + BASE_PATH + 'join';

// Validate room code format - only allow alphanumeric, max 10 chars
if (rawRoomId && !/^[A-Za-z0-9]{1,10}$/.test(rawRoomId)) {
    window.location.href = BASE_PATH + 'join';
}

// Phones and tablets can't share their screen from a browser
const canShareScreen = !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) &&
    !(navigator.userAgentData && navigator.userAgentData.mobile);

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
let roomLocked = false; // host turned off new join requests
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
        showHostStatus('Getting a room code…');
        setTimeout(() => createPeer(hostRoomCode), idTakenAttempts ? 3000 : 0);
        return;
    }

    // PeerJS fires this on the Peer object, not the connection
    if (err.type === 'peer-unavailable' && roomId) {
        showRoomNotFound();
    }
}

// Reconnect to the signaling server with backoff (max 30s), forever.
// Existing screen shares keep working while this happens.
function scheduleReconnect() {
    if (reconnectTimer || peerRestarting) return;
    reconnectAttempts++;
    const delay = Math.min(30000, 1000 * Math.pow(2, reconnectAttempts - 1));
    console.log(`Reconnecting (attempt ${reconnectAttempts}) in ${delay}ms...`);
    if (isHosting) showHostStatus('Reconnecting…');

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
        showClientError('Lost the connection. Check your Wi-Fi and try again.');
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
    document.title = 'Cast · Share to ' + roomId;
    document.getElementById('target-room-text').innerText = roomId;
    document.getElementById('share-supported').hidden = !canShareScreen;
    document.getElementById('share-unsupported').hidden = canShareScreen;
    showJoinAddress(JOIN_ADDRESS);
    document.querySelectorAll('.room-code-text').forEach(el => { el.innerText = roomId; });
    showView('client-view');
} else if (isJoinMode) {
    document.title = 'Cast · Share your screen';
    document.querySelector('#manual-join-view .phone-note').hidden = canShareScreen;
    showView('manual-join-view');
    document.getElementById('manual-input').focus();
} else {
    showJoinAddress(JOIN_ADDRESS);
    if (!document.fullscreenEnabled) document.getElementById('fullscreen-btn').hidden = true;
    showView('room-view');
}

if (isHosting || roomId) {
    loadConfig().then((config) => {
        if (typeof config.joinAddress === 'string' && /^[a-z0-9.-]+(:\d+)?(\/[\w./-]*)?$/i.test(config.joinAddress)) {
            showJoinAddress(config.joinAddress);
        }
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

function showJoinAddress(address) {
    document.getElementById('join-address').innerText = address;
    document.querySelectorAll('.join-address-text').forEach(el => { el.innerText = address; });
}

function showView(id) {
    ['room-view', 'client-view', 'manual-join-view'].forEach(v => {
        document.getElementById(v).style.display = 'none';
    });
    document.getElementById(id).style.display = 'flex';
    renderIcons();
}

function cleanJoinInput() {
    const input = document.getElementById('manual-input');
    // A pasted link works too
    const fromLink = input.value.match(/room=([A-Za-z0-9]{5})/);
    input.value = (fromLink ? fromLink[1] : input.value).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
    document.getElementById('join-error').hidden = true;
}

function submitJoin(event) {
    if (event) event.preventDefault();
    const val = document.getElementById('manual-input').value.toUpperCase().trim();
    const errorEl = document.getElementById('join-error');

    if (val.length !== 5) {
        errorEl.innerText = val ? 'Codes have 5 letters and numbers.' : 'Enter the code shown on the room screen.';
        errorEl.hidden = false;
        document.getElementById('manual-input').focus();
        return;
    }

    window.location.href = BASE_PATH + '?room=' + val;
}

function togglePeerPanel() {
    document.getElementById('peer-panel').classList.toggle('visible');
    wakeControls();
}

function toggleFullscreen() {
    if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
    } else {
        document.documentElement.requestFullscreen().catch(() => {});
    }
}

let toastTimer = null;
function showToast(text) {
    const toast = document.getElementById('toast');
    toast.innerText = text;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 2500);
}

// Phone users: hand the link to their laptop
async function sendLink() {
    const url = window.location.origin + BASE_PATH + '?room=' + roomId;
    if (navigator.share) {
        try {
            await navigator.share({ title: 'Cast', text: 'Share your screen to room ' + roomId, url });
            return;
        } catch (e) {
            if (e.name === 'AbortError') return;
        }
    }
    try {
        await navigator.clipboard.writeText(url);
        showToast('Link copied');
    } catch (e) {
        showToast(url);
    }
}

// ========== HOST FUNCTIONS ==========
let qrCodeText = null;

function setupHostDisplay(id) {
    document.getElementById('id-display').innerText = id;
    document.title = 'Cast · Room ' + id;
    const joinUrl = window.location.origin + BASE_PATH + '?room=' + id;
    document.getElementById('url-helper').innerText = 'Ready';
    document.getElementById('room-status').classList.add('ready');
    // Redraw the QR code only when the room code changes
    if (qrCodeText !== joinUrl) {
        const qrEl = document.getElementById("qrcode");
        qrEl.innerHTML = '';
        new QRCode(qrEl, { text: joinUrl, width: 320, height: 320, correctLevel: QRCode.CorrectLevel.M });
        qrCodeText = joinUrl;
    }
    renderIcons();
}

function showHostStatus(text) {
    document.getElementById('url-helper').innerText = text;
    document.getElementById('room-status').classList.remove('ready');
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

        if (roomLocked) {
            sendThenClose(conn, { type: 'denied', reason: 'locked' });
            return;
        }

        if (pendingApprovals.length >= MAX_PENDING_APPROVALS) {
            sendThenClose(conn, { type: 'denied' });
            return;
        }

        // Add to connected peers as pending. A typed name is only a label:
        // the check code (from the peer ID) is always shown next to it, so
        // someone calling themselves "IT Support" can still be checked.
        connectedPeers.set(conn.peer, {
            conn: conn,
            name: presenterName(conn.peer, data.name),
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

// Short code derived from a presenter's peer ID. The presenter sees it on
// their screen and the host sees it in the request, so the host can check
// the request really comes from the person in the room.
function presenterCode(peerId) {
    return String(peerId).replace(/[^A-Za-z0-9]/g, '').substring(0, 4).toUpperCase();
}

// Presenter's typed name, cleaned: no control or text-direction characters
// (which could hide or reorder the code), single spaces, max 30 characters
function cleanName(name) {
    if (typeof name !== 'string') return '';
    return name
        .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028-\u202E\u2060-\u206F\uFEFF]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 30)
        .trim();
}

function presenterName(peerId, typedName) {
    const name = cleanName(typedName);
    return name ? name + ' · ' + presenterCode(peerId) : 'Presenter ' + presenterCode(peerId);
}

function toggleRoomLock() {
    roomLocked = !roomLocked;
    // Locking also turns away anyone still waiting
    if (roomLocked) {
        for (const peerId of [...pendingApprovals]) {
            const peerData = connectedPeers.get(peerId);
            connectedPeers.delete(peerId);
            removePendingApproval(peerId);
            if (peerData) sendThenClose(peerData.conn, { type: 'denied', reason: 'locked' });
        }
        updatePeerList();
    }
    document.querySelectorAll('.lock-room-btn').forEach((btn) => {
        btn.classList.toggle('locked', roomLocked);
        btn.innerHTML = roomLocked
            ? '<i data-lucide="lock"></i> <span class="lock-label">Room locked</span>'
            : '<i data-lucide="lock-open"></i> <span class="lock-label">Lock room</span>';
    });
    renderIcons();
    showToast(roomLocked ? 'Room locked. New requests are turned away.' : 'Room unlocked');
}

function showNextApproval() {
    if (pendingApprovals.length === 0) return;
    if (modalPeerId) return;

    const peerId = pendingApprovals[0];
    const peerData = connectedPeers.get(peerId);
    if (peerData) {
        modalPeerId = peerId;
        document.getElementById('requester-name').innerText = peerData.name;
        document.getElementById('requester-code').innerText = presenterCode(peerId);
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
    badge.innerText = pendingApprovals.length;
    badge.hidden = pendingApprovals.length === 0;
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

        let statusText = 'Connected, not sharing';
        if (isPending) {
            statusText = 'Waiting to be accepted';
        } else if (hasStream) {
            statusText = isActive ? 'On screen now' : 'Sharing · click to show';
        }

        const safePeerId = escapeHtml(peerId);
        const safeName = escapeHtml(data.name);

        // Peer IDs go in data attributes, never inline JS
        html += `
            <div class="peer-item ${isActive ? 'active' : ''} ${isPending ? 'pending' : ''}"
                 data-peer-id="${safePeerId}" data-action="${hasStream ? 'view' : ''}">
                <div class="peer-info">
                    <div class="peer-name">${safeName}</div>
                    <div class="peer-status">${statusText}</div>
                </div>
                <div class="peer-actions">
                    <button class="btn btn-small" data-peer-id="${safePeerId}" data-action="kick" title="Remove" aria-label="Remove ${safeName}">
                        <i data-lucide="x"></i>
                    </button>
                </div>
            </div>
        `;
    });

    if (count === 0) {
        html = '<div class="peer-empty">No one has joined yet.</div>';
    } else if (streamCount > 1) {
        html = '<div class="peer-tip">Click someone to put their screen on the display</div>' + html;
    }

    list.innerHTML = html;

    const peopleBtn = document.getElementById('participants-btn');
    peopleBtn.dataset.count = count;
    peopleBtn.querySelector('.participants-label').innerText = count ? `People · ${count}` : 'People';
    updatePendingBadge();
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
    wakeControls();

    const video = document.getElementById('remote-video');
    if (video.srcObject !== peerData.stream) {
        video.srcObject = peerData.stream;
        playRemoteVideo();
    }

    monitorViewedCall();
    updatePeerList();
}

function updateViewingInfo() {
    const peerData = currentViewingPeer && connectedPeers.get(currentViewingPeer);
    if (!peerData) return;

    document.getElementById('viewing-name').innerText = peerData.name;

    // Count presenters with active streams
    let presenterCount = 0;
    connectedPeers.forEach((data) => {
        if (data.stream) presenterCount++;
    });

    // Show switch button only if multiple presenters
    const switchBtn = document.getElementById('switch-presenter-btn');
    const countEl = document.getElementById('presenter-count');
    switchBtn.hidden = presenterCount < 2;
    countEl.innerText = presenterCount > 1 ? `· ${presenterCount} sharing` : '';
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
    document.getElementById('unmute-btn').hidden = !show;
    wakeControls();
}

function unmuteVideo() {
    const video = document.getElementById('remote-video');
    video.muted = false;
    video.play().catch(e => console.error('Video playback failed:', e));
    setUnmuteVisible(false);
}

// Tapping the video also turns the sound on
document.getElementById('remote-video').addEventListener('click', () => {
    if (!document.getElementById('unmute-btn').hidden) unmuteVideo();
});

function stopViewing() {
    currentViewingPeer = null;
    document.getElementById('room-pc-setup').style.display = '';
    document.getElementById('floating-controls').style.display = '';
    document.getElementById('media-container').style.display = 'none';
    document.getElementById('remote-video').srcObject = null;
    setUnmuteVisible(false);
    monitorViewedCall();
    updatePeerList();
}

// "End share" on the room screen: stop the presenter's share and tell them
function endViewedShare() {
    const peerId = currentViewingPeer;
    const peerData = peerId && connectedPeers.get(peerId);
    if (!peerData || !peerData.call) {
        stopViewing();
        return;
    }
    try { peerData.conn.send({ type: 'share-ended' }); } catch (e) { console.warn('Send failed:', e); }
    endCall(peerId, peerData.call);
}

// Controls over the shared screen fade out until the mouse moves
let controlsTimer = null;
function wakeControls() {
    const container = document.getElementById('media-container');
    container.classList.remove('idle');
    clearTimeout(controlsTimer);
    controlsTimer = setTimeout(() => {
        const keepVisible = !document.getElementById('unmute-btn').hidden ||
            document.getElementById('peer-panel').classList.contains('visible') ||
            document.getElementById('host-quality').classList.contains('poor');
        if (!keepVisible) container.classList.add('idle');
    }, 3000);
}
['pointermove', 'pointerdown', 'keydown'].forEach((type) => {
    document.addEventListener(type, () => { if (currentViewingPeer) wakeControls(); }, { passive: true });
});

// ========== CLIENT FUNCTIONS ==========
let currentStream = null;
let currentCall = null;
let clientConn = null;
let clientDone = false; // reached a final state (denied, kicked, error)

function showClientState(state) {
    const states = ['share-initial', 'share-waiting', 'share-approved', 'share-live', 'share-ended', 'share-denied', 'share-kicked', 'share-error'];
    states.forEach(s => {
        document.getElementById(s).hidden = s !== state;
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
                return reject(new Error("Can't reach Cast. Check your Wi-Fi and try again."));
            }
            setTimeout(check, 200);
        })();
    });
}

// The presenter's name is remembered on this device for next time
function getPresenterName() {
    const name = document.getElementById('presenter-name').value;
    try { localStorage.setItem('cast-presenter-name', name); } catch (e) { /* storage blocked */ }
    return name;
}

async function startSharing() {
    document.getElementById('join-btn').disabled = true;
    try {
        await waitForPeerOpen(10000);
    } catch (e) {
        showClientError(e.message);
        return;
    }

    document.getElementById('my-presenter-code').innerText = presenterCode(peer.id);
    showClientState('share-waiting');

    // First establish data connection
    const conn = peer.connect(roomId, { reliable: true });
    clientConn = conn;
    let opened = false;

    // If the room doesn't exist, the connection never opens
    const openTimeout = setTimeout(() => {
        console.error('Connection timeout - room may not exist');
        showRoomNotFound();
        conn.close();
    }, 10000);

    conn.on('open', () => {
        opened = true;
        clearTimeout(openTimeout);
        // No timeout after this: the host may take a while to click Allow,
        // and 'close' tells us if they leave.
        conn.send({ type: 'join-request', name: cleanName(getPresenterName()) });
    });

    conn.on('data', (data) => {
        console.log('Received from host:', data);
        if (!data || clientDone) return;

        if (data.type === 'approved') {
            if (!currentStream) showClientState('share-approved');
        } else if (data.type === 'denied') {
            clientDone = true;
            endShare(false);
            if (data.reason === 'locked') {
                document.getElementById('denied-message').innerText =
                    'This room is locked right now. Ask someone at the room screen to unlock it.';
            }
            showClientState('share-denied');
        } else if (data.type === 'share-ended') {
            endShare(false);
            showShareEnded('The room screen ended your share.');
        } else if (data.type === 'kicked') {
            clientDone = true;
            endShare(false);
            showClientState('share-kicked');
        }
    });

    conn.on('error', (err) => {
        clearTimeout(openTimeout);
        console.error('Connection error:', err);
        showClientError("Couldn't connect to the room. Check the code and try again.");
    });

    onConnectionFailed(conn, () => {
        clearTimeout(openTimeout);
        showClientError('Lost the connection to the room screen.');
    });

    conn.on('close', () => {
        clearTimeout(openTimeout);
        showClientError(opened
            ? 'The room screen was closed.'
            : "The room isn't available right now.");
    });
}

async function shareScreen() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
        showClientError("This browser can't share its screen. Use Chrome, Edge, Firefox or Safari on a computer.");
        return;
    }

    let stream;
    try {
        stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    } catch (e) {
        // User cancelled screen selection: go back to the last screen
        if (e.name === 'NotAllowedError') {
            if (!currentStream) showClientState('share-approved');
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
        showClientError('Lost the connection. Check your Wi-Fi and try again.');
        return;
    }
    currentCall = call;
    showClientState('share-live');
    stopClientQuality = watchQuality(() => call.peerConnection, showClientQuality);

    // Host ended the call or the connection dropped
    const onCallEnded = () => {
        if (currentCall !== call) return;
        endShare(false);
        showShareEnded();
    };
    call.on('close', onCallEnded);
    call.on('error', onCallEnded);

    // User clicked the browser's own "Stop sharing" button
    const [videoTrack] = stream.getVideoTracks();
    if (videoTrack) {
        videoTrack.addEventListener('ended', () => {
            if (currentStream !== stream) return;
            endShare(true);
            showShareEnded();
        });
    }
}

// Stop the current share. If notifyHost, tell the host right away
// so it doesn't keep showing a frozen frame.
function endShare(notifyHost) {
    const call = currentCall;
    currentCall = null;
    if (stopClientQuality) stopClientQuality();
    stopClientQuality = null;
    document.getElementById('client-quality-row').hidden = true;
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
    showShareEnded();
}

function showShareEnded(message) {
    if (clientDone) return;
    document.getElementById('ended-message').innerText = message || "You're no longer on the room screen.";
    showClientState('share-ended');
}

function showRoomNotFound() {
    showClientError(`Room ${roomId} wasn't found. Check the code on the room screen and try again.`);
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

// ========== CONNECTION QUALITY ==========
// From WebRTC stats: packet loss and round-trip time. Frame rate isn't used,
// because a still slide is normally sent at about one frame per second.
const QUALITY_LABELS = { good: 'Good connection', weak: 'Weak connection', poor: 'Poor connection' };

function classifyQuality({ loss, rtt }) {
    if (loss > 0.08 || rtt > 0.5) return 'poor';
    if (loss > 0.03 || rtt > 0.25) return 'weak';
    return 'good';
}

// Check a connection every 3 seconds and call onChange(level, details).
// Shows the worse of the last two readings, so one blip doesn't flicker.
// Returns a function that stops checking.
function watchQuality(getPeerConnection, onChange) {
    let lastCounts = null;
    let previousLevel = 'good';
    const rank = { good: 0, weak: 1, poor: 2 };
    const timer = setInterval(async () => {
        const pc = getPeerConnection();
        if (!pc || pc.connectionState === 'closed') return;
        let stats;
        try { stats = await pc.getStats(); } catch (e) { return; }

        const byId = new Map();
        stats.forEach(report => byId.set(report.id, report));
        let loss = null;
        let rtt = null;
        let pair = null;
        stats.forEach((report) => {
            if (report.type === 'inbound-rtp' && report.kind === 'video') {
                // Room screen: loss since the last check
                const counts = { lost: Math.max(0, report.packetsLost || 0), received: report.packetsReceived || 0 };
                if (lastCounts) {
                    const lost = Math.max(0, counts.lost - lastCounts.lost);
                    const total = lost + Math.max(0, counts.received - lastCounts.received);
                    if (total > 0) loss = lost / total;
                }
                lastCounts = counts;
            } else if (report.type === 'remote-inbound-rtp' && report.kind === 'video' && typeof report.fractionLost === 'number') {
                // Presenter: loss the room screen reported back
                loss = report.fractionLost;
            } else if (report.type === 'transport' && report.selectedCandidatePairId) {
                pair = byId.get(report.selectedCandidatePairId) || pair;
            } else if (report.type === 'candidate-pair' && report.nominated && report.state === 'succeeded' && !pair) {
                pair = report;
            }
        });
        if (pair && typeof pair.currentRoundTripTime === 'number') rtt = pair.currentRoundTripTime;
        if (loss === null && rtt === null) return;

        const local = pair && byId.get(pair.localCandidateId);
        const remote = pair && byId.get(pair.remoteCandidateId);
        const relay = !!((local && local.candidateType === 'relay') || (remote && remote.candidateType === 'relay'));
        const reading = classifyQuality({ loss: loss || 0, rtt: rtt || 0 });
        const level = rank[reading] >= rank[previousLevel] ? reading : previousLevel;
        previousLevel = reading;
        onChange(level, { loss, rtt, relay });
    }, 3000);
    return () => clearInterval(timer);
}

function qualityDetails({ loss, rtt, relay }) {
    const parts = [];
    if (loss !== null) parts.push(`Packet loss ${(loss * 100).toFixed(1)}%`);
    if (rtt !== null) parts.push(`Delay ${Math.round(rtt * 1000)} ms`);
    if (relay) parts.push('Using the relay server');
    return parts.join(' · ');
}

function setQualityLabel(el, level, details) {
    el.className = 'quality ' + level;
    el.innerText = QUALITY_LABELS[level];
    el.title = qualityDetails(details);
}

// Room screen: watch the presenter on display
let stopHostQuality = null;
let hostQualityCall = null;

function monitorViewedCall() {
    const peerData = currentViewingPeer && connectedPeers.get(currentViewingPeer);
    const call = peerData && peerData.call;
    if (call === hostQualityCall) return;
    if (stopHostQuality) stopHostQuality();
    stopHostQuality = null;
    hostQualityCall = call || null;
    const el = document.getElementById('host-quality');
    el.hidden = true;
    el.className = 'quality';
    if (!call) return;
    stopHostQuality = watchQuality(() => call.peerConnection, (level, details) => {
        setQualityLabel(el, level, details);
        el.hidden = false;
        if (level === 'poor') wakeControls();
    });
}

// Presenter: show how their connection is doing, with a tip when it's bad
let stopClientQuality = null;

function showClientQuality(level, details) {
    setQualityLabel(document.getElementById('client-quality'), level, details);
    document.getElementById('client-quality-tip').innerText = level === 'good' ? ''
        : 'The room may see a blurry or frozen picture. Try moving closer to the Wi-Fi or closing video calls.';
    document.getElementById('client-quality-row').hidden = false;
}

// ========== BUTTONS ==========
const ACTIONS = {
    'toggle-peer-panel': togglePeerPanel,
    'fullscreen': toggleFullscreen,
    'stop-viewing': endViewedShare,
    'unmute': unmuteVideo,
    'send-link': sendLink,
    'start-sharing': startSharing,
    'share-screen': shareScreen,
    'stop-sharing': stopSharing,
    'reload': () => window.location.reload(),
    'approve': () => handleApproval(true),
    'deny': () => handleApproval(false),
    'toggle-room-lock': toggleRoomLock
};

document.addEventListener('click', (event) => {
    const target = event.target.closest('[data-action]');
    const action = target && ACTIONS[target.dataset.action];
    if (action) action();
});

document.getElementById('manual-input').addEventListener('input', cleanJoinInput);

// Presenter's name: fill in last time's, and Enter asks to share
const nameInput = document.getElementById('presenter-name');
try { nameInput.value = localStorage.getItem('cast-presenter-name') || ''; } catch (e) { /* storage blocked */ }
nameInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !document.getElementById('join-btn').disabled) startSharing();
});
document.getElementById('join-form').addEventListener('submit', submitJoin);
