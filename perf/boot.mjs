// What a frame shows while its document boots: click a culled frame, then sample its pixels every few ms.
// usage: node boot.mjs <outPrefix> [page=e2e-signin] [zoom=0.25]
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const req = createRequire(new URL("../build/doop/package.json", import.meta.url));
const puppeteer = req("puppeteer-core"); const sharp = req("sharp");
const [out, pageId = "e2e-signin", zoom = "0.25"] = process.argv.slice(2);
const loc = JSON.parse(readFileSync(new URL(process.env.LOCAL || "./local.json", import.meta.url)));
const L = process.env.DOOP || "http://localhost:4477";
const b = await puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: true, args: ["--no-sandbox", "--window-size=1600,1000", "--site-per-process", "--enable-features=IsolateSandboxedIframes"] });
const p = await b.newPage(); await p.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await p.goto(L + "/", { waitUntil: "domcontentloaded" });
await p.evaluate(async (c) => { await fetch("/api/auth/sign-in/email", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(c) }); }, { email: loc.email, password: loc.password });
await p.goto(`${L}/c/${loc.canvas}?page=${pageId}`, { waitUntil: "domcontentloaded" });
await p.waitForSelector(".world", { timeout: 30000 }); await sleep(4000);
const zoomNow = () => p.evaluate(() => Number(getComputedStyle(document.querySelector(".stage")).getPropertyValue("--zoom")));
await p.mouse.move(800, 500);
for (let i = 0; i < 80; i++) { const z = await zoomNow(); if (Math.abs(z - zoom) / zoom < 0.04) break; await p.keyboard.down("Control"); await p.mouse.wheel({ deltaY: (z < zoom ? -1 : 1) * Math.min(100, 12 + 200 * Math.abs(Math.log(z / zoom))) }); await p.keyboard.up("Control"); await sleep(50); }
await sleep(4000);
const r = await p.evaluate(() => { const s = [...document.querySelectorAll("[data-frame-shell] [data-frame-surface]")].map((e) => e.getBoundingClientRect()).filter((r) => r.width / r.height < 3 && r.x > 360 && r.y > 80 && r.right < 1600 && r.bottom < 960); const r = s[0]; return r && { x: r.x, y: r.y, width: r.width, height: r.height }; });
if (!r) { console.log("no shell in view"); await b.close(); process.exit(1); }
const clip = { x: Math.round(r.x) + 2, y: Math.round(r.y) + 2, width: Math.round(r.width) - 4, height: Math.round(r.height) - 4 };
const cdp = await p.createCDPSession(); const shots = [];
cdp.on("Page.screencastFrame", (f) => { shots.push({ t: Date.now(), data: f.data }); cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {}); });
await cdp.send("Page.startScreencast", { format: "png", everyNthFrame: 1 });
await sleep(300); const t0 = Date.now();
await p.mouse.click(r.x + r.width / 2, r.y + r.height / 2);
await sleep(2500); await cdp.send("Page.stopScreencast");
let prev = null, n = 0;
for (const s of shots) {
  const img = sharp(Buffer.from(s.data, "base64")).extract({ left: clip.x, top: clip.y, width: clip.width, height: clip.height });
  const { data } = await img.clone().greyscale().raw().toBuffer({ resolveWithObject: true });
  let sum = 0, white = 0; for (const v of data) { sum += v; if (v > 250) white++; }
  let diff = 0; if (prev && prev.length === data.length) for (let i = 0; i < data.length; i++) diff += Math.abs(data[i] - prev[i]);
  const line = `${String(s.t - t0).padStart(6)} ms  mean ${(sum / data.length).toFixed(1)}  white ${(100 * white / data.length).toFixed(0)}%  changed ${(diff / data.length).toFixed(2)}`;
  if (!prev || diff / data.length > 0.3) { console.log(line); await img.toFile(`${out}-${String(n++).padStart(2, "0")}-${s.t - t0}ms.png`); }
  prev = data;
}
console.log("frames captured", shots.length, "zoom", await zoomNow(), "clip", clip);
await b.close();
