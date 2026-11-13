// A stand-in host app for the review panel: what a host app's server does, in one file.
// It signs a short-lived token for its signed-in user (here a fixed one) with the secret it shares
// with doop (DOOP_EMBED_HOSTS), and its page embeds doop's /embed with that token in the fragment.
// It answers the panel's doop:need-token with a fresh token and logs every message the panel sends.
// usage: HOST_SECRET=<32+ chars> DOOP=http://localhost:4477 CANVAS=<id> node embed-host.mjs [port=4499]
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
const { SignJWT } = createRequire(new URL("../build/doop/package.json", import.meta.url))("jose");
const port = Number(process.argv[2] || 4499);
const doop = process.env.DOOP || "http://localhost:4477";
const secret = new TextEncoder().encode(process.env.HOST_SECRET);
const hostId = process.env.HOST_ID || "local";

// what the host app's server would expose to its own signed-in user: POST /review-token -> { token }
async function reviewToken({ userId, name, canvas, role = "review" }) {
  return new SignJWT({ name, canvas, role })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(hostId).setAudience("doop").setSubject(userId)
    .setIssuedAt().setExpirationTime("5m").setJti(randomUUID())
    .sign(secret);
}

const page = (src) => `<!doctype html><html><head><meta charset="utf-8"><title>Host app</title>
<style>body{margin:0;font:13px system-ui;display:grid;grid-template-rows:40px 1fr 90px;height:100vh}
header{display:flex;align-items:center;padding:0 14px;border-bottom:1px solid #ddd;font-weight:600}
iframe{border:0;width:100%;height:100%}pre{margin:0;padding:8px 14px;background:#f6f6f5;overflow:auto;font-size:11px}</style></head>
<body><header>Host app · Design review</header><iframe id="panel" src="${src}"></iframe><pre id="log"></pre>
<script>
const doop = ${JSON.stringify(new URL(doop).origin)};
window.__msgs = [];
addEventListener('message', async (ev) => {
  if (ev.origin !== doop) return;                  // only the panel, by its origin
  window.__msgs.push(ev.data);
  document.getElementById('log').textContent = window.__msgs.map((m) => JSON.stringify(m)).join('\\n');
  if (ev.data && ev.data.type === 'doop:need-token') {
    const { token } = await (await fetch('/review-token', { method: 'POST' })).json();
    document.getElementById('panel').contentWindow.postMessage({ type: 'doop:token', token }, doop);
  }
});
</script></body></html>`;

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  const who = { userId: "user-123", name: "A reviewer", canvas: process.env.CANVAS };
  if (req.method === "POST" && url.pathname === "/review-token") {
    res.setHeader("content-type", "application/json");
    return res.end(JSON.stringify({ token: await reviewToken(who) }));
  }
  if (url.pathname === "/") {
    const token = await reviewToken({ ...who, role: url.searchParams.get("role") || "review" });
    const frame = url.searchParams.get("frame");
    res.setHeader("content-type", "text/html");
    return res.end(page(`${doop}/embed#token=${encodeURIComponent(token)}${frame ? `&frame=${encodeURIComponent(frame)}` : ""}`));
  }
  res.statusCode = 404; res.end();
}).listen(port, () => console.log(`host app on http://localhost:${port}`));
