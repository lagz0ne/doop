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
const zoomNow = () => p.evaluate(() => Number(getComputedStyle(document.querySelector(".stage")).getPropertyValue("--zoom")));
await p.evaluate(() => { window.__gaps = []; let last = performance.now(); const tick = () => { const n = performance.now(); window.__gaps.push(n - last); last = n; requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
async function measure(fn, settle = 1500) { await p.evaluate(() => { window.__gaps.length = 0; }); const a = await task(); await fn(); await sleep(settle); const z = await task(); const g = await p.evaluate(() => ({ max: Math.round(Math.max(0, ...window.__gaps)), slow: window.__gaps.filter((x) => x > 34).length })); return `${Math.round((z.task - a.task) * 1000).toString().padStart(5)} ms (style ${Math.round((z.style - a.style) * 1000)}, script ${Math.round((z.script - a.script) * 1000)}) worst frame ${String(g.max).padStart(4)} ms, ${g.slow} slow`; }
const out = {};
await p.mouse.move(500, 400);
out["pan at fit (8%)   "] = await measure(async () => { for (let i = 0; i < 24; i++) { await p.mouse.wheel({ deltaX: i % 2 ? 60 : -60, deltaY: i < 12 ? 60 : -60 }); await sleep(40); } });
out["zoom 8% -> 60%    "] = await measure(async () => { for (let i = 0; i < 80; i++) { const z = await zoomNow(); if (Math.abs(z - 0.6) / 0.6 < 0.08) break; await p.keyboard.down("Control"); await p.mouse.wheel({ deltaY: -Math.min(100, 25 + 200 * Math.abs(Math.log(z / 0.6))) }); await p.keyboard.up("Control"); await sleep(50); } }, 2500);
out["pan at 60%        "] = await measure(async () => { for (let i = 0; i < 24; i++) { await p.mouse.wheel({ deltaX: -10, deltaY: -250 }); await sleep(60); } }, 2500);
out["fit jump (60%->8%)"] = await measure(async () => { await p.keyboard.press("Escape"); await p.keyboard.down("Shift"); await p.keyboard.press("Digit1"); await p.keyboard.up("Shift"); }, 3000);
console.log("== " + (process.env.NAME || css || "as built").slice(0, 110)); console.log("   open page          " + globalThis.__open); for (const [k, v] of Object.entries(out)) console.log("   " + k, v);
await b.close();
