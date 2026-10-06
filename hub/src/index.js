// Home page: a list of the room tools, plus a friendly 404.
// Other Workers own their paths (/cast, /clicker, /book); this one gets the rest.
// SITE_NAME, SITE_INTRO and CANONICAL_HOST are set in the Cloudflare dashboard.
import { APPS } from "./apps.js";

const LOCK_ICON = '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>';
const ARROW_ICON = '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>';
const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
};

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function svg(body, cls) {
  return `<svg class="${cls}" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

function appCard(app) {
  const staff = app.staffOnly ? `<span class="badge">${svg(LOCK_ICON, "badge-icon")}Staff login</span>` : "";
  return `
        <a class="card" href="${escapeHtml(app.path)}">
            <div class="card-icon">${svg(app.icon, "icon")}</div>
            <div class="card-body">
                <h2>${escapeHtml(app.name)} ${staff}</h2>
                <p>${escapeHtml(app.description)}</p>
            </div>
            ${svg(ARROW_ICON, "arrow")}
        </a>`;
}

function page({ title, heading, intro, siteName, status = 200 }) {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(title)}</title>
    <style>
        :root {
            --bg: #f6f7fb;
            --card: #ffffff;
            --border: #e3e6ef;
            --text: #141824;
            --text-dim: #5b6274;
            --accent: #16803c;
            --accent-soft: rgba(22, 128, 60, 0.1);
        }
        @media (prefers-color-scheme: dark) {
            :root {
                --bg: #0f172a;
                --card: #1e293b;
                --border: rgba(255, 255, 255, 0.08);
                --text: #f8fafc;
                --text-dim: #94a3b8;
                --accent: #22c55e;
                --accent-soft: rgba(34, 197, 94, 0.12);
            }
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
            background: var(--bg);
            color: var(--text);
            min-height: 100vh;
            padding: 48px 16px;
        }
        main { max-width: 720px; margin: 0 auto; }
        header { margin-bottom: 32px; }
        h1 { font-size: 2rem; letter-spacing: -0.02em; }
        .intro { color: var(--text-dim); margin-top: 8px; font-size: 1.05rem; }
        .apps { display: grid; gap: 12px; }
        .card {
            display: flex;
            align-items: center;
            gap: 16px;
            padding: 20px;
            background: var(--card);
            border: 1px solid var(--border);
            border-radius: 16px;
            color: inherit;
            text-decoration: none;
            transition: border-color 0.15s, transform 0.15s;
        }
        .card:hover, .card:focus-visible { border-color: var(--accent); transform: translateY(-1px); }
        .card:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
        .card-icon {
            flex: none;
            width: 48px;
            height: 48px;
            border-radius: 12px;
            background: var(--accent-soft);
            color: var(--accent);
            display: grid;
            place-items: center;
        }
        .card-body { flex: 1; min-width: 0; }
        h2 { font-size: 1.1rem; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .card-body p { color: var(--text-dim); margin-top: 4px; font-size: 0.95rem; line-height: 1.4; }
        .badge {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            font-size: 0.75rem;
            font-weight: 600;
            color: var(--text-dim);
            border: 1px solid var(--border);
            border-radius: 99px;
            padding: 2px 8px;
        }
        .badge-icon { width: 12px; height: 12px; }
        .arrow { flex: none; color: var(--text-dim); }
        footer { margin-top: 32px; color: var(--text-dim); font-size: 0.85rem; }
    </style>
</head>
<body>
    <main>
        <header>
            <h1>${escapeHtml(heading)}</h1>
            <p class="intro">${escapeHtml(intro)}</p>
        </header>
        <nav class="apps" aria-label="Apps">${APPS.filter((app) => !app.hidden).map(appCard).join("")}
        </nav>
        <footer>${escapeHtml(siteName)}</footer>
    </main>
</body>
</html>`;
  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300", ...SECURITY_HEADERS }
  });
}

export default {
  async fetch(request, env = {}) {
    const url = new URL(request.url);
    const host = env.CANONICAL_HOST;
    const siteName = env.SITE_NAME || "Room Tools";
    // www, app, ai, admin... all go to the main address
    if (host && url.hostname !== host && url.hostname.endsWith(`.${host}`)) {
      return Response.redirect(`https://${host}${url.pathname}${url.search}`, 301);
    }
    if (url.pathname === "/favicon.ico") return new Response(null, { status: 204 });
    if (url.pathname === "/health") return new Response("OK");
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return page({ title: siteName, heading: siteName, intro: env.SITE_INTRO || "Tools for meeting rooms and events.", siteName });
    }
    return page({ title: `Page not found · ${siteName}`, heading: "Page not found", siteName, intro: "That page doesn’t exist. Try one of these:", status: 404 });
  }
};
