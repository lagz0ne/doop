// Chrome trace of the gestures made over LIVE documents (trace.mjs covers the page-level ones):
//   L1-zoom   60% -> 95% -> 60% in small steps with live frames in view (every step reaches each of them)
//   L4-kzoom  95% -> 130% -> 95%: the camera rests on the other side of 100%, where the layout zoom k changes
//   L2-click  six presses, each selecting or waking a frame
//   L3-pan    a short pan at 60%
// usage: node trace-live.mjs <out.json> [page=stress]     (DOOP, LOCAL, CHROME_PATH as for trace.mjs)
// Read it with analyze.mjs / jsprof.mjs (TREE=perf when the server runs from build/perf).
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
const puppeteer = createRequire(new URL("../build/doop/package.json", import.meta.url))("puppeteer-core");
const [out, pageId = "stress"] = process.argv.slice(2);
const loc = JSON.parse(readFileSync(new URL(process.env.LOCAL || "./local.json", import.meta.url)));
const L = process.env.DOOP || "http://localhost:4477";
const b = await puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: true, args: ["--no-sandbox", "--window-size=1600,1000", "--site-per-process", "--enable-features=IsolateSandboxedIframes"] });
const p = await b.newPage();
await p.setViewport({ width: 1600, height: 1000 });
await p.goto(L + "/", { waitUntil: "domcontentloaded" });
await p.evaluate(async (c) => { await fetch("/api/auth/sign-in/email", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(c) }); }, { email: loc.email, password: loc.password });
if (process.env.LS) await p.evaluate((kv) => { for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v); }, JSON.parse(process.env.LS));
const cdp = await b.target().createCDPSession();
const mark = (n) => p.evaluate((n) => performance.mark(n), n);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const zoomNow = () => p.evaluate(() => Number(getComputedStyle(document.querySelector("[data-stage-labels]") || document.querySelector(".stage")).getPropertyValue("--zoom")));
let steps = 0;
async function zoomTo(target) { for (let i = 0; i < 80; i++) { const z = await zoomNow(); if (Math.abs(z - target) / target < 0.08) break; const dir = z < target ? -1 : 1; await p.keyboard.down("Control"); await p.mouse.wheel({ deltaY: dir * Math.min(100, 25 + 200 * Math.abs(Math.log(z / target))) }); await p.keyboard.up("Control"); steps++; await sleep(50); } return zoomNow(); }
async function pinchTo(target, cap = 5, wait = 30) { for (let i = 0; i < 200; i++) { const z = await zoomNow(); const r = Math.log(target / z); if (Math.abs(r) < 0.01) break; await p.keyboard.down("Control"); await p.mouse.wheel({ deltaY: -Math.sign(r) * Math.min(cap, 100 * Math.abs(r)) }); await p.keyboard.up("Control"); steps++; await sleep(wait); } return zoomNow(); }
const frames = () => p.evaluate(() => ({ iframes: document.querySelectorAll("iframe[data-doop-frame]").length, previews: document.querySelectorAll("[data-doop-frame-preview] img").length }));
await p.goto(`${L}/c/${loc.canvas}?page=${pageId}`, { waitUntil: "domcontentloaded" });
await p.waitForSelector(".world", { timeout: 30000 }); await sleep(5000);
await p.mouse.move(500, 400); await zoomTo(0.6); await sleep(4000);
const res = { before: await frames() };
await cdp.send("Tracing.start", { transferMode: "ReturnAsStream", traceConfig: { recordMode: "recordAsMuchAsPossible", includedCategories: ["devtools.timeline", "disabled-by-default-devtools.timeline", "v8.execute", "v8", "blink.user_timing", "loading", "latencyInfo", "disabled-by-default-v8.cpu_profiler", "cc", "gpu", "viz", "benchmark", "input", ...(process.env.INV ? ["disabled-by-default-devtools.timeline.invalidationTracking", "disabled-by-default-devtools.timeline.stack"] : [])] } });
await sleep(300);
await mark("L1-zoom:start"); steps = 0; res.up = await pinchTo(0.95); await sleep(600); res.down = await pinchTo(0.6); res.zoomSteps = steps; await sleep(2500); await mark("L1-zoom:end"); res.zoom = await frames();
await pinchTo(0.95); await sleep(1500);
await mark("L4-kzoom:start"); steps = 0; await pinchTo(1.3); await sleep(600); await pinchTo(0.95); res.kSteps = steps; await sleep(2500); await mark("L4-kzoom:end"); res.kzoom = await frames();
await pinchTo(0.6); await sleep(2500);
await mark("L2-click:start"); for (let i = 0; i < 6; i++) { await p.mouse.click(300 + i * 180, 300 + (i % 2) * 250); await sleep(400); } await sleep(600); await mark("L2-click:end");
await p.keyboard.press("Escape"); await p.keyboard.press("Escape"); await sleep(300);
await mark("L3-pan:start"); for (let i = 0; i < 12; i++) { await p.mouse.wheel({ deltaX: -10, deltaY: -250 }); await sleep(60); } await sleep(2500); await mark("L3-pan:end"); res.pan = await frames();
const done = new Promise((r) => cdp.once("Tracing.tracingComplete", r));
await cdp.send("Tracing.end");
const { stream } = await done;
let data = ""; for (;;) { const c = await cdp.send("IO.read", { handle: stream, size: 1 << 24 }); data += c.data; if (c.eof) break; }
writeFileSync(out, data);
console.log(JSON.stringify(res), "trace MB", (data.length / 1e6).toFixed(0));
await b.close();
