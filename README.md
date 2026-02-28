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
   - **Room PC (Host)**: Open `https://joinmeeting.space` - displays QR code and 5-digit PIN
   - **Laptop (Client)**: Scan QR code or enter PIN manually

## How It Works

### Desktop/Room PC (Host Mode)
- Automatically generates a unique 5-character PIN code
- Displays QR code for quick joining
- Shows local webcam in bottom-right corner
- Waits for incoming screen share from client
- Displays shared screen in full-screen when client connects

### Laptop/Client (Join Mode)
- Scan QR code or manually enter the 5-digit PIN
- Click "Start Screen Share" button
- Select which screen/window to share
- Host's display will show your shared screen

## Architecture

**Simple PIN-Based Connection:**
- Host generates a unique peer ID, displays first 5 characters as PIN
- Client enters PIN and connects directly via WebRTC
- No complex multi-user conferencing, just 1:1 screen sharing
- Host shows local webcam, client shares screen only

## Troubleshooting

### Screen not appearing on host display?
1. Make sure you clicked "Start Screen Share" on the client device
2. Check browser console (F12) for errors on both devices
3. Ensure both devices are using HTTPS (required for screen sharing)

### Connection issues?
- Verify both devices can reach the server
- Check that the PIN code matches exactly (5 characters)
- Try refreshing both pages and starting over
- Ensure WebRTC is not blocked by firewall

## Deployment

The app is configured for `joinmeeting.space`. To deploy:
1. Push code to your repository
2. Restart the Node.js process on your server
3. Ensure HTTPS is enabled (required for WebRTC)

## Technical Stack

- **Frontend**: Vanilla JavaScript, no build process required
- **Signaling**: PeerJS running on Node.js
- **WebRTC**: Direct peer-to-peer connections
- **UI**: Lucide icons, QRCode.js for code generation
