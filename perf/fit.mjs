// Measure the main-thread stall of zoom-to-fit (Shift+1) from a 60% view, with optional CSS variants.
import { createRequire } from "node:module"; import { readFileSync } from "node:fs";
const puppeteer = createRequire(new URL("../build/doop/package.json", import.meta.url))("puppeteer-core");
const L = process.env.DOOP || "http://localhost:4477"; const loc = JSON.parse(readFileSync(new URL(process.env.LOCAL || "./local.json", import.meta.url)));
const b = await puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: true, args: ["--no-sandbox", "--window-size=1600,1000"] });
const p = await b.newPage(); await p.setViewport({ width: 1600, height: 1000 }); const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await p.goto(L + "/", { waitUntil: "domcontentloaded" });
await p.evaluate(async (c) => { await fetch("/api/auth/sign-in/email", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(c) }); }, { email: loc.email, password: loc.password });
await p.goto(`${L}/c/${loc.canvas}?page=stress`, { waitUntil: "domcontentloaded" }); await sleep(5000);
const css = process.argv[2]; if (css) await p.addStyleTag({ content: css });
const zoomNow = () => p.evaluate(() => Number(getComputedStyle(document.querySelector(".stage")).getPropertyValue("--zoom")));
await p.evaluate(() => { window.__gaps = []; let last = performance.now(); const tick = () => { const n = performance.now(); window.__gaps.push(n - last); last = n; requestAnimationFrame(tick); }; requestAnimationFrame(tick); window.__lt = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push(Math.round(e.duration)); }).observe({ type: "longtask" }); });
const res = [];
for (let run = 0; run < 3; run++) {
  await p.mouse.move(500, 400);
  for (let i = 0; i < 80; i++) { const z = await zoomNow(); if (Math.abs(z - 0.6) / 0.6 < 0.08) break; await p.keyboard.down("Control"); await p.mouse.wheel({ deltaY: -Math.min(100, 25 + 200 * Math.abs(Math.log(z / 0.6))) }); await p.keyboard.up("Control"); await sleep(50); }
  await sleep(2500);
  await p.evaluate(() => { window.__gaps.length = 0; window.__lt.length = 0; });
  await p.keyboard.press("Escape"); await p.keyboard.down("Shift"); await p.keyboard.press("Digit1"); await p.keyboard.up("Shift");
  await sleep(3000);
  res.push(await p.evaluate(() => ({ maxGap: Math.round(Math.max(...window.__gaps)), longTasks: window.__lt.slice() })));
}
console.log((css || "(as built)").slice(0, 90).padEnd(92), res.map((r) => `stall ${String(r.maxGap).padStart(4)} ms [${r.longTasks.join(",")}]`).join("  "));
await b.close();
