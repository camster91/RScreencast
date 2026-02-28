# QuickShare Room Hub - Improvement Roadmap

This document tracks recommended improvements for the QuickShare Room Hub application.

## Critical - Testing

- [ ] **Add testing framework** - Install Jest or Mocha for unit/integration tests
- [ ] **Server tests** - Test health endpoint, static file serving, PeerJS integration
- [ ] **E2E tests** - Add Playwright/Puppeteer for end-to-end WebRTC flow testing
- [ ] **Add npm test script** - Configure `npm test` command in package.json

## High Priority - Code Quality

- [ ] **Split monolithic HTML** - Extract the 1000+ line index.html into separate files:
  - `css/styles.css` - Extract CSS styles
  - `js/host.js` - Host mode functionality
  - `js/client.js` - Client/presenter functionality
  - `js/peer-manager.js` - PeerJS connection management
  - `js/ui.js` - UI state management and DOM manipulation
- [ ] **Add ESLint** - Configure linting for consistent code style
- [ ] **Add Prettier** - Automated code formatting
- [ ] **Consider TypeScript** - Add type safety to JavaScript code

## High Priority - Security

- [ ] **Rate limiting** - Add express-rate-limit to prevent abuse
- [ ] **Configurable trust proxy** - Make `app.set('trust proxy')` configurable via environment variable
- [x] **Input validation** - Validate room codes client-side and sanitize user-controlled data
- [x] **Security headers** - Added X-Content-Type-Options, X-Frame-Options, X-XSS-Protection, Referrer-Policy
- [ ] **CSP headers** - Add Content Security Policy headers
- [ ] **CORS configuration** - Configure CORS if needed for API access
- [x] **XSS prevention** - Added escapeHtml utility, sanitize all user data in innerHTML
- [x] **Pin CDN versions** - Pinned lucide to specific version (was @latest)

## Medium Priority - Reliability

- [ ] **WebRTC reconnection** - Implement automatic reconnection on ICE failures
- [x] **PeerJS connection retry** - Added exponential backoff with max 5 reconnect attempts
- [ ] **Graceful degradation** - Handle scenarios where WebRTC is not supported
- [ ] **Connection state monitoring** - Display connection quality indicators
- [ ] **Heartbeat mechanism** - Detect and handle stale connections

## Medium Priority - Features

- [ ] **Room persistence** - Store active rooms in memory/Redis to survive server restarts
- [ ] **Room expiration** - Auto-cleanup rooms after inactivity timeout
- [ ] **Multiple display support** - Allow host to view multiple presenters simultaneously
- [ ] **Full-screen mode** - Add dedicated full-screen toggle for viewing
- [ ] **Presenter names** - Allow presenters to set custom display names
- [ ] **Room passwords** - Optional password protection for rooms
- [ ] **Chat functionality** - Simple text chat between host and presenters

## Low Priority - Performance

- [ ] **Bundle assets** - Use Vite/Webpack to bundle and minify frontend assets
- [ ] **Lazy load icons** - Load Lucide icons on-demand instead of all upfront
- [ ] **Service worker** - Add offline support and caching
- [ ] **Compression** - Enable gzip compression for static assets

## Low Priority - DevOps

- [ ] **Docker support** - Add Dockerfile and docker-compose.yml
- [ ] **CI/CD pipeline** - Add GitHub Actions for testing and deployment
- [ ] **Environment configuration** - Use dotenv for environment variables
- [ ] **Logging** - Add structured logging with Winston or Pino
- [ ] **Health check improvements** - Return JSON with service status details

## Low Priority - Documentation

- [ ] **API documentation** - Document the PeerJS signaling protocol
- [ ] **Architecture diagram** - Create visual diagram of WebRTC flow
- [ ] **Deployment guide** - Add detailed deployment instructions for various platforms
- [ ] **Contributing guide** - Add CONTRIBUTING.md with development setup

## Known Issues

- None currently tracked

## Recently Fixed

- [x] **XSS vulnerability** - User-controlled peer names were inserted into innerHTML without escaping
- [x] **Peer open race condition** - initHost() could miss the peer.on('open') event if peer connected before handler registered
- [x] **Infinite reconnect loop** - peer.on('disconnected') blindly called reconnect() with no limit or backoff
- [x] **peer-unavailable error mishandled** - PeerJS fires this on Peer object, not connection; added global handler
- [x] **Memory leaks** - Stream tracks not stopped on call close; call objects leaked in shareScreen()
- [x] **No page unload cleanup** - Streams, calls, and peer connections not cleaned up on beforeunload
- [x] **CDN supply chain risk** - lucide loaded with @latest tag; pinned to specific version
- [x] **Server middleware order** - server.listen() called before middleware registered; imports scattered
- [x] **No server error handling** - Added EADDRINUSE handling and graceful SIGTERM/SIGINT shutdown
- [x] **No security headers** - Added X-Content-Type-Options, X-Frame-Options, X-XSS-Protection, Referrer-Policy
- [x] **Missing accessibility** - Added focus-visible styles for buttons and focus styles for inputs

## Completed

- [x] Basic screen sharing functionality
- [x] PIN-based room joining
- [x] QR code generation
- [x] Host approval workflow
- [x] Multi-presenter support
- [x] Presenter switching
- [x] Error handling for invalid/expired room codes
- [x] Hide/show viewing controls
