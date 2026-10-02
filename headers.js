// Security headers for every response, shared by server.js and the Worker.

// Scripts and styles only from this site. Connections may also go to PeerJS
// Cloud and TURN servers over https/wss when PEER_SERVER=cloud.
const CONTENT_SECURITY_POLICY = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "connect-src 'self' https: wss:",
    "media-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
    "frame-ancestors 'self'"
].join('; ');

const SECURITY_HEADERS = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Content-Security-Policy': CONTENT_SECURITY_POLICY
};

module.exports = { SECURITY_HEADERS };
