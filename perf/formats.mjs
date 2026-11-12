// Preview format/size trade-off: render real frames at each tier in jpeg/webp/png, print bytes and ms.
import { createRequire } from "node:module"; import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
const puppeteer = createRequire(new URL("../build/doop/package.json", import.meta.url))("puppeteer-core");
const c = JSON.parse(readFileSync(new URL("./canvas.json", import.meta.url)));
const pick = [c.frames.find((f) => f.name === "70 Invite email"), c.frames.find((f) => f.width === 1440 && /<img/.test(f.html) && f.html.length > 20000), c.frames.find((f) => f.width === 12640)];
const b = await puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: true, args: ["--no-sandbox", "--hide-scrollbars"] });
mkdirSync(new URL("./out/formats/", import.meta.url), { recursive: true });
for (const [i, f] of pick.entries()) {
  const p = await b.newPage(); await p.setViewport({ width: f.width, height: f.height, deviceScaleFactor: 1 });
  let t = Date.now(); await p.setContent(f.html, { waitUntil: "load", timeout: 8000 }).catch(() => {}); const load = Date.now() - t;
  t = Date.now(); const fonts = await p.evaluate(async () => { await document.fonts.ready; return [...document.fonts].filter((x) => x.status === "loaded").length + "/" + document.fonts.size; }); 
  console.log(`\n${f.name} ${f.width}x${f.height} html ${f.html.length}  load ${load} ms, fonts ${fonts} (+${Date.now() - t} ms)`);
  for (const s of [0.25, 0.5, 1]) for (const [type, quality] of [["jpeg", 70], ["jpeg", 90], ["webp", 80], ["webp", 90], ["png"]]) {
    t = Date.now(); const buf = await p.screenshot({ type, ...(quality ? { quality } : {}), clip: { x: 0, y: 0, width: f.width, height: f.height, scale: s } });
    console.log(`  s=${s} ${type}${quality ? " q" + quality : ""}`.padEnd(20), String(Math.round(buf.length / 1024)).padStart(5), "KB", String(Date.now() - t).padStart(5), "ms");
    writeFileSync(new URL(`./out/formats/f${i}-s${s}-${type}${quality ?? ""}.${type === "jpeg" ? "jpg" : type}`, import.meta.url), buf);
  }
  await p.close();
}
await b.close();
