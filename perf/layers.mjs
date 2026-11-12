import { createRequire } from "node:module"; import { readFileSync } from "node:fs";
const puppeteer = createRequire(new URL("../build/doop/package.json", import.meta.url))("puppeteer-core");
const loc = JSON.parse(readFileSync(new URL("./local.json", import.meta.url))); const L = "http://localhost:4477";
const b = await puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: true, args: ["--no-sandbox", "--window-size=1600,1000"] });
const p = await b.newPage(); await p.setViewport({ width: 1600, height: 1000 });
await p.goto(L + "/", { waitUntil: "domcontentloaded" });
await p.evaluate(async (c) => { await fetch("/api/auth/sign-in/email", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(c) }); }, { email: loc.email, password: loc.password });
await p.goto(`${L}/c/${loc.canvas}?page=${process.argv[2] || "stress"}`, { waitUntil: "domcontentloaded" });
await new Promise((r) => setTimeout(r, 6000));
const c = await p.createCDPSession(); let layers = [];
c.on("LayerTree.layerTreeDidChange", (e) => { if (e.layers) layers = e.layers; });
await c.send("DOM.enable"); await c.send("LayerTree.enable"); await new Promise((r) => setTimeout(r, 800));
const css = process.argv[3]; if (css) { await p.addStyleTag({ content: css }); }
await p.mouse.move(700, 500); await p.mouse.wheel({ deltaY: 30 }); await new Promise((r) => setTimeout(r, 1500));
console.log("layers", layers.length, "drawing", layers.filter((l) => l.drawsContent).length);
const reasons = {}; const sample = {};
for (const l of layers) { let r; try { r = await c.send("LayerTree.compositingReasons", { layerId: l.layerId }); } catch { continue; } const k = (r.compositingReasonIds || r.compositingReasons || []).join("+") || "(none)"; reasons[k] = (reasons[k] || 0) + 1; if (!sample[k] && l.backendNodeId) { try { const n = await c.send("DOM.describeNode", { backendNodeId: l.backendNodeId }); sample[k] = `${n.node.nodeName} ${(n.node.attributes || []).join(" ").slice(0, 140)} [${l.width}x${l.height}]`; } catch {} } }
for (const [k, v] of Object.entries(reasons).sort((a, b) => b[1] - a[1])) console.log(String(v).padStart(5), k, "|", sample[k] || "");
await b.close();
