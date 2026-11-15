// The GPU picture layer (localStorage doop:gpu) on a page: is WebGL2 there, how many shells it draws, a screenshot
// with and without it at a few zooms. usage: node gpucheck.mjs <out prefix> [page]   (DOOP, CHROME_PATH as for bench.mjs)
import { createRequire } from "node:module"; import { readFileSync } from "node:fs";
const puppeteer = createRequire(new URL("../build/doop/package.json", import.meta.url))("puppeteer-core");
const L = process.env.DOOP || "http://localhost:4477"; const loc = JSON.parse(readFileSync(new URL(process.env.LOCAL || "./local.json", import.meta.url)));
const prefix = process.argv[2] || "out/gpu"; const page = process.argv[3] || "stress";
const b = await puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: true, args: ["--no-sandbox", "--window-size=1600,1000", "--site-per-process", "--enable-features=IsolateSandboxedIframes", "--enable-unsafe-swiftshader"] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (const mode of ["off", "force"]) {
  const p = await b.newPage(); await p.setViewport({ width: 1600, height: 1000 });
  p.on("console", (m) => { if (/doop|error/i.test(m.text())) console.log(`[${mode}] ${m.text()}`); });
  await p.goto(L + "/", { waitUntil: "domcontentloaded" });
  await p.evaluate(async (c) => { await fetch("/api/auth/sign-in/email", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(c) }); }, { email: loc.email, password: loc.password });
  await p.evaluate((m) => localStorage.setItem("doop:gpu", m), mode);
  await p.goto(`${L}/c/${loc.canvas}?page=${page}`, { waitUntil: "domcontentloaded" }); await sleep(6000);
  const state = () => p.evaluate(() => ({
    canvas: !!document.querySelector("[data-stage-pictures]"),
    shells: document.querySelectorAll("[data-frame-shell]").length,
    imgs: document.querySelectorAll("[data-frame-shell] img").length,
    live: document.querySelectorAll("iframe[data-doop-frame]").length,
    webgl2: !!document.createElement("canvas").getContext("webgl2"),
  }));
  console.log(mode, "fit", JSON.stringify(await state()));
  await p.screenshot({ path: `${prefix}-${mode}-fit.png` });
  await p.mouse.move(800, 500);
  for (let i = 0; i < 12; i++) { await p.keyboard.down("Control"); await p.mouse.wheel({ deltaY: -100 }); await p.keyboard.up("Control"); await sleep(60); }
  await sleep(4000);
  console.log(mode, "zoomed", JSON.stringify(await state()));
  await p.screenshot({ path: `${prefix}-${mode}-zoom.png` });
  await p.close();
}
await b.close();
