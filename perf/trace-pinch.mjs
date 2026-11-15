// Chrome trace of a pan at fit, a pinch 60>95% and back (one wheel event per animation frame) and a pan at 60%, with CPU per thread of the GPU process for each.
// usage: node trace-pinch.mjs <out.json|-> [css]   ("-" skips the trace)   env: DOOP=url LS=… FRAMECSS='css for every frame document' CHROME_ARGS=…
import { createRequire } from "node:module"; import { readFileSync, writeFileSync } from "node:fs";
const puppeteer = createRequire(new URL("../build/doop/package.json", import.meta.url))("puppeteer-core");
const [out, css] = process.argv.slice(2);
const loc = JSON.parse(readFileSync(new URL("./local.json", import.meta.url))); const L = process.env.DOOP || "http://localhost:4477";
const b = await puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: true, args: ["--no-sandbox", "--window-size=1600,1000", "--site-per-process", "--enable-features=IsolateSandboxedIframes", ...(process.env.CHROME_ARGS || "").split(" ").filter(Boolean)] });
const p = await b.newPage(); await p.setViewport({ width: 1600, height: 1000 }); const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await p.goto(L + "/", { waitUntil: "domcontentloaded" });
await p.evaluate(async (c) => { await fetch("/api/auth/sign-in/email", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(c) }); localStorage.setItem("doop:render-trial", "off"); }, { email: loc.email, password: loc.password });
if (process.env.LS) await p.evaluate((kv) => { for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v); }, JSON.parse(process.env.LS));
const cdp = await b.target().createCDPSession();
import("node:fs").then(() => {}); const fs = await import("node:fs");
const gpuPid = async () => (await cdp.send("SystemInfo.getProcessInfo")).processInfo.find((x) => x.type === "GPU")?.id;
const threads = (pid) => { const o = {}; try { for (const t of fs.readdirSync(`/proc/${pid}/task`)) { const st = fs.readFileSync(`/proc/${pid}/task/${t}/stat`, "utf8"); const name = st.slice(st.indexOf("(") + 1, st.lastIndexOf(")")).replace(/[\d/:#-]+$/g, ""); const f = st.slice(st.lastIndexOf(")") + 2).split(" "); o[name] = (o[name] || 0) + (Number(f[11]) + Number(f[12])) * 10; } } catch {} return o; };
const cpu = async () => { const i = await cdp.send("SystemInfo.getProcessInfo"); const sum = (t) => i.processInfo.filter((x) => x.type === t).reduce((a, x) => a + x.cpuTime, 0); return { gpu: sum("GPU") * 1000, rend: sum("renderer") * 1000, th: threads(await gpuPid()) }; };
let c0 = null; const mark = async (n) => { await p.evaluate((n) => performance.mark(n), n); const c = await cpu(); if (n.endsWith(":start")) c0 = c; else { const d = Object.entries(c.th).map(([k, v]) => [k, v - (c0.th[k] || 0)]).filter((x) => x[1] >= 50).sort((a, b) => b[1] - a[1]); console.log(n.split(":")[0].padEnd(14), "GPU proc", String(Math.round(c.gpu - c0.gpu)).padStart(6), "ms · renderers", String(Math.round(c.rend - c0.rend)).padStart(6), "ms · GPU threads:", d.map(([k, v]) => `${k} ${v}`).join(", ")); } };
const zoomNow = () => p.evaluate(() => Number(getComputedStyle(document.querySelector("[data-stage-labels]") || document.querySelector(".stage")).getPropertyValue("--zoom")));
async function zoomTo(target) { for (let i = 0; i < 80; i++) { const z = await zoomNow(); if (Math.abs(z - target) / target < 0.08) break; const dir = z < target ? -1 : 1; await p.keyboard.down("Control"); await p.mouse.wheel({ deltaY: dir * Math.min(100, 25 + 200 * Math.abs(Math.log(z / target))) }); await p.keyboard.up("Control"); await sleep(50); } }
const pinch = (from, to, frames = 30) => p.evaluate((from, to, frames) => new Promise((done) => { const el = document.querySelector(".stage"); const r = el.getBoundingClientRect(); const d = (-100 * Math.log(to / from)) / frames; let i = 0; const step = () => { if (i++ >= frames) return done(); el.dispatchEvent(new WheelEvent("wheel", { deltaY: d, ctrlKey: true, clientX: r.left + 500, clientY: r.top + 400, bubbles: true, cancelable: true })); requestAnimationFrame(step); }; requestAnimationFrame(step); }), from, to, frames);
await p.goto(`${L}/c/${loc.canvas}?page=stress`, { waitUntil: "domcontentloaded" }); await p.waitForSelector(".world", { timeout: 30000 }); await sleep(5000);
await p.mouse.move(500, 400);
const cats = ["devtools.timeline", "disabled-by-default-devtools.timeline", "blink.user_timing", "cc", "gpu", "viz", "benchmark", "toplevel", "disabled-by-default-cc.debug.scheduler"];
if (out !== "-") await cdp.send("Tracing.start", { transferMode: "ReturnAsStream", traceConfig: { recordMode: "recordAsMuchAsPossible", includedCategories: cats } });
await sleep(300);
if (css) await p.addStyleTag({ content: css });
await mark("A1-panfit:start"); for (let i = 0; i < 24; i++) { await p.mouse.wheel({ deltaX: i % 2 ? 60 : -60, deltaY: i < 12 ? 60 : -60 }); await sleep(40); } await sleep(1500); await mark("A1-panfit:end");
await zoomTo(0.6); await sleep(4000);
if (process.env.FRAMECSS) { let n = 0; for (const f of p.frames()) if (f !== p.mainFrame()) { await f.addStyleTag({ content: process.env.FRAMECSS }).then(() => n++).catch(() => {}); } console.log("frame css in", n, "documents"); await sleep(1500); }
await mark("B1-pinchup:start"); await pinch(0.6, 0.95); await sleep(2500); await mark("B1-pinchup:end");
await mark("B2-pinchdown:start"); await pinch(0.95, 0.6); await sleep(2500); await mark("B2-pinchdown:end");
await mark("C1-pan60:start"); for (let i = 0; i < 12; i++) { await p.mouse.wheel({ deltaX: -10, deltaY: -250 }); await sleep(60); } await sleep(2500); await mark("C1-pan60:end");
if (out !== "-") { const done = new Promise((r) => cdp.once("Tracing.tracingComplete", r)); await cdp.send("Tracing.end"); const { stream } = await done;
let data = ""; for (;;) { const c = await cdp.send("IO.read", { handle: stream, size: 1 << 24 }); data += c.data; if (c.eof) break; }
writeFileSync(out, data); }
console.log("live", await p.evaluate(() => document.querySelectorAll("iframe[data-doop-frame]").length));
await b.close();
