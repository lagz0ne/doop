import { createRequire } from "node:module"; import { readFileSync } from "node:fs";
const puppeteer = createRequire(new URL("../build/doop/package.json", import.meta.url))("puppeteer-core");
const L = "http://localhost:4478"; const loc = JSON.parse(readFileSync(new URL("./local-base.json", import.meta.url)));
for (const flags of [[], ["--enable-features=IsolateSandboxedIframes"], ["--site-per-process", "--enable-features=IsolateSandboxedIframes"]]) {
  const b = await puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: true, args: ["--no-sandbox", "--window-size=1600,1000", ...flags] });
  const p = await b.newPage(); await p.goto(L + "/", { waitUntil: "domcontentloaded" });
  await p.evaluate(async (c) => { await fetch("/api/auth/sign-in/email", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(c) }); }, { email: loc.email, password: loc.password });
  await p.goto(`${L}/c/${loc.canvas}?page=e2e-assets`, { waitUntil: "domcontentloaded" }); await new Promise((r) => setTimeout(r, 4000));
  const cdp = await b.target().createCDPSession(); const info = await cdp.send("SystemInfo.getProcessInfo").catch(() => null);
  const t = (await cdp.send("Target.getTargets")).targetInfos; const kinds = {}; for (const x of t) kinds[x.type] = (kinds[x.type] || 0) + 1;
  console.log(JSON.stringify(flags), "targets", JSON.stringify(kinds), "renderer processes", info ? info.processInfo.filter((x) => x.type === "renderer").length : "?", "iframes in page", await p.evaluate(() => document.querySelectorAll("iframe").length));
  await b.close();
}
