// Does a zoom ever show white where content was? Screencast a ctrl+wheel zoom in and out and
// flag frames whose white share jumps and falls back. LS= JSON localStorage; ZOOMS= "a>b,b>a".
// usage: node zoomflash.mjs <outPrefix> [page=e2e-signin]
// TRACE=1 also logs, per animation frame, every frame surface in view (opacity, picture, iframe) and
// prints what the DOM held over the TRACE_BEFORE ms (150) before each flagged frame.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const req = createRequire(new URL("../build/doop/package.json", import.meta.url));
const puppeteer = req("puppeteer-core"); const sharp = req("sharp");
const [out, pageId = "e2e-signin"] = process.argv.slice(2);
const loc = JSON.parse(readFileSync(new URL(process.env.LOCAL || "./local.json", import.meta.url)));
const L = process.env.DOOP || "http://localhost:4477";
const LS = JSON.parse(process.env.LS || "{}");
const extra = (process.env.CHROME_ARGS || "").split(" ").filter(Boolean);
const b = await puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: true, args: ["--no-sandbox", "--window-size=1600,1000", "--site-per-process", "--enable-features=IsolateSandboxedIframes", ...extra] });
const p = await b.newPage(); await p.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await p.goto(L + "/", { waitUntil: "domcontentloaded" });
await p.evaluate(async (c, ls) => { await fetch("/api/auth/sign-in/email", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(c) }); localStorage.setItem("doop:render-trial", "off"); for (const [k, v] of Object.entries(ls)) localStorage.setItem(k, v); }, { email: loc.email, password: loc.password }, LS);
await p.goto(`${L}/c/${loc.canvas}?page=${pageId}`, { waitUntil: "domcontentloaded" });
await p.waitForSelector(".world", { timeout: 30000 }); await sleep(5000);
const zoomNow = () => p.evaluate(() => Number(getComputedStyle(document.querySelector("[data-stage-labels]") || document.querySelector(".stage")).getPropertyValue("--zoom")));
const state = () => p.evaluate(() => ({ shells: document.querySelectorAll("[data-frame-shell]:not([hidden])").length, iframes: document.querySelectorAll("iframe").length, gl: !!document.querySelector("canvas[data-stage-pictures], [data-stage-pictures] canvas") }));
await p.mouse.move(900, 520);
async function zoomTo(target, step) { const up = (await zoomNow()) < target; for (let i = 0; i < 200; i++) { const z = await zoomNow(); if (Math.abs(Math.log(z / target)) < 0.03 || (up ? z >= target : z <= target)) return; await p.keyboard.down("Control"); await p.mouse.wheel({ deltaY: (up ? -1 : 1) * step }); await p.keyboard.up("Control"); await sleep(16); } }
const zooms = (process.env.ZOOMS || "0.15>0.8,0.8>0.15,0.15>0.6,0.6>0.2").split(",").map((s) => s.split(">").map(Number));
await zoomTo(zooms[0][0], 60); await sleep(4000);
console.log("start", await zoomNow(), await state());
const cdp = await p.createCDPSession();
for (const [i, [from, to]] of zooms.entries()) {
  await zoomTo(from, 60); await sleep(3500);
  const shots = [];
  const on = (f) => { shots.push({ t: f.metadata?.timestamp ? Math.round(f.metadata.timestamp * 1000) : Date.now(), data: f.data }); cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {}); };
  cdp.on("Page.screencastFrame", on);
  await cdp.send("Page.startScreencast", { format: "png", everyNthFrame: 1 });
  if (process.env.TRACE) await p.evaluate(() => {
    window.__trace = []; window.__tracing = true; let last = "";
    const tick = () => {
      const rows = [...document.querySelectorAll("[data-frame-surface]")].map((el) => {
        const r = el.getBoundingClientRect(); if (r.right < 0 || r.left > 1600 || r.bottom < 60 || r.top > 920 || r.width < 40) return null;
        const pic = el.querySelector("[data-doop-frame-preview]"); const img = pic?.querySelector("img"); const ifr = el.querySelector("iframe");
        const shell = el.parentElement?.hasAttribute("data-frame-shell") ? "shell" : "view";
        return `${shell}@${Math.round(r.left)},${Math.round(r.top)} op=${getComputedStyle(el).opacity} pic=${pic ? (img ? (img.complete ? "ok" : "loading") : "none") + "/" + (pic.parentElement.style.visibility || "vis") : "-"} ifr=${ifr ? ifr.style.visibility || "vis" : "-"}`;
      }).filter(Boolean).join(" | ");
      if (rows !== last) { window.__trace.push([Date.now(), rows]); last = rows; }
      if (window.__tracing) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await sleep(300); const t0 = Date.now();
  await zoomTo(to, Number(process.env.STEP || 25));
  const tEnd = Date.now(); await sleep(2500);
  await cdp.send("Page.stopScreencast"); cdp.off("Page.screencastFrame", on);
  const trace = process.env.TRACE ? await p.evaluate(() => { window.__tracing = false; return window.__trace; }) : [];
  const rows = [];
  for (const s of shots) {
    const { data, info } = await sharp(Buffer.from(s.data, "base64")).extract({ left: 0, top: 60, width: 1600, height: 860 }).resize(400).greyscale().raw().toBuffer({ resolveWithObject: true });
    let white = 0; for (const v of data) if (v >= 252) white++;
    rows.push({ t: s.t - t0, white: white / data.length, data, s });
  }
  let flagged = 0;
  for (let k = 1; k < rows.length - 1; k++) {
    const before = Math.min(...rows.slice(Math.max(0, k - 3), k).map((r) => r.white));
    const after = Math.min(...rows.slice(k + 1, k + 6).map((r) => r.white));
    const jump = rows[k].white - Math.max(before, after);
    if (jump > 0.02) { flagged++; if (flagged <= 6) { await sharp(Buffer.from(rows[k].s.data, "base64")).toFile(`${out}-z${i}-${rows[k].t}ms.png`); await sharp(Buffer.from(rows[k - 1].s.data, "base64")).toFile(`${out}-z${i}-${rows[k].t}ms-prev.png`); } console.log(`  zoom ${from}>${to}  ${rows[k].t} ms  white ${(100 * rows[k].white).toFixed(1)}% vs ${(100 * Math.max(before, after)).toFixed(1)}%`);
      const at = rows[k].t + t0; for (const [tt, r] of trace) if (tt > at - (+process.env.TRACE_BEFORE || 150) && tt <= at + 20) console.log(`      ${tt - t0} ms  ${r}`); }
  }
  console.log(`zoom ${from}>${to}: ${rows.length} frames, gesture ${tEnd - t0} ms, flagged ${flagged}, now ${(await zoomNow()).toFixed(2)}`, await state());
}
await b.close();
