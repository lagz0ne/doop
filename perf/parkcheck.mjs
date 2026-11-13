// Parked frame documents (frameDocuments.ts): do they survive leaving the view, do they rest while parked,
// and how soon is a neighbourhood back on screen? Run with LS='{"doop:park":"off"}' for the old behaviour.
// usage: node parkcheck.mjs      (DOOP, LOCAL, LS, CHROME_PATH as for bench.mjs)
import { createRequire } from "node:module"; import { readFileSync } from "node:fs";
const puppeteer = createRequire(new URL("../build/doop/package.json", import.meta.url))("puppeteer-core");
const L = process.env.DOOP || "http://localhost:4477"; const loc = JSON.parse(readFileSync(new URL(process.env.LOCAL || "./local.json", import.meta.url)));
const b = await puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: true, args: ["--no-sandbox", "--window-size=1600,1000", "--site-per-process", "--enable-features=IsolateSandboxedIframes"] });
const p = await b.newPage(); await p.setViewport({ width: 1600, height: 1000 }); const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await p.goto(L + "/", { waitUntil: "domcontentloaded" });
await p.evaluate(async (c) => { await fetch("/api/auth/sign-in/email", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(c) }); }, { email: loc.email, password: loc.password });
if (process.env.LS) await p.evaluate((kv) => { for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v); }, JSON.parse(process.env.LS));
await p.goto(`${L}/c/${loc.canvas}?page=${process.env.PAGE || "stress"}`, { waitUntil: "domcontentloaded" }); await sleep(5000);
const zoomNow = () => p.evaluate(() => Number(getComputedStyle(document.querySelector("[data-stage-labels]") || document.querySelector(".stage")).getPropertyValue("--zoom")));
async function zoomTo(target) { for (let i = 0; i < 80; i++) { const z = await zoomNow(); const r = Math.log(target / z); if (Math.abs(r) < 0.02) break; await p.keyboard.down("Control"); await p.mouse.wheel({ deltaY: -Math.sign(r) * Math.min(40, 100 * Math.abs(r)) }); await p.keyboard.up("Control"); await sleep(50); } }
const counts = () => p.evaluate(() => ({ live: document.querySelectorAll("iframe[data-doop-frame]").length, parked: document.querySelectorAll("iframe[data-doop-frame-parked]").length, covered: [...document.querySelectorAll("iframe[data-doop-frame]")].filter((f) => { const r = f.getBoundingClientRect(); return r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight; }).filter((f) => f.closest("[data-frame-surface]")?.querySelector("[data-doop-frame-preview]")).length }));
const allShown = async () => { const c = await counts(); return c.live > 0 && c.covered === 0; };
async function untilShown(limit = 10000) { const t = Date.now(); let ok = 0; while (Date.now() - t < limit) { if (await allShown()) { if (++ok >= 3) return Date.now() - t - 100; } else ok = 0; await sleep(50); } return limit; }
const docs = async (sel) => { const out = []; for (const h of await p.$$(sel)) { const id = await h.evaluate((el) => el.closest("[data-doop-parked]") ? "parked" : (el.closest("[data-frame-shell],[data-frame-id]")?.getAttribute("data-frame-id") ?? "")); const f = await h.contentFrame(); if (f) out.push({ h, f, id }); } return out; };
const cdp = await p.createCDPSession(); await cdp.send("Performance.enable");
const task = async () => (await cdp.send("Performance.getMetrics")).metrics.find((x) => x.name === "TaskDuration").value;
const out = {};
await p.mouse.move(700, 500); await zoomTo(0.6); out.firstShownMs = await untilShown(); out.atStart = await counts();
// mark every live document, so a reload would show
let marked = 0; for (const d of await docs("iframe[data-doop-frame]")) { try { await d.f.evaluate(() => { window.__mark = "kept"; window.__built = document.createElement("i"); window.__built.id = "__script_made"; document.body.appendChild(window.__built); }); marked++; } catch {} }
out.marked = marked;
for (let i = 0; i < 14; i++) { await p.mouse.wheel({ deltaY: 250 }); await sleep(40); }
await untilShown(); out.away = await counts();
// a parked document: does it get animation frames, did it see a resize?
const parked = await docs("iframe[data-doop-frame-parked]");
if (parked.length) { try { out.parkedDoc = await parked[0].f.evaluate(() => new Promise((res) => { let n = 0; const tick = () => { n++; requestAnimationFrame(tick); }; requestAnimationFrame(tick); setTimeout(() => res({ animationFramesIn600ms: n, innerWidth, innerHeight, mark: window.__mark ?? null, visibility: document.visibilityState }), 600); })); } catch (e) { out.parkedDoc = String(e).slice(0, 120); } }
const t0 = await task();
for (let i = 0; i < 14; i++) { await p.mouse.wheel({ deltaY: -250 }); await sleep(40); }
out.backShownMs = await untilShown(); out.backMainThreadMs = Math.round(((await task()) - t0) * 1000); out.back = await counts();
let kept = 0, lost = 0, scriptMade = 0; for (const d of await docs("iframe[data-doop-frame]")) { try { const r = await d.f.evaluate(() => ({ mark: window.__mark ?? null, made: !!document.getElementById("__script_made"), w: innerWidth })); if (r.mark === "kept") kept++; else lost++; if (r.made) scriptMade++; } catch { lost++; } }
out.afterReturn = { documentsKept: kept, documentsNew: lost, scriptMadeElementKept: scriptMade };
const sys = await (await b.target().createCDPSession()).send("SystemInfo.getProcessInfo").catch(() => null);
if (sys) out.rendererCpuS = Number(sys.processInfo.filter((x) => x.type === "renderer").reduce((a, x) => a + x.cpuTime, 0).toFixed(1));
console.log(JSON.stringify(out, null, 1));
await b.close();
