# Cast - To Do

## Next up

- [ ] Merge PR #20 (UX polish). Merging to `main` deploys to rotmanav.ca/cast
- [ ] Live test with two real devices: room PC + laptop, on the office Wi-Fi and on a guest network (checks the TURN relay)
- [ ] Test on the actual room TV: text size, QR scan distance, sound
- [ ] Decide who can open Cast. Today it is behind the staff login (Cloudflare Access), so guests can't present
- [ ] Fix the other rotmanav.ca addresses that show Cloudflare "error 1000" (DNS records point at Cloudflare IPs)
- [ ] Add Booking (`/book`) to the rotmanav.ca hub page
- [ ] Put the hub's code in its own GitHub repo (it only exists as a deployed Worker today)

## Later (optional)

- [ ] Turn on branch protection for `main`
- [ ] Re-enable the Codex review bot (out of credits) or remove it
- [ ] Presenters can type their name (shown on the room screen)
- [ ] Optional room password
- [ ] Show several presenters side by side
- [ ] Connection quality indicator

## Done

- [x] Self-hosted signaling on Cloudflare (Durable Object) and Node.js
- [x] Cloudflare TURN relay with short-lived credentials
- [x] Live at rotmanav.ca/cast (share.rotmanav.ca redirects), auto-deploys from `main`
- [x] Rate limit, HSTS and security headers; workers.dev turned off
- [x] Presenter check code, room lock, host approval
- [x] Reconnects on its own; room code survives reloads
- [x] Cleans up presenters who leave, crash or lose network
- [x] Libraries served locally (no CDN); strict Content Security Policy
- [x] Room PC screen stays awake (Screen Wake Lock)
- [x] Full-screen button on the room screen
- [x] Short `/join` address; phones are told to use a computer
- [x] Unit tests and end-to-end browser test, run in CI
