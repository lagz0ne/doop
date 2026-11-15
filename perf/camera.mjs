// What one camera frame costs, write by write: 30 animation frames of a single DOM write (the world's transform, the dot grid's transform, the label layer's --vx/--vy, nothing) and a real wheel pan, each traced.
// Prints the editor's main-thread and compositor-thread busy time, full compositor updates (PaintArtifactCompositor::Update, "Layerize"), style, paint and commit.
// usage: node camera.mjs [css to inject]   env: DOOP=url LS='{"k":"v"}' ZOOM=0.6 V=grid,world,wheel REPS=2 SETUP='js run in the page first' INFO=1 DUMP=1 CHROME_ARGS=…
import { createRequire } from "node:module"; import { readFileSync } from "node:fs";
const puppeteer = createRequire(new URL("../build/doop/package.json", import.meta.url))("puppeteer-core");
const loc = JSON.parse(readFileSync(new URL("./local.json", import.meta.url))); const L = process.env.DOOP || "http://localhost:4477"; const css = process.argv[2];
const b = await puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: true, args: ["--no-sandbox", "--window-size=1600,1000", "--site-per-process", "--enable-features=IsolateSandboxedIframes", ...(process.env.CHROME_ARGS || "").split(" ").filter(Boolean)] });
const p = await b.newPage(); await p.setViewport({ width: 1600, height: 1000 }); const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await p.goto(L + "/", { waitUntil: "domcontentloaded" });
await p.evaluate(async (c) => { await fetch("/api/auth/sign-in/email", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(c) }); localStorage.setItem("doop:render-trial", "off"); }, { email: loc.email, password: loc.password });
if (process.env.LS) await p.evaluate((kv) => { for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v); }, JSON.parse(process.env.LS));
await p.goto(`${L}/c/${loc.canvas}?page=stress`, { waitUntil: "domcontentloaded" }); await p.waitForSelector(".world", { timeout: 30000 }); await sleep(5000); await p.mouse.move(500, 400);
if (css) await p.addStyleTag({ content: css });
if (process.env.ZOOM) { const target = Number(process.env.ZOOM); const zoomNow = () => p.evaluate(() => Number(getComputedStyle(document.querySelector("[data-stage-labels]")).getPropertyValue("--zoom"))); for (let i = 0; i < 80; i++) { const z = await zoomNow(); if (Math.abs(z - target) / target < 0.08) break; await p.keyboard.down("Control"); await p.mouse.wheel({ deltaY: (z < target ? -1 : 1) * Math.min(100, 25 + 200 * Math.abs(Math.log(z / target))) }); await p.keyboard.up("Control"); await sleep(50); } await sleep(4000); }
console.log("css:", css || "(none)"); console.log("world transform:", await p.evaluate(() => document.querySelector(".world").style.transform), "· labels children", await p.evaluate(() => document.querySelector("[data-stage-labels]").children.length));
if (process.env.SETUP) console.log("setup:", process.env.SETUP, "->", await p.evaluate((src) => String(eval(src)), process.env.SETUP));
if (process.env.INFO) console.log(await p.evaluate(() => { const sh = [...document.querySelectorAll("[data-frame-shell]")]; const one = sh[0]; const wrap = one && one.closest(".world > *, .world *"); let top = one; while (top && top.parentElement && !top.parentElement.classList.contains("world") && top.parentElement.parentElement && !top.parentElement.parentElement.classList.contains("world")) top = top.parentElement; return JSON.stringify({ shells: sh.length, worldChildren: document.querySelector(".world").children.length, elementsInWorld: document.querySelector(".world").querySelectorAll("*").length, sample: (top || one)?.parentElement?.outerHTML.slice(0, 2500) }, null, 1); }));
await sleep(1500);
const cdp = await p.createCDPSession();
const variants = {
  "world transform only": (i) => { const w = document.querySelector(".world"); w.dataset.t ??= w.style.transform; w.style.transform = w.dataset.t.replace(/translate\(([-\d.]+)px/, (m, x) => `translate(${Number(x) + (i % 2 ? 7 : -7)}px`); },
  "grid transform only": (i) => { const g = document.querySelector('.stage div[class*="radial-gradient"]'); g.style.transform = `translate(${-(i % 9)}px, -3px)`; },
  "labels --vx/--vy only": (i) => { const l = document.querySelector("[data-stage-labels]"); l.style.setProperty("--vx", `${100 + i}px`); l.style.setProperty("--vy", `${50 + i}px`); },
  "nothing (rAF only)": () => {},
};
const run = async (name, fn) => {
  await cdp.send("Tracing.start", { transferMode: "ReturnAsStream", traceConfig: { includedCategories: ["devtools.timeline", "disabled-by-default-devtools.timeline", "blink", "cc", "disabled-by-default-blink.debug", "disabled-by-default-cc.debug", "toplevel"] } }); await sleep(200);
  if (fn === "wheel") { for (let i = 0; i < 30; i++) { await p.mouse.wheel({ deltaX: i % 2 ? 60 : -60, deltaY: i < 15 ? 60 : -60 }); await sleep(40); } }
  else await p.evaluate((src, frames) => new Promise((done) => { const f = eval(src); let i = 0; const step = () => { if (i++ >= frames) return done(); f(i); requestAnimationFrame(step); }; requestAnimationFrame(step); }), `(${fn})`, 30);
  await sleep(400); const done = new Promise((r) => cdp.once("Tracing.tracingComplete", r)); await cdp.send("Tracing.end"); const { stream } = await done; let data = ""; for (;;) { const c = await cdp.send("IO.read", { handle: stream, size: 1 << 24 }); data += c.data; if (c.eof) break; }
  const ev = JSON.parse(data).traceEvents; const sum = (n) => { const l = ev.filter((e) => e.name === n && e.ph === "X"); return `${l.length} × ${(l.reduce((a, e) => a + e.dur, 0) / 1000).toFixed(1)} ms`; };
  if (process.env.DUMP) { const lz = ev.filter((e) => e.name === "Layerize" && e.ph === "X" && e.dur > 500); const agg = new Map(); for (const l of lz) for (const e of ev) if (e.pid === l.pid && e.tid === l.tid && e.ts >= l.ts && e.ts <= l.ts + l.dur && e !== l && (e.ph === "X" || e.ph === "I" || e.ph === "i")) { const k = e.name.replace(/auto cc::LayerTreeHost::SetNeedsCommit.*/, "SetNeedsCommit") + " [" + e.cat + "]"; const a = agg.get(k) || agg.set(k, [0, 0]).get(k); a[0]++; a[1] += e.dur || 0; } console.log("   inside", lz.length, "Layerize:", [...agg].sort((a, b) => b[1][1] - a[1][1] || b[1][0] - a[1][0]).slice(0, 12).map(([k, [n, d]]) => `${k} ${n}× ${(d / 1000).toFixed(1)}ms`).join(" · ")); }
  const lzE = ev.find((e) => e.name === "Layerize" && e.ph === "X"); const tn = new Map(ev.filter((e) => e.name === "thread_name" && e.ph === "M").map((e) => [e.pid + ":" + e.tid, e.args.name]));
  const busy = (thr) => { let t = 0; for (const e of ev) if (e.ph === "X" && e.pid === lzE?.pid && e.name === "RunTask" && tn.get(e.pid + ":" + e.tid) === thr) t += e.dur; return (t / 1000).toFixed(0); };
  const tot = `main ${busy("CrRendererMain")} ms · compositor ${busy("Compositor")} ms ·`;
  console.log(name.padEnd(22), tot, "PAC::Update", sum("PaintArtifactCompositor::Update").padEnd(15), "· Layerize", sum("Layerize").padEnd(16), "· style", sum("UpdateLayoutTree").padEnd(15), "· Paint", sum("Paint").padEnd(14), "· Commit", sum("Commit").padEnd(14));
};
const pick = (process.env.V || "").split(",").filter(Boolean);
for (let rep = 0; rep < Number(process.env.REPS || 1); rep++) for (const [n, f] of Object.entries(variants)) if (!pick.length || pick.some((x) => n.includes(x))) await run(n, f.toString());
for (let rep = 0; rep < Number(process.env.REPS || 1); rep++) if (!pick.length || pick.includes("wheel")) await run("real pan (wheel)", "wheel");
await b.close();
