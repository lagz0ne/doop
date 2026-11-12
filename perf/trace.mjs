// Record a Chrome trace (all processes) of the doop editor through fixed scenarios.
// usage: node trace.mjs <out.json> [page=stress] [cull=on|off]
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
const puppeteer = createRequire(new URL("../build/doop/package.json", import.meta.url))("puppeteer-core");
const [out, pageId = "stress", cull = "on"] = process.argv.slice(2);
const loc = JSON.parse(readFileSync(new URL((process.env.LOCAL || "./local.json"), import.meta.url)));
const L = process.env.DOOP || "http://localhost:4477";
const b = await puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: true, args: ["--no-sandbox", "--window-size=1600,1000", "--site-per-process", "--enable-features=IsolateSandboxedIframes"] });
const p = await b.newPage();
await p.setViewport({ width: 1600, height: 1000 });
await p.goto(L + "/", { waitUntil: "domcontentloaded" });
await p.evaluate(async (c) => { await fetch("/api/auth/sign-in/email", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(c) }); }, { email: loc.email, password: loc.password });
await p.evaluate((c) => localStorage.setItem("doop:cull", c), cull);
const cdp = await b.target().createCDPSession();
const mark = (n) => p.evaluate((n) => performance.mark(n), n);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const zoomNow = () => p.evaluate(() => Number(getComputedStyle(document.querySelector(".stage")).getPropertyValue("--zoom")));
async function zoomTo(target) { // ctrl+wheel like a person, until the camera crosses the target
  for (let i = 0; i < 80; i++) { const z = await zoomNow(); if (Math.abs(z - target) / target < 0.08) break; const dir = z < target ? -1 : 1; await p.keyboard.down("Control"); await p.mouse.wheel({ deltaY: dir * Math.min(100, 25 + 200 * Math.abs(Math.log(z / target))) }); await p.keyboard.up("Control"); await sleep(50); }
  return zoomNow();
}
const frames = () => p.evaluate(() => ({ iframes: document.querySelectorAll("iframe[data-doop-frame]").length, previews: document.querySelectorAll("[data-doop-frame-preview] img").length }));
await cdp.send("Tracing.start", { transferMode: "ReturnAsStream", traceConfig: { recordMode: "recordAsMuchAsPossible", includedCategories: ["devtools.timeline", "disabled-by-default-devtools.timeline", "v8.execute", "v8", "blink.user_timing", "loading", "latencyInfo", "disabled-by-default-v8.cpu_profiler", "cc", "gpu", "viz", "benchmark", "input", ...(process.env.INV ? ["disabled-by-default-devtools.timeline.invalidationTracking", "disabled-by-default-devtools.timeline.stack"] : [])] } });
const res = {};
// S1 open: navigate to the page, fit zoom (what a person sees first)
let t = Date.now();
await p.goto(`${L}/c/${loc.canvas}?page=${pageId}`, { waitUntil: "domcontentloaded" });
await mark("S1-open:start");
await p.waitForSelector(".world", { timeout: 30000 });
await sleep(7000); await mark("S1-open:end"); res.open = await frames(); if (process.env.SHOT) await p.screenshot({ path: process.env.SHOT + "-fit.png" });
// S2 zoom in on the first frames (documents come alive)
await mark("S2-zoomin:start");
await p.mouse.move(500, 400);
res.z0 = await zoomNow(); res.z1 = await zoomTo(0.6);
await sleep(4000); await mark("S2-zoomin:end"); res.zoomin = await frames(); if (process.env.SHOT) await p.screenshot({ path: process.env.SHOT + "-zoom.png" });
// S3 pan across the page with the wheel (frames flip live/preview)
await mark("S3-pan:start");
for (let i = 0; i < 24; i++) { await p.mouse.wheel({ deltaX: -10, deltaY: -250 }); await sleep(80); }
await sleep(3000); await mark("S3-pan:end"); res.pan = await frames();
// S4 click to select frames, 6 times
await mark("S4-click:start");
for (let i = 0; i < 6; i++) { await p.mouse.click(300 + i * 180, 300 + (i % 2) * 250); await sleep(500); }
await mark("S4-click:end"); res.click = await frames(); if (process.env.SHOT) await p.screenshot({ path: process.env.SHOT + "-click.png" });
// S5 zoom back out to fit (everything visible, small)
await mark("S5-zoomout:start");
await p.keyboard.press("Escape"); await p.keyboard.press("Escape"); await p.keyboard.down("Shift"); await p.keyboard.press("Digit1"); await p.keyboard.up("Shift"); await sleep(300); res.z5 = await zoomNow();
await sleep(4000); await mark("S5-zoomout:end"); res.zoomout = await frames();
res.zoom = await p.evaluate(() => getComputedStyle(document.querySelector(".stage")).getPropertyValue("--zoom"));
const done = new Promise((r) => cdp.once("Tracing.tracingComplete", r));
await cdp.send("Tracing.end");
const { stream } = await done;
let data = ""; for (;;) { const c = await cdp.send("IO.read", { handle: stream, size: 1 << 24 }); data += c.data; if (c.eof) break; }
writeFileSync(out, data);
console.log(JSON.stringify(res), "trace MB", (data.length / 1e6).toFixed(0));
await b.close();
