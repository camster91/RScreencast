# Rotman Meeting Rooms - QuickShare Hub

A simple PIN-based screen sharing system using WebRTC for meeting rooms and collaboration spaces. Enables easy screen sharing between room displays and participant devices.

## Quick Start

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Start the server:**
   ```bash
   npm start
   ```

3. **Access the app:**
   - **Room PC (Host)**: Open `https://joinmeeting.space` - displays QR code and 5-character room code
   - **Laptop (Client)**: Scan QR code or enter the code manually

## How It Works

### Desktop/Room PC (Host Mode)
- Generates a 5-character room code (kept if the page reloads)
- Displays QR code for quick joining
- Approves or denies each presenter, and can remove them
- Displays the shared screen full-screen; switches between presenters
- Reconnects on its own if the network or server drops

### Laptop/Client (Join Mode)
- Scan QR code or manually enter the 5-character code
- Click "Request to Join" and wait for the host to approve
- Select which screen/window to share
- Host's display will show your shared screen

## Architecture

**Simple code-based connection:**
- The host's room code is its PeerJS ID
- Client enters the code and connects directly via WebRTC
- Several presenters can join; the host shows one screen at a time

## Configuration

Set these environment variables (see `.env.example`):

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `3000` | Port the server listens on |
| `PEER_SERVER` | `cloud` | `cloud` uses the free PeerJS Cloud server. `self` uses this app's own server (needs WebSocket support from your host/proxy). |
| `CLOUDFLARE_TURN_KEY_ID` | _(empty)_ | Cloudflare TURN key ID (recommended TURN setup, see below) |
| `CLOUDFLARE_TURN_API_TOKEN` | _(empty)_ | Cloudflare TURN key API token. Stays on the server. |
| `TURN_URLS` | _(empty)_ | Comma-separated TURN relay URLs for any other TURN server. Also used as a fallback if Cloudflare fails. |
| `TURN_USERNAME` | _(empty)_ | TURN username |
| `TURN_CREDENTIAL` | _(empty)_ | TURN password |
| `PEERJS_DEBUG` | `false` | Extra PeerJS logging |

The browser loads these from `/config` (and refreshes them every hour).

### TURN relay (for strict networks)

A TURN relay passes the video through a server when two devices can't connect directly, which is common on corporate and campus networks.

**Cloudflare TURN (recommended)** - the first 1,000 GB a month is free, then $0.05/GB.
1. In the Cloudflare dashboard, go to **Realtime > TURN Server** and create a TURN key.
2. Copy the **Key ID** and **API token**.
3. Set `CLOUDFLARE_TURN_KEY_ID` and `CLOUDFLARE_TURN_API_TOKEN` on the server and restart it.
4. Check `https://<your-site>/config` - `iceServers` should list `turn.cloudflare.com`.

The server asks Cloudflare for credentials that expire after 24 hours, so the API token is never sent to browsers. If Cloudflare can't be reached, the app falls back to `TURN_URLS` (if set) or works without a relay.

**Other TURN servers** - set `TURN_URLS`, `TURN_USERNAME` and `TURN_CREDENTIAL`. These fixed credentials are sent to every visitor.

## Troubleshooting

### Screen not appearing on host display?
1. Make sure you clicked "Start Screen Share" on the client device
2. Check browser console (F12) for errors on both devices
3. Ensure both devices are using HTTPS (required for screen sharing)

### Connection issues?
- Verify both devices can reach the server
- Check that the room code matches exactly (5 characters)
- On corporate or campus networks, set up a TURN relay (see Configuration)
- Try refreshing both pages and starting over
- Ensure WebRTC is not blocked by firewall

## Deployment

The app is configured for `joinmeeting.space`. To deploy:
1. Push code to your repository
2. Restart the Node.js process on your server
3. Ensure HTTPS is enabled (required for WebRTC)

## Cloudflare Deployment

The app runs on Cloudflare Workers (account **Cameron Rotman**) at
**https://quickshare.cameron-rotman.workers.dev**.

- `worker/index.js` serves the page and `/config`, and runs PeerJS signaling in a
  Durable Object (no PeerJS Cloud needed). It reuses `turn.js` for Cloudflare TURN.
- TURN secrets `CLOUDFLARE_TURN_KEY_ID` and `CLOUDFLARE_TURN_API_TOKEN` are already
  set on the Worker.
- Fits the Workers Free plan: heartbeats are answered without waking the Durable Object.

To redeploy after changes:

```bash
npx wrangler login     # once
npx wrangler deploy
```

`server.js` still works for local development and Docker (`npm start`).

## Technical Stack

- **Frontend**: Vanilla JavaScript, no build process required
- **Signaling**: PeerJS Cloud, or PeerJS running on Node.js (`PEER_SERVER=self`)
- **WebRTC**: Direct peer-to-peer connections
- **UI**: Lucide icons, QRCode.js for code generation
