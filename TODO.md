# QuickShare Room Hub - Roadmap

## Done

- [x] Self-hosted signaling on Cloudflare (Durable Object) and Node.js
- [x] Cloudflare TURN relay with short-lived credentials
- [x] Reconnects on its own; room code survives reloads
- [x] Cleans up presenters who leave, crash or lose network
- [x] Libraries served locally (no CDN); strict Content Security Policy
- [x] Page split into HTML, CSS and JS; no inline event handlers
- [x] Room PC screen stays awake (Screen Wake Lock)
- [x] Unit tests and end-to-end browser test, run in CI

## Ideas

- [ ] Presenters can type their name (shown to the host)
- [ ] Optional room password
- [ ] Show several presenters side by side
- [ ] Full-screen toggle on the room PC
- [ ] Connection quality indicator
