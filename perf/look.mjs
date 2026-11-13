// Visual probe: what culled frames look like next to live ones.
// usage: [CULL=off] [ZOOMS=0.2,0.29] node look.mjs <outPrefix> [page=e2e-signin] [dpr=2]
// Shots: <prefix>-fit.png (all previews), <prefix>-sel.png (one frame clicked, so live),
// <prefix>-z<zoom>.png at a few zooms, <prefix>-pan.png (mid-pan at 60%, before the camera rests).
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const puppeteer = createRequire(new URL("../build/doop/package.json", import.meta.url))("puppeteer-core");
const [out, pageId = "e2e-signin", dpr = "2"] = process.argv.slice(2);
const loc = JSON.parse(readFileSync(new URL(process.env.LOCAL || "./local.json", import.meta.url)));
const L = process.env.DOOP || "http://localhost:4477";
const b = await puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: true, args: ["--no-sandbox", "--window-size=1600,1000", "--site-per-process", "--enable-features=IsolateSandboxedIframes", `--force-device-scale-factor=${dpr}`] });
// the density is forced on the browser, not only emulated on the page: emulation does not reach
// out-of-process frames, which then raster at 1x and are stretched (live frames look blurred)
const p = await b.newPage();
await p.setViewport({ width: 1600, height: 1000, deviceScaleFactor: Number(dpr) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await p.goto(L + "/", { waitUntil: "domcontentloaded" });
await p.evaluate(async (c) => { await fetch("/api/auth/sign-in/email", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(c) }); }, { email: loc.email, password: loc.password });
if (process.env.CULL) await p.evaluate((c) => localStorage.setItem("doop:cull", c), process.env.CULL); // CULL=off: every frame live, the reference picture
await p.goto(`${L}/c/${loc.canvas}?page=${pageId}`, { waitUntil: "domcontentloaded" });
await p.waitForSelector(".world", { timeout: 30000 });
const zoomNow = () => p.evaluate(() => Number(getComputedStyle(document.querySelector("[data-stage-labels]") || document.querySelector(".stage")).getPropertyValue("--zoom")));
async function zoomTo(target) {
  for (let i = 0; i < 80; i++) { const z = await zoomNow(); if (Math.abs(z - target) / target < 0.04) break; const dir = z < target ? -1 : 1; await p.keyboard.down("Control"); await p.mouse.wheel({ deltaY: dir * Math.min(100, 12 + 200 * Math.abs(Math.log(z / target))) }); await p.keyboard.up("Control"); await sleep(50); }
  return zoomNow();
}
const counts = () => p.evaluate(() => ({ iframes: document.querySelectorAll("iframe[data-doop-frame]").length, shells: document.querySelectorAll("[data-frame-shell]").length, imgs: [...document.querySelectorAll("[data-doop-frame-preview] img")].filter((i) => i.complete && i.naturalWidth).length }));
const settle = async () => { for (let i = 0; i < 40; i++) { await sleep(500); const pend = await p.evaluate(() => [...document.querySelectorAll("[data-doop-frame-preview] img")].filter((i) => { const r = i.getBoundingClientRect(); return r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight && !(i.complete && i.naturalWidth); }).length); if (!pend) break; } await sleep(800); };
await sleep(3000); await settle();
console.log("fit", await zoomNow(), await counts());
await p.screenshot({ path: `${out}-fit.png` });
// click a screen-sized frame near the middle: it becomes live among previews
const at = await p.evaluate(() => { const s = [...document.querySelectorAll("[data-frame-shell] [data-frame-surface]")].map((e) => e.getBoundingClientRect()).filter((r) => r.width / r.height < 3 && r.x > 350 && r.y > 150 && r.right < 1000 && r.bottom < 900); const r = s[Math.floor(s.length / 2)] || s[0]; return r && { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width }; });
if (at) { await p.mouse.click(at.x, at.y); await sleep(2500); console.log("selected at", at, await counts()); await p.screenshot({ path: `${out}-sel.png` }); await p.keyboard.press("Escape"); await sleep(300); }
await p.mouse.move(700, 450);
for (const z of (process.env.ZOOMS || "0.2,0.29").split(",").map(Number)) { const got = await zoomTo(z); await settle(); console.log("zoom", got, await counts()); await p.screenshot({ path: `${out}-z${Math.round(z * 100)}.png` }); }
await zoomTo(0.6); await settle();
for (let i = 0; i < 6; i++) { await p.mouse.wheel({ deltaX: -10, deltaY: -250 }); await sleep(60); }
await p.screenshot({ path: `${out}-pan.png` }); console.log("mid-pan", await counts());
await sleep(3000); await p.screenshot({ path: `${out}-rest.png` }); console.log("rest", await counts());
await b.close();
