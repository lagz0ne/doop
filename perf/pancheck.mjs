import { createRequire } from "node:module"; import { readFileSync } from "node:fs";
const puppeteer = createRequire(new URL("../build/doop/package.json", import.meta.url))("puppeteer-core");
const loc = JSON.parse(readFileSync(new URL("./local.json", import.meta.url))); const L = "http://localhost:4477";
const b = await puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: true, args: ["--no-sandbox", "--window-size=1600,1000"] });
const p = await b.newPage(); await p.setViewport({ width: 1600, height: 1000 });
await p.goto(L + "/", { waitUntil: "domcontentloaded" });
await p.evaluate(async (c) => { await fetch("/api/auth/sign-in/email", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(c) }); }, { email: loc.email, password: loc.password });
await p.goto(`${L}/c/${loc.canvas}?page=stress`, { waitUntil: "domcontentloaded" }); const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); await sleep(5000);
const cam = () => p.evaluate(() => { const st = document.querySelector(".stage"); const w = document.querySelector(".world"); const z = Number(getComputedStyle(st).getPropertyValue("--zoom")); const m = new DOMMatrix(getComputedStyle(w).transform); const shells = [...document.querySelectorAll("[data-frame-shell],[data-frame-surface]")]; const vis = shells.filter((e) => { const r = e.getBoundingClientRect(); return r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight; }).length; return { zoom: z, tx: Math.round(m.e), ty: Math.round(m.f), worldView: [Math.round(-m.e / z), Math.round(-m.f / z)], framesOnScreen: vis, iframes: document.querySelectorAll("iframe[data-doop-frame]").length }; });
console.log("fit     ", await cam());
await p.mouse.move(500, 400);
for (let i = 0; i < 80; i++) { const z = (await cam()).zoom; if (Math.abs(z - 0.6) / 0.6 < 0.08) break; await p.keyboard.down("Control"); await p.mouse.wheel({ deltaY: -Math.min(100, 25 + 200 * Math.abs(Math.log(z / 0.6))) }); await p.keyboard.up("Control"); await sleep(50); }
await sleep(1500); console.log("zoomed  ", await cam());
for (let i = 0; i < 5; i++) { await p.mouse.wheel({ deltaX: -10, deltaY: -250 }); await sleep(60); } await sleep(800); console.log("5 wheels", await cam());
for (let i = 0; i < 35; i++) { await p.mouse.wheel({ deltaX: -10, deltaY: -250 }); await sleep(60); } await sleep(1500); console.log("40 wheel", await cam());
await b.close();
