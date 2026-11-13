// Main-thread cost of pan, stepped zoom and the fit jump, per CSS variant. Reports CDP TaskDuration (main-thread busy seconds) and the worst frame gap.
import { createRequire } from "node:module"; import { readFileSync } from "node:fs";
const puppeteer = createRequire(new URL("../build/doop/package.json", import.meta.url))("puppeteer-core");
const L = process.env.DOOP || "http://localhost:4477"; const loc = JSON.parse(readFileSync(new URL(process.env.LOCAL || "./local.json", import.meta.url)));
const b = await puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: true, args: ["--no-sandbox", "--window-size=1600,1000", "--site-per-process", "--enable-features=IsolateSandboxedIframes"] });
const p = await b.newPage(); await p.setViewport({ width: 1600, height: 1000 }); const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await p.goto(L + "/", { waitUntil: "domcontentloaded" });
await p.evaluate(async (c) => { await fetch("/api/auth/sign-in/email", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(c) }); }, { email: loc.email, password: loc.password });
await p.goto(`${L}/c/${loc.canvas}?page=${process.env.PAGE || "stress"}`, { waitUntil: "domcontentloaded" }); await sleep(5000);
const css = process.argv[2]; if (css) await p.addStyleTag({ content: css });
const cdp = await p.createCDPSession(); await cdp.send("Performance.enable");
{ const m = (await cdp.send("Performance.getMetrics")).metrics; const g = (n) => m.find((x) => x.name === n)?.value || 0;
  const sys = await (await b.target().createCDPSession()).send("SystemInfo.getProcessInfo").catch(() => null);
  const dom = await p.evaluate(() => ({ iframes: document.querySelectorAll("iframe[data-doop-frame]").length, els: document.getElementsByTagName("*").length }));
  globalThis.__open = `main thread ${Math.round(g("TaskDuration") * 1000)} ms in the first 5 s (script ${Math.round(g("ScriptDuration") * 1000)}, style ${Math.round(g("RecalcStyleDuration") * 1000)}, layout ${Math.round(g("LayoutDuration") * 1000)}) · ${dom.iframes} live documents · ${dom.els} elements · editor JS heap ${Math.round(g("JSHeapUsedSize") / 1e6)} MB · renderer CPU ${sys ? sys.processInfo.filter((x) => x.type === "renderer").reduce((a, x) => a + x.cpuTime, 0).toFixed(1) : "?"} s`; }
const task = async () => { const m = (await cdp.send("Performance.getMetrics")).metrics; const g = (n) => m.find((x) => x.name === n)?.value || 0; return { task: g("TaskDuration"), style: g("RecalcStyleDuration"), layout: g("LayoutDuration"), script: g("ScriptDuration") }; };
const zoomNow = () => p.evaluate(() => Number(getComputedStyle(document.querySelector("[data-stage-labels]") || document.querySelector(".stage")).getPropertyValue("--zoom")));
await p.evaluate(() => { window.__gaps = []; let last = performance.now(); const tick = () => { const n = performance.now(); window.__gaps.push(n - last); last = n; requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
const raw = {};
async function measure(fn, settle = 1500) { await p.evaluate(() => { window.__gaps.length = 0; }); const a = await task(); measure.skip = null; await fn(); await sleep(settle); const z = await task(); if (measure.skip) Object.assign(a, measure.skip); const g = await p.evaluate(() => ({ max: Math.round(Math.max(0, ...window.__gaps)), slow: window.__gaps.filter((x) => x > 34).length })); const r = { task: Math.round((z.task - a.task) * 1000), style: Math.round((z.style - a.style) * 1000), layout: Math.round((z.layout - a.layout) * 1000), script: Math.round((z.script - a.script) * 1000), worst: g.max, slow: g.slow }; measure.last = r; return `${String(r.task).padStart(5)} ms (style ${r.style}, layout ${r.layout}, script ${r.script}) worst frame ${String(g.max).padStart(4)} ms, ${g.slow} slow`; }
async function zoomTo(target) { for (let i = 0; i < 80; i++) { const z = await zoomNow(); if (Math.abs(z - target) / target < 0.08) break; const dir = z < target ? -1 : 1; await p.keyboard.down("Control"); await p.mouse.wheel({ deltaY: dir * Math.min(100, 25 + 200 * Math.abs(Math.log(z / target))) }); await p.keyboard.up("Control"); await sleep(50); } }
async function pinchTo(target, cap = 5, wait = 30) { for (let i = 0; i < 200; i++) { const z = await zoomNow(); const r = Math.log(target / z); if (Math.abs(r) < 0.01) break; await p.keyboard.down("Control"); await p.mouse.wheel({ deltaY: -Math.sign(r) * Math.min(cap, 100 * Math.abs(r)) }); await p.keyboard.up("Control"); await sleep(wait); } }
const run = async (name, fn, settle) => { out[name] = await measure(fn, settle); raw[name.trim()] = measure.last; };
const out = {};
await p.mouse.move(500, 400);
await run("pan at fit (8%)   ", async () => { for (let i = 0; i < 24; i++) { await p.mouse.wheel({ deltaX: i % 2 ? 60 : -60, deltaY: i < 12 ? 60 : -60 }); await sleep(40); } });
await run("zoom 8% -> 60%    ", () => zoomTo(0.6), 2500);
await run("pan at 60%        ", async () => { for (let i = 0; i < 24; i++) { await p.mouse.wheel({ deltaX: -10, deltaY: -250 }); await sleep(60); } }, 2500);
// Live documents in view the whole time, zoomed in small steps as a pinch does. Two ranges, since the world's
// layout zoom k (Stage, layoutZoomFor) changes when a camera rests on the other side of 100%: a relayout of its own.
await run("zoom 60>95>60%    ", async () => { await pinchTo(0.95); await sleep(600); await pinchTo(0.6); }, 2500);
await run("zoom 95>130>95%   ", async () => { await pinchTo(0.95); await sleep(1200); const a = await task(); await pinchTo(1.3); await sleep(600); await pinchTo(0.95); measure.skip = a; }, 2500);
await pinchTo(0.6); await sleep(1500);
// select six frames, one after another (each press wakes or selects a frame)
await run("click 6 frames    ", async () => { for (let i = 0; i < 6; i++) { await p.mouse.click(300 + i * 180, 300 + (i % 2) * 250); await sleep(400); } }, 1000);
await run("fit jump (60%->8%)", async () => { await p.keyboard.press("Escape"); await p.keyboard.press("Escape"); await p.keyboard.down("Shift"); await p.keyboard.press("Digit1"); await p.keyboard.up("Shift"); }, 3000);
console.log("== " + (process.env.NAME || css || "as built").slice(0, 110)); console.log("   open page          " + globalThis.__open); for (const [k, v] of Object.entries(out)) console.log("   " + k, v);
if (process.env.JSON_OUT) (await import("node:fs")).appendFileSync(process.env.JSON_OUT, JSON.stringify({ name: process.env.NAME || "", raw }) + "\n");
await b.close();
