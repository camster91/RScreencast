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

// Browser features the page may use: screen sharing, keeping the screen
// awake and autoplay. Everything else (camera, microphone, location...) is off.
const PERMISSIONS_POLICY = [
    'display-capture=(self)',
    'screen-wake-lock=(self)',
    'autoplay=(self)',
    'camera=()',
    'microphone=()',
    'geolocation=()',
    'payment=()',
    'usb=()',
    'serial=()',
    'bluetooth=()'
].join(', ');

const SECURITY_HEADERS = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Content-Security-Policy': CONTENT_SECURITY_POLICY,
    'Permissions-Policy': PERMISSIONS_POLICY,
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Strict-Transport-Security': 'max-age=15552000'
};

// True when a browser says another website made this request
// (Sec-Fetch-Site). Non-browser clients don't send it, so this only stops
// other sites from using visitors' browsers, e.g. to collect TURN credentials.
function isCrossSiteRequest(getHeader) {
    const site = getHeader('sec-fetch-site');
    return site === 'cross-site' || site === 'same-site';
}

module.exports = { SECURITY_HEADERS, isCrossSiteRequest };
