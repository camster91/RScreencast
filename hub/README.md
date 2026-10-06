# rotmanav.ca hub

The home page at https://rotmanav.ca: a list of the Rotman AV apps, and a "Page not found" page that links back to them.

It is a small Cloudflare Worker (`rotmanav-hub`) with no dependencies. Other Workers handle their own paths (`/cast` is Cast from this repo, `/clicker`, `/book`); this one answers everything else on rotmanav.ca, and sends `www.`, `app.`, `ai.` and `admin.` to the main address.

## Add or change an app

Edit `src/apps.js` (name, path, one-line description, Lucide icon, `staffOnly: true` for a "Staff login" badge, `hidden: true` to take it off the page), then deploy.

## Deploy

```bash
cd hub
npx wrangler deploy
```

This folder is not auto-deployed. It lives here until it gets its own repository.
