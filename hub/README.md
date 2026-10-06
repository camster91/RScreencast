# Hub

The site's home page: a list of the apps, and a "Page not found" page that links back to them.

It is a small Cloudflare Worker with no dependencies. Other Workers handle their own paths (`/cast` is Cast from this repo, `/clicker`, `/book`); this one answers everything else on the site, and sends `www.`, `app.`, `ai.` and `admin.` to the main address. The site name, intro line and main hostname are settings in the Cloudflare dashboard (`SITE_NAME`, `SITE_INTRO`, `CANONICAL_HOST`), not in this repo.

## Add or change an app

Edit `src/apps.js` (name, path, one-line description, Lucide icon, `staffOnly: true` for a "Staff login" badge, `hidden: true` to take it off the page), then deploy.

## Deploy

```bash
cd hub
npx wrangler deploy --name <hub-worker-name>
```

This folder is not auto-deployed. It lives here until it gets its own repository.
