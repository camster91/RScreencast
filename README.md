# Rscreencast (QuickShare)

Browser-based wireless screen sharing for meeting rooms: the room PC shows a QR code and a 5-character code, and presenters share their laptop screen to the room display over WebRTC. No app install, no cables.

Built for the Rotman AV team (University of Toronto) as a lightweight alternative to hardware wireless presentation systems.

## What it does and why

Meeting rooms often need a way for guests to put their screen on the room display without installing software or plugging in. QuickShare runs entirely in the browser. The room PC opens the page in host mode; a presenter scans the QR code (or types the code), asks to join, and once the host approves, picks a screen or window to share. Video goes peer-to-peer over WebRTC, with a TURN relay as a fallback for strict corporate and campus networks.

## Key features

- **Host mode (room PC)**: generates a 5-character room code that survives reloads, shows a QR code, displays the shared screen full-screen and keeps the display awake (Screen Wake Lock)
- **Join mode (presenter)**: go to `rotmanav.ca/join` (shown on the room screen; it forwards to `/cast/join`) and type the code, or scan the QR code, ask to share, then choose a screen, window or tab. Phones are told up front to use a computer and can send the link to it
- **Host approval**: presenters can only share after someone at the room screen clicks Accept. A 4-character check code is shown on both screens so the host can confirm who is asking
- **Several presenters**: multiple people can join; the room screen switches between them, ends a share, removes people, or locks the room to new requests. Controls fade out while a screen is shown
- **Self-healing connections**: reconnects on its own when the network or signaling server drops, and cleans up presenters who leave, crash or go offline
- **Two server options from one codebase**: a Cloudflare Worker with signaling in a Durable Object, or a Node.js/Express server with a PeerJS signaling server (also packaged as a Docker image)
- **TURN relay support**: Cloudflare TURN with short-lived credentials minted on the server (the API token never reaches the browser), or any TURN server with fixed credentials
- **Security hardening**: strict Content Security Policy (scripts only from the same origin, libraries vendored locally, no inline handlers), a Permissions-Policy that allows screen capture only, no framing, and message size and rate limits on the signaling server

## Tech stack

- Vanilla JavaScript, HTML and CSS (no build step)
- WebRTC via PeerJS, QRCode.js (both vendored in `public/vendor/`)
- Cloudflare Workers and Durable Objects (`worker/index.js`, `wrangler.toml`)
- Node.js, Express and the `peer` PeerJS server (`server.js`), Dockerfile
- Tests: Node's built-in test runner, Playwright (headless Chromium) for the end-to-end test
- GitHub Actions CI

## Running locally

Requires Node.js 20+. Screen sharing needs HTTPS or `localhost`.

```bash
npm install
cp .env.example .env   # optional: signaling mode and TURN settings
npm start              # Node.js server on PORT (default 3000)
```

Open the page on the room PC to get a room code, then open `/join` on a laptop and enter that code.

To run the Cloudflare Worker version locally instead:

```bash
npx wrangler dev
```

### Configuration

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `3000` | Port for the Node.js server |
| `PEER_SERVER` | `cloud` | `cloud` uses the public PeerJS Cloud server, `self` uses this app's own signaling server (needs WebSocket support) |
| `CLOUDFLARE_TURN_KEY_ID`, `CLOUDFLARE_TURN_API_TOKEN` | empty | Cloudflare TURN key; the server exchanges it for short-lived credentials |
| `TURN_URLS`, `TURN_USERNAME`, `TURN_CREDENTIAL` | empty | Any other TURN server (also used as a fallback) |
| `PEERJS_DEBUG` | `false` | Extra PeerJS logging |
| `JOIN_ADDRESS` | `<host>/cast/join` | Worker only: the short address the room screen tells presenters to type. `rotmanav.ca/join` in `wrangler.toml` |
| `TRUST_PROXY` | off | Set when the Node.js server runs behind a reverse proxy, so the rate limit sees each visitor's real IP. `1` for one proxy (Nginx, Traefik, Coolify), or a list of proxy IPs/subnets. Leave it off when the server faces the internet directly, or visitors could fake their IP |
| `RATE_LIMIT_PER_MINUTE` | `300` | Requests per minute per IP on the Node.js server (`/health` is never limited) |
| `CONFIG_RATE_LIMIT_PER_MINUTE` | `60` | Lower limit for `/config`, which hands out TURN credentials |

The browser loads its ICE server list from `/config` and refreshes it every hour. To deploy the Worker to your own Cloudflare account, update the account and routes in `wrangler.toml`, set the two TURN secrets with `npx wrangler secret put`, and run `npx wrangler deploy`.

## Testing

```bash
npm test          # unit tests (TURN credentials, security headers)
npm run test:e2e  # browser test: a room PC and presenters in headless Chromium
```

The end-to-end test starts `server.js` itself. To test the Worker instead, run `npx wrangler dev` and `BASE=http://localhost:8787/cast npm run test:e2e`. Both run in CI.

## Project structure

| Path | What it is |
|---|---|
| `public/index.html`, `app.css`, `app.js` | The page (host and presenter views) |
| `public/icons.js` | Inline SVG icons used by the page |
| `public/vendor/` | PeerJS and QRCode.js, served locally |
| `worker/index.js` | Cloudflare Worker: serves `public/`, `/config` and signaling (Durable Object) |
| `server.js` | Node.js server for local use or Docker |
| `turn.js`, `headers.js` | Shared by both servers: TURN credentials and security headers |
| `e2e/`, `test/` | End-to-end and unit tests |

See [TODO.md](TODO.md) for ideas not yet built.
