// Screenshots of the local editor in the reviewer layout: as it opens, with the tool list open,
// with Comments open, and with Layers unfolded. usage: node ui-shot.mjs <outPrefix> [page=e2e-signin]
import { createRequire } from "node:module"; import { readFileSync } from "node:fs";
const puppeteer = createRequire(new URL("../build/doop/package.json", import.meta.url))("puppeteer-core");
const loc = JSON.parse(readFileSync(new URL("./local.json", import.meta.url))); const L = process.env.DOOP || "http://localhost:4477";
const [out, pageId = "e2e-signin"] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: true, args: ["--no-sandbox", "--window-size=1440,900"] });
const p = await b.newPage(); await p.setViewport({ width: 1440, height: 900 });
p.on("pageerror", (e) => console.log("  [pageerror]", e.message.slice(0, 300)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await p.goto(L + "/", { waitUntil: "domcontentloaded" });
await p.evaluate(async (c) => { await fetch("/api/auth/sign-in/email", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(c) }); localStorage.removeItem("doop:layers-section"); localStorage.setItem("doop:onboarding", JSON.stringify({ dismissed: true })); }, { email: loc.email, password: loc.password });
await p.goto(`${L}/c/${loc.canvas}?page=${pageId}`, { waitUntil: "domcontentloaded" });
await p.waitForSelector(".world", { timeout: 30000 }); await sleep(5000);
const state = () => p.evaluate(() => import("/src/lib/store.ts").catch(() => null).then(() => ({ tool: document.querySelector('[aria-label="Canvas dock"] [aria-pressed="true"]')?.getAttribute("aria-label"), dock: !!document.querySelector('[aria-label="Canvas dock"]'), topbar: getComputedStyle(document.querySelector("header") || document.body).display })));
console.log("open", await state());
await p.screenshot({ path: `${out}-1-open.png` });
await p.click('[aria-label="More tools"]'); await sleep(500); await p.screenshot({ path: `${out}-2-tools.png` }); await p.keyboard.press("Escape"); await sleep(300);
const comments = await p.$$('[aria-label="Canvas dock"] button'); 
await p.evaluate(() => [...document.querySelectorAll('[aria-label="Canvas dock"] button')].find((b) => /^Comments/.test(b.getAttribute("aria-label") || ""))?.click()); await sleep(800);
await p.screenshot({ path: `${out}-3-comments.png` });
await p.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.getAttribute("aria-expanded") === "false" && /Layers/.test(b.textContent || ""))?.click()); await sleep(600);
await p.screenshot({ path: `${out}-4-layers.png` });
await b.close();
