# QuickShare Hub (WebRTC Signaling Server)
# Dockerfile for Coolify/Container Deployment

# Use Node.js LTS Alpine for smaller image
FROM node:20-alpine

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy app source
COPY . .

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs
RUN adduser -S websocket -u 1001

# Set permissions
RUN chown -R websocket:nodejs /app
USER websocket

# Expose port (matches server.js port variable)
EXPOSE 3000

# WebRTC signaling requires WebSocket support
# Note: For production, ensure your reverse proxy (Nginx) handles WebSocket upgrades
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Start the application
CMD ["node", "server.js"]