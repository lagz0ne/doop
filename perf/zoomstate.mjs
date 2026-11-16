// Per animation frame, the state of the FrameViews near the view's centre during a zoom
// (surface opacity, picture present/loaded/visible, iframe present/visible), printed on change.
// usage: node zoomstate.mjs [page=e2e-signin]   LS=, CHROME_ARGS=, FROM=0.15 TO=0.8 STEP=25
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const req = createRequire(new URL("../build/doop/package.json", import.meta.url));
const puppeteer = req("puppeteer-core");
const [pageId = "e2e-signin"] = process.argv.slice(2);
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
await p.mouse.move(900, 520);
async function zoomTo(target, step) { const up = (await zoomNow()) < target; for (let i = 0; i < 200; i++) { const z = await zoomNow(); if (Math.abs(Math.log(z / target)) < 0.03 || (up ? z >= target : z <= target)) return; await p.keyboard.down("Control"); await p.mouse.wheel({ deltaY: (up ? -1 : 1) * step }); await p.keyboard.up("Control"); await sleep(16); } }
const FROM = Number(process.env.FROM || 0.15), TO = Number(process.env.TO || 0.8);
await zoomTo(FROM, 60); await sleep(4000);
await p.evaluate(() => {
  window.__log = []; let last = ""; const ids = new WeakMap(); let n = 0; const tag = (el) => { if (!el) return "-"; if (!ids.has(el)) ids.set(el, ++n); return ids.get(el); }; const t0 = performance.now();
  const tick = () => {
    const z = getComputedStyle(document.querySelector(".stage")).getPropertyValue("--zoom");
    const rows = [...document.querySelectorAll("[data-frame-surface]")].map((s) => {
      const r = s.getBoundingClientRect(); if (r.right < 300 || r.left > 1600 || r.bottom < 60 || r.top > 940) return null;
      const pic = s.querySelector("[data-doop-frame-preview]"); const img = pic?.querySelector("img"); const wrap = pic?.parentElement; const ifr = s.querySelector("iframe");
      return `#${tag(s)}/img${tag(img)} ${Math.round(r.left)},${Math.round(r.top)} op=${getComputedStyle(s).opacity} pic=${pic ? (img ? (img.complete ? "loaded" : "loading") : "noimg") + "/" + (wrap.style.visibility || "vis") : "-"} ifr=${ifr ? ifr.style.visibility || "vis" : "-"}`;
    }).filter(Boolean);
    const sig = rows.join(" | ");
    if (sig !== last) { window.__log.push(`${(performance.now() - t0).toFixed(0).padStart(6)} z=${Number(z).toFixed(2)} ${sig || "(no FrameView)"}`); last = sig; }
    if (window.__log.length < 400) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
await zoomTo(TO, Number(process.env.STEP || 25)); await sleep(3000);
console.log((await p.evaluate(() => window.__log)).join("\n"));
await b.close();
