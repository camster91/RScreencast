# QuickShare Room Hub

A self-hosted meeting room screen sharing hub using WebRTC.

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
   - **Room PC (Host)**: Open `https://joinmeeting.space` - displays QR code and room code
   - **Laptop (Client)**: Scan QR or enter room code manually

## How It Works

### Desktop/Room PC (Host Mode)
- Automatically generates a unique 5-character room code
- Displays QR code for quick joining
- Shows local webcam in bottom-right corner
- Waits for incoming screen share from laptop

### Laptop (Client Mode)
- Enter the room code or scan QR
- Click "Start Screen Share" button
- Select which screen/window to share
- Desktop will display your shared screen

## Troubleshooting

### Screen not appearing on desktop?
1. Make sure you clicked "Start Screen Share" on the laptop
2. Check browser console (F12) for errors on both devices
3. Ensure both devices are using HTTPS (required for screen sharing)

### Connection issues?
- Verify both devices can reach the server
- Check that the room code matches exactly
- Try refreshing both pages and starting over

## Deployment

The app is configured for `joinmeeting.space`. To deploy:
1. Push code to your repository
2. Restart the Node.js process on your server
3. Ensure HTTPS is enabled (required for WebRTC)
