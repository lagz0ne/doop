// A pan press with the Hand tool: what cursor shows, whether the drag selects text in the chrome, and
// how many elements the press and the release restyle.
// usage: node presscheck.mjs      (DOOP, LOCAL, CHROME_PATH as for bench.mjs)
import { createRequire } from "node:module"; import { readFileSync } from "node:fs";
const puppeteer = createRequire(new URL("../build/doop/package.json", import.meta.url))("puppeteer-core");
const L = process.env.DOOP || "http://localhost:4477"; const loc = JSON.parse(readFileSync(new URL(process.env.LOCAL || "./local.json", import.meta.url)));
const b = await puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: true, args: ["--no-sandbox", "--window-size=1600,1000", "--site-per-process", "--enable-features=IsolateSandboxedIframes"] });
const p = await b.newPage(); await p.setViewport({ width: 1600, height: 1000 }); const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await p.goto(L + "/", { waitUntil: "domcontentloaded" });
await p.evaluate(async (c) => { await fetch("/api/auth/sign-in/email", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(c) }); }, { email: loc.email, password: loc.password });
await p.goto(`${L}/c/${loc.canvas}?page=${process.env.PAGE || "stress"}`, { waitUntil: "domcontentloaded" }); await sleep(5000);
const cdp = await p.createCDPSession(); await cdp.send("Performance.enable");
const metric = async (n) => (await cdp.send("Performance.getMetrics")).metrics.find((x) => x.name === n)?.value || 0;
const look = () => p.evaluate(() => { const at = document.elementFromPoint(800, 500); const stage = document.querySelector(".stage");
  return { tool: stage.className.match(/cursor-[a-z-]+!/)?.[0] ?? "(none)", under: getComputedStyle(at).cursor, stage: getComputedStyle(stage).cursor, cover: at?.hasAttribute("data-pan-cover") ?? false, selected: String(getSelection()).length, userSelect: getComputedStyle(document.documentElement).userSelect }; });
const out = { rest: await look() };
// the press, a drag across the whole window (over every panel there is), the release
const r0 = await metric("RecalcStyleCount"), s0 = await metric("RecalcStyleDuration");
await p.mouse.move(800, 500); await p.mouse.down(); await sleep(150);
const r1 = await metric("RecalcStyleCount"), s1 = await metric("RecalcStyleDuration");
for (const [x, y] of [[600, 520], [300, 400], [40, 200], [20, 20], [1580, 30], [1580, 980], [20, 980], [820, 520]]) { await p.mouse.move(x, y, { steps: 6 }); await sleep(30); }
out.dragging = await look();
const r2 = await metric("RecalcStyleCount"), s2 = await metric("RecalcStyleDuration");
await p.mouse.up(); await sleep(200);
const r3 = await metric("RecalcStyleCount"), s3 = await metric("RecalcStyleDuration");
out.after = await look();
out.style = { press: `${r1 - r0} recalcs, ${((s1 - s0) * 1000).toFixed(1)} ms`, release: `${r3 - r2} recalcs, ${((s3 - s2) * 1000).toFixed(1)} ms` };
// the harness can select text at all: the same drag, started on the chrome instead of the stage
const text = await p.evaluate(() => { const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) { const el = n.parentElement; if (!el || el.closest(".stage") || n.textContent.trim().length < 4) continue; const r = el.getBoundingClientRect(); if (r.width > 30 && r.height > 8 && getComputedStyle(el).userSelect !== "none") return { x: r.left + 2, y: r.top + r.height / 2, w: r.width, text: n.textContent.trim().slice(0, 30) }; } return null; });
if (text) { await p.mouse.move(text.x, text.y); await p.mouse.down(); await p.mouse.move(text.x + text.w, text.y, { steps: 5 }); out.chromeDragSelects = await p.evaluate(() => String(getSelection()).length); await p.mouse.up(); out.chromeText = text.text; }
console.log(JSON.stringify(out, null, 1));
await b.close();
