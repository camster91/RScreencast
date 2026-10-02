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
| `TURN_URLS` | _(empty)_ | Comma-separated TURN relay URLs. Needed on strict networks (corporate, campus) where direct connections fail. |
| `TURN_USERNAME` | _(empty)_ | TURN username |
| `TURN_CREDENTIAL` | _(empty)_ | TURN password |
| `PEERJS_DEBUG` | `false` | Extra PeerJS logging |

The browser loads these from `/config`. TURN credentials are sent to every visitor, so use a TURN account meant for this (most providers offer restricted or short-lived credentials).

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

## Technical Stack

- **Frontend**: Vanilla JavaScript, no build process required
- **Signaling**: PeerJS Cloud, or PeerJS running on Node.js (`PEER_SERVER=self`)
- **WebRTC**: Direct peer-to-peer connections
- **UI**: Lucide icons, QRCode.js for code generation
