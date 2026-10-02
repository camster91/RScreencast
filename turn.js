// TURN relay servers for browsers that can't connect directly
// (strict corporate/campus networks).
//
// Two ways to configure:
// 1. Cloudflare TURN (recommended): CLOUDFLARE_TURN_KEY_ID + CLOUDFLARE_TURN_API_TOKEN.
//    The server asks Cloudflare for short-lived credentials, so the API token
//    never reaches the browser.
// 2. Any TURN server with fixed credentials: TURN_URLS (comma-separated),
//    TURN_USERNAME, TURN_CREDENTIAL. These are visible to every visitor.

const CLOUDFLARE_API = 'https://rtc.live.cloudflare.com/v1/turn/keys';
const CREDENTIAL_TTL_SECONDS = 24 * 60 * 60;
// Hand out cached credentials while they have at least this long left
const MIN_REMAINING_MS = 12 * 60 * 60 * 1000;

let cached = null; // { iceServers, expiresAt }
let pending = null;

function getStaticTurnServers(env = process.env) {
    const urls = (env.TURN_URLS || '').split(',').map(u => u.trim()).filter(Boolean);
    if (urls.length === 0) return [];
    return [{
        urls,
        username: env.TURN_USERNAME || undefined,
        credential: env.TURN_CREDENTIAL || undefined
    }];
}

// Browsers time out on port 53 TURN URLs, so drop them
function withoutPort53(iceServers) {
    return iceServers
        .map(server => {
            const urls = (Array.isArray(server.urls) ? server.urls : [server.urls])
                .filter(url => !/:53(\?|$)/.test(url));
            return { ...server, urls };
        })
        .filter(server => server.urls.length > 0);
}

async function fetchCloudflareTurnServers(keyId, apiToken) {
    const res = await fetch(`${CLOUDFLARE_API}/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${apiToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ ttl: CREDENTIAL_TTL_SECONDS }),
        signal: AbortSignal.timeout(5000)
    });
    if (!res.ok) {
        throw new Error(`Cloudflare TURN API returned HTTP ${res.status}`);
    }
    const data = await res.json();
    if (!data || !Array.isArray(data.iceServers)) {
        throw new Error('Cloudflare TURN API returned no iceServers');
    }
    return withoutPort53(data.iceServers);
}

async function getTurnServers(env = process.env) {
    const keyId = env.CLOUDFLARE_TURN_KEY_ID;
    const apiToken = env.CLOUDFLARE_TURN_API_TOKEN;
    if (!keyId || !apiToken) return getStaticTurnServers(env);

    if (cached && cached.expiresAt - Date.now() > MIN_REMAINING_MS) {
        return cached.iceServers;
    }

    // Share one in-flight request between concurrent callers
    if (!pending) {
        pending = fetchCloudflareTurnServers(keyId, apiToken)
            .then(iceServers => {
                cached = { iceServers, expiresAt: Date.now() + CREDENTIAL_TTL_SECONDS * 1000 };
                return iceServers;
            })
            .finally(() => { pending = null; });
    }

    try {
        return await pending;
    } catch (err) {
        console.error('Could not get Cloudflare TURN credentials:', err.message);
        // Fall back to still-valid cached credentials, then to fixed ones
        if (cached && cached.expiresAt > Date.now()) return cached.iceServers;
        return getStaticTurnServers(env);
    }
}

function resetTurnCache() {
    cached = null;
    pending = null;
}

module.exports = { getTurnServers, resetTurnCache };
