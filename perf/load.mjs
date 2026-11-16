// The first load of a canvas, traced: from navigation until the canvas is in view and quiet.
// usage: node load.mjs <out-prefix> [runs=1]
//   DOOP=<url> (default http://localhost:4477), LOCAL=<json> ({canvas, email, password}; default ./local.json),
//   or CANVAS / DOOP_EMAIL / DOOP_PASSWORD in the environment instead.
//   WARM=1: load once first, so the run reads the HTTP cache (a returning visitor); default cold.
//   NET=4g|slow4g|none (default none): the link, shaped on the wire by a TCP proxy in this script (Chrome's own
//   throttling meters a WebSocket message after inflating it, so it cannot see compression), shared by every
//   connection, QUIC off; CPU=<throttle rate> (default 1), PAGE=<page id>, VIEW=1440x900,
//   LS='{"key":"value"}' sets localStorage first, NOTRACE=1 skips the trace (milestones only),
//   SHOT=1 saves a screenshot of the end state. NODEFLATE=1 (with NET, plain http): the link strips the page's
//   WebSocket compression offer, so the server answers uncompressed (an A/B of the socket's compression).
// Writes <prefix>.trace.json (open in Chrome DevTools → Performance → Load profile for the flame chart;
// analyze.mjs and jsprof.mjs read its L1-load marks) and <prefix>.json (milestones, requests, long tasks),
// and prints a summary. Milestones are ms from navigation start, measured in the page.
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import net from "node:net";
import { Transform } from "node:stream";
const puppeteer = createRequire(new URL("../build/doop/package.json", import.meta.url))("puppeteer-core");
const [prefix = "out/load", runsArg = "1"] = process.argv.slice(2);
const localPath = new URL(process.env.LOCAL || "./local.json", import.meta.url);
const loc = existsSync(localPath) && !process.env.DOOP_EMAIL ? JSON.parse(readFileSync(localPath)) : {};
const cred = { email: process.env.DOOP_EMAIL || loc.email, password: process.env.DOOP_PASSWORD || loc.password };
const canvas = process.env.CANVAS || loc.canvas;
const L = process.env.DOOP || "http://localhost:4477";
let B = L; /* where the page goes: L, or the shaped link in front of it */
const [vw, vh] = (process.env.VIEW || "1440x900").split("x").map(Number);
/* DevTools' presets: round trip ms, down and up bits per second */
const NETS = { "4g": { rtt: 60, down: 9e6, up: 1.5e6 }, slow4g: { rtt: 150, down: 1.6e6, up: 0.75e6 } };
/* one shaped link: each direction a queue that sends at its rate, plus half the round trip */
async function shapedLink(target, { rtt, down, up }, rewrite) {
  const lane = (bits) => { let free = 0; return (len) => { const now = performance.now(); free = Math.max(now, free) + (len * 8 * 1000) / bits; return free + rtt / 2 - now; }; };
  const toPage = lane(down), toServer = lane(up);
  /* chunks leave in order from one queue per direction of a connection: timers of different lengths can fire
     out of order within a millisecond, and a reordered chunk corrupts the stream */
  const pipe = (from, to, when) => {
    const q = []; let timer = null;
    const drain = () => { timer = null; const now = performance.now(); while (q.length && q[0].at <= now + 1) { const { c } = q.shift(); if (c === null) to.end(); else if (to.writable) to.write(c); } if (q.length) timer = setTimeout(drain, q[0].at - now); };
    const push = (c) => { q.push({ c, at: performance.now() + when(c ? c.length : 0) }); if (!timer) timer = setTimeout(drain, q[0].at - performance.now()); };
    from.on("data", push).on("end", () => push(null)).on("error", () => to.destroy());
  };
  /* plain http only: the page's requests name the proxy, the server is told its own name (its auth checks Origin) */
  const inbound = (from) => (rewrite ? from.pipe(new Transform({ transform(c, _e, cb) { cb(null, Buffer.from(rewrite(c.toString("latin1")), "latin1")); } })) : from);
  const srv = net.createServer((c) => { const s = net.connect(target.port, target.host); pipe(inbound(c), s, toServer); pipe(s, c, toPage); });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  return { port: srv.address().port, close: () => srv.close() };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* in the page, from its first script: milestones as the editor reaches them */
function probe() {
  const t = (window.__load = { marks: {}, longtasks: [] });
  const at = (name) => { if (!(name in t.marks)) t.marks[name] = Math.round(performance.now()); };
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.name === "first-contentful-paint") at("fcp"); }).observe({ type: "paint", buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) t.marks.lcp = Math.round(e.startTime); }).observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) t.longtasks.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ type: "longtask", buffered: true });
  } catch {}
  /* documents made and torn down on the way (live frames, previews' renderers) */
  t.iframes = [];
  new MutationObserver((ms) => { for (const m of ms) { for (const n of m.addedNodes) for (const f of n.nodeType === 1 ? (n.tagName === "IFRAME" ? [n] : n.querySelectorAll("iframe")) : []) t.iframes.push(["+", Math.round(performance.now()), f.closest("[data-frame-shell],[data-frame-surface]")?.getAttribute("data-frame-shell") || f.title || f.className.slice(0, 30)]); for (const n of m.removedNodes) if (n.nodeType === 1 && (n.tagName === "IFRAME" || n.querySelector("iframe"))) t.iframes.push(["-", Math.round(performance.now())]); } }).observe(document, { childList: true, subtree: true });
  const inView = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth; };
  const tick = () => {
    if (document.querySelector('[aria-label="Canvas dock"], header')) at("chrome");
    if (document.querySelector(".world")) at("stage");
    const surfaces = [...document.querySelectorAll("[data-frame-surface]")].filter(inView);
    if (surfaces.length) {
      at("frames");
      /* a frame shows something: its picture has decoded, or its live document is shown */
      const shows = (s) => [...s.querySelectorAll("img")].some((i) => i.complete && i.naturalWidth > 0) || [...s.querySelectorAll("iframe")].some((f) => getComputedStyle(f).visibility !== "hidden" && getComputedStyle(f).opacity !== "0");
      const showing = surfaces.filter(shows).length;
      if (showing) at("firstFrameShown");
      if (showing === surfaces.length) at("allFramesShown");
      t.inView = surfaces.length; t.showing = showing;
    }
    if (!t.marks.allFramesShown) setTimeout(tick, 40);
  };
  /* every 40 ms rather than every frame: the reads force a layout, which would be the trace's biggest cost */
  setTimeout(tick, 0);
}

async function once(b, label, trace) {
  const ctx = await b.createBrowserContext();
  const p = await ctx.newPage();
  await p.setViewport({ width: vw, height: vh });
  await p.goto(B + "/", { waitUntil: "domcontentloaded" });
  const ok = await p.evaluate(async (c, ls) => {
    const r = await fetch("/api/auth/sign-in/email", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(c) });
    localStorage.setItem("doop:render-trial", "off");
    for (const [k, v] of Object.entries(ls)) localStorage.setItem(k, v);
    return r.status;
  }, cred, JSON.parse(process.env.LS || "{}"));
  if (ok !== 200) throw new Error("sign-in answered " + ok);
  const url = `${B}/c/${canvas}${process.env.PAGE ? "?page=" + process.env.PAGE : ""}`;
  const cdp = await p.createCDPSession();
  await cdp.send("Network.enable");
  /* the canvas comes over the socket, not as a request: count its messages */
  const ws = { frames: 0, bytes: 0, biggest: 0, firstBig: null, t: 0 };
  cdp.on("Network.webSocketFrameReceived", ({ timestamp, response }) => { const n = response.payloadData.length; ws.frames++; ws.bytes += n; if (n > ws.biggest) ws.biggest = n; if (n > 50000 && ws.firstBig == null) ws.firstBig = Math.round((timestamp - ws.t) * 1000); });
  const since = (ts) => Math.round((ts - ws.t) * 1000);
  cdp.on("Network.webSocketWillSendHandshakeRequest", ({ timestamp }) => { ws.opening ??= since(timestamp); });
  cdp.on("Network.webSocketHandshakeResponseReceived", ({ timestamp, response }) => { ws.open ??= since(timestamp); const h = Object.fromEntries(Object.entries(response.headers).map(([k, v]) => [k.toLowerCase(), v])); ws.ext = h["sec-websocket-extensions"] || "none"; });
  cdp.on("Network.requestWillBeSent", ({ type, timestamp }) => { if (type === "Document") ws.t = timestamp; });
  if (process.env.WARM) { await p.goto(url, { waitUntil: "networkidle2", timeout: 90000 }); await sleep(1500); await p.goto("about:blank"); }
  else await cdp.send("Network.clearBrowserCache");
  if (+process.env.CPU > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: +process.env.CPU });
  await p.evaluateOnNewDocument(probe);
  const errors = [];
  p.on("pageerror", (e) => errors.push("pageerror " + String(e.message).slice(0, 160)));
  p.on("console", (m) => m.type() === "error" && errors.push("console " + m.text().slice(0, 160)));
  p.on("requestfailed", (q) => errors.push(`failed ${q.url().replace(B, "").slice(0, 80)} ${q.failure()?.errorText}`));
  p.on("response", (r) => r.status() >= 400 && errors.push(`${r.status()} ${r.url().replace(B, "").slice(0, 80)}`));
  const bcdp = trace ? await b.target().createCDPSession() : null;
  if (bcdp) await bcdp.send("Tracing.start", { transferMode: "ReturnAsStream", traceConfig: { recordMode: "recordAsMuchAsPossible", includedCategories: ["devtools.timeline", "disabled-by-default-devtools.timeline", "disabled-by-default-devtools.timeline.frame", "v8.execute", "v8", "blink.user_timing", "loading", "latencyInfo", "disabled-by-default-v8.cpu_profiler", "blink", "netlog", "toplevel", "disabled-by-default-devtools.screenshot"] } });
  /* the start mark goes in the page being left: a mark made in the new document would fall inside
     the task that commits it, and a window that starts mid-task drops that task from the analysis */
  await p.evaluate(() => performance.mark("L1-load:start"));
  const t0 = Date.now();
  await p.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
  /* until every frame in view shows something, then 2 s without a long task */
  for (;;) {
    const s = await p.evaluate(() => ({ m: window.__load.marks, lt: window.__load.longtasks.at(-1), now: performance.now() }));
    const lastLong = s.lt ? s.lt[0] + s.lt[1] : 0;
    if ((s.m.allFramesShown && s.now - Math.max(lastLong, s.m.allFramesShown) > 2000) || Date.now() - t0 > 60000) break;
    await sleep(250);
  }
  await p.evaluate(() => performance.mark("L1-load:end"));
  if (process.env.SHOT) await p.screenshot({ path: `${prefix}${label}.png` });
  const res = await p.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0];
    const reqs = performance.getEntriesByType("resource").map((r) => ({ url: r.name.replace(location.origin, ""), type: r.initiatorType, start: Math.round(r.startTime), end: Math.round(r.responseEnd), wait: Math.round(r.responseStart - r.requestStart), bytes: r.transferSize, body: r.decodedBodySize, proto: r.nextHopProtocol }));
    return { ...window.__load, nav: { ttfb: Math.round(nav.responseStart), dcl: Math.round(nav.domContentLoadedEventEnd), load: Math.round(nav.loadEventEnd), bytes: nav.transferSize }, reqs, heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null, dom: document.getElementsByTagName("*").length, iframesLeft: document.querySelectorAll("iframe").length };
  });
  res.ws = { ...ws }; delete res.ws.t;
  res.errors = errors;
  if (bcdp) {
    const done = new Promise((r) => bcdp.once("Tracing.tracingComplete", r));
    await bcdp.send("Tracing.end");
    const { stream } = await done;
    const chunks = []; for (;;) { const c = await bcdp.send("IO.read", { handle: stream, size: 1 << 24 }); chunks.push(c.data); if (c.eof) break; }
    writeFileSync(`${prefix}${label}.trace.json`, chunks.join(""));
  }
  await ctx.close();
  return res;
}

function report(r, label) {
  const m = r.marks;
  console.log(`\n== ${label}  ${L.replace(/^https?:\/\//, "").split("/")[0]} ${process.env.WARM ? "warm" : "cold"} net=${process.env.NET || "none"} cpu=${process.env.CPU || 1}x ${vw}x${vh}`);
  console.log(`ttfb ${r.nav.ttfb} · fcp ${m.fcp} · dcl ${r.nav.dcl} · chrome ${m.chrome} · stage ${m.stage} · frames ${m.frames} · first frame shown ${m.firstFrameShown} · all ${r.showing}/${r.inView} shown ${m.allFramesShown} · lcp ${m.lcp} · load ${r.nav.load}`);
  const lt = r.longtasks; console.log(`long tasks: ${lt.length}, ${lt.reduce((a, x) => a + x[1], 0)} ms in all; worst ${[...lt].sort((a, b) => b[1] - a[1]).slice(0, 6).map((x) => `${x[1]}@${x[0]}`).join(" ")}`);
  const kb = (n) => (n / 1024).toFixed(0);
  const byType = {}; for (const q of r.reqs) { const k = q.url.match(/\.(js|css|woff2?|png|jpe?g|webp)(\?|$)/)?.[1] || (q.url.startsWith("/api") ? "api" : q.type); const o = (byType[k] ||= { n: 0, bytes: 0, body: 0 }); o.n++; o.bytes += q.bytes; o.body += q.body; }
  const made = r.iframes.filter((x) => x[0] === "+"); if (made.length) console.log(`iframes made: ${made.length} (first at ${made[0][1]}, last at ${made.at(-1)[1]}), removed: ${r.iframes.length - made.length}; ` + [...new Set(made.map((x) => x[2]))].slice(0, 6).join(", "));
  console.log(`requests: ${r.reqs.length} · ` + Object.entries(byType).sort((a, b) => b[1].body - a[1].body).map(([k, o]) => `${k} ${o.n}× ${kb(o.bytes)}/${kb(o.body)} KB`).join(" · ") + `  (wire/decoded) · heap ${r.heap} MB · dom ${r.dom} · iframes at the end ${r.iframesLeft}`);
  if (r.errors?.length) console.log("errors: " + r.errors.slice(0, 8).join(" | "));
  if (r.ws) console.log(`socket: ${r.ws.frames} messages, ${(r.ws.bytes / 1024).toFixed(0)} KB (as text), opened ${r.ws.opening}→${r.ws.open} ms, biggest ${(r.ws.biggest / 1024).toFixed(0)} KB, extensions: ${r.ws.ext}${r.ws.firstBig != null ? ` at ~${r.ws.firstBig} ms` : ""}`);
  console.log("waterfall (start→end ms, wait, wire KB, url):");
  for (const q of [...r.reqs].sort((a, b) => a.start - b.start).filter((q) => q.end - q.start > 40 || q.body > 30000).slice(0, 40)) console.log(`  ${String(q.start).padStart(6)}→${String(q.end).padEnd(6)} ${String(q.wait).padStart(5)} ${kb(q.bytes).padStart(6)}  ${q.url.slice(0, 90)}`);
}

const u = new URL(L);
/* Chrome resolves localhost itself, past any resolver rule: a plain-http server is reached at the proxy's own address */
const direct = u.protocol === "http:";
let front = "";
const link = NETS[process.env.NET] ? await shapedLink({ host: u.hostname, port: +u.port || (u.protocol === "https:" ? 443 : 80) }, NETS[process.env.NET], direct ? (t) => { t = t.replaceAll(front, u.host); return process.env.NODEFLATE ? t.replace(/\r\nSec-WebSocket-Extensions:/i, "\r\nX-Stripped-Extensions:") : t; } : null) : null;
if (link && direct) { front = `127.0.0.1:${link.port}`; B = `http://${front}`; }
const linkArgs = link && !direct ? [`--host-resolver-rules=MAP ${u.hostname}:${+u.port || (u.protocol === "https:" ? 443 : 80)} 127.0.0.1:${link.port}`, "--disable-quic"] : [];
const b = await puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: true, args: ["--no-sandbox", ...linkArgs, `--window-size=${vw},${vh}`, "--site-per-process", "--enable-features=IsolateSandboxedIframes", ...(process.env.CHROME_ARGS || "").split(" ").filter(Boolean)] });
const all = [];
for (let i = 0; i < +runsArg; i++) {
  const label = +runsArg > 1 ? `-${i + 1}` : "";
  const r = await once(b, label, !process.env.NOTRACE && i === 0);
  all.push(r); report(r, `run ${i + 1}`);
}
if (all.length > 1) {
  const med = (xs) => { const s = xs.filter((x) => x != null).sort((a, b) => a - b); return s.length ? s[(s.length - 1) >> 1] : null; };
  const keys = ["fcp", "chrome", "stage", "frames", "firstFrameShown", "allFramesShown", "lcp"];
  console.log(`\n== median of ${all.length}: ` + keys.map((k) => `${k} ${med(all.map((r) => r.marks[k]))}`).join(" · ") + ` · dcl ${med(all.map((r) => r.nav.dcl))} · long tasks ${med(all.map((r) => r.longtasks.reduce((a, x) => a + x[1], 0)))} ms`);
}
writeFileSync(`${prefix}.json`, JSON.stringify(all, null, 1));
await b.close();
link?.close();
