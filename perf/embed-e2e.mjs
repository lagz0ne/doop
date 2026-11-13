// End to end: the review panel embedded in a host app, against a local doop (bin/doop serve with
// DOOP_EMBED_HOSTS naming http://localhost:4499). A reviewer requests changes with a pinned comment,
// an "agent" revises the frame (the owner's REST edit), the reviewer compares and approves.
// usage: CHROME_PATH=... node embed-e2e.mjs <frameId> [outPrefix=out/embed/e2e]
import { createRequire } from "node:module";
import { readFileSync, mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
const puppeteer = createRequire(new URL("../build/doop/package.json", import.meta.url))("puppeteer-core");
const D = "http://localhost:4477", HOST = "http://localhost:4499";
const loc = JSON.parse(readFileSync(new URL("./local.json", import.meta.url)));
const [frameId, out = new URL("./out/embed/e2e", import.meta.url).pathname] = process.argv.slice(2);
mkdirSync(out.replace(/\/[^/]*$/, ""), { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const step = (s) => console.log(`- ${s}`);

// the canvas owner, for the "agent" revision and to read back the verdict
const signIn = await fetch(`${D}/api/auth/sign-in/email`, { method: "POST", headers: { "content-type": "application/json", origin: D }, body: JSON.stringify({ email: loc.email, password: loc.password }) });
const cookie = signIn.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
const owner = (path, init = {}) => fetch(`${D}/api${path}`, { ...init, headers: { cookie, origin: D, "content-type": "application/json", ...(init.headers || {}) } });
const frameNow = async () => (await (await owner(`/canvases/${loc.canvas}`)).json()).frames.find((f) => f.id === frameId);

// start clean: the frame as a draft with its original footer line
let f = await frameNow();
if (f.approval) await owner(`/frames/${frameId}/approval`, { method: "PUT", body: JSON.stringify({ status: "draft", expectedUpdatedAt: f.updatedAt }) });
f = await frameNow();
if (!f.html.includes("Link works 7 days")) {
  await owner(`/frames/${frameId}`, { method: "PATCH", body: JSON.stringify({ html: f.html.replace(/Link expires[^<]*/, "Link works 7 days"), expectedUpdatedAt: f.updatedAt }) });
  f = await frameNow();
  await owner(`/frames/${frameId}/approval`, { method: "PUT", body: JSON.stringify({ status: "draft", expectedUpdatedAt: f.updatedAt }) });
}

const host = spawn(process.execPath, [new URL("./embed-host.mjs", import.meta.url).pathname, "4499"], { env: { ...process.env, CANVAS: loc.canvas, HOST_SECRET: readFileSync("/tmp/embed-host-secret", "utf8").trim() }, stdio: "inherit" });
await sleep(800);
const b = await puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: true, args: ["--no-sandbox", "--site-per-process", "--force-device-scale-factor=2"] });
try {
  const p = await b.newPage(); await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
  p.on("console", (m) => m.type() === "error" && console.log("  [console]", m.text().slice(0, 200)));
  await p.goto(`${HOST}/?frame=${frameId}`, { waitUntil: "domcontentloaded" });
  const panel = await (await p.waitForSelector("#panel")).contentFrame();
  await panel.waitForSelector(".review", { timeout: 20000 }); await sleep(2500);
  const kb = await panel.evaluate(() => Math.round(performance.getEntriesByType("resource").filter((e) => /\.(js|css)$/.test(new URL(e.name).pathname)).reduce((s, e) => s + (e.transferSize || e.encodedBodySize), 0) / 1024));
  step(`panel open; its scripts and styles: ${kb} KB over the wire; address bar: ${await panel.evaluate(() => location.hash)}`);
  await p.screenshot({ path: `${out}-1-open.png` });

  // request changes, pinned on the footer line
  await panel.click(".pf .btn:not(.pri)");
  const box = await panel.evaluate(() => { const r = document.querySelector(".sheet").getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width }; });
  const k = box.w / 1440;
  await panel.click(".shield", { offset: { x: 532 * k, y: 528 * k } }); await sleep(600);
  step(`pinned on: ${await panel.$eval(".compose p", (e) => e.textContent)}`);
  await panel.type(".compose textarea", "Say when the link expires, not how long it works, and make it readable.");
  await p.screenshot({ path: `${out}-2-request.png` });
  await panel.click(".compose .btn.pri");
  await p.waitForFunction(() => window.__msgs.some((m) => m.type === "doop:verdict" && m.status === "changes_requested"), { timeout: 10000 });
  await sleep(800);
  f = await frameNow();
  step(`doop now says: ${f.approval.status} by ${f.approval.approvedBy}; history ${f.approval.history.length}, version ${f.approval.history.at(-1).versionId ? "filed" : "missing"}`);
  await p.screenshot({ path: `${out}-3-requested.png` });

  // the agent revises (here: the owner's edit through REST, as an MCP set_frame_html would)
  await owner(`/frames/${frameId}`, { method: "PATCH", body: JSON.stringify({ html: f.html.replace("Link works 7 days", "Link expires Wed 19 Nov (7 days)"), expectedUpdatedAt: f.updatedAt }) });
  await panel.waitForFunction(() => document.querySelector(".badge")?.textContent.includes("Revised since"), { timeout: 10000 });
  step(`panel shows: ${await panel.$eval(".badge", (e) => e.textContent)}`);
  await panel.click(".seg button:nth-child(2)");
  await panel.waitForSelector(".changes", { timeout: 10000 }); await sleep(2500);
  step(`compare: ${await panel.$eval(".changes", (e) => e.textContent.replace(/\s+/g, " ").trim())}`);
  await p.screenshot({ path: `${out}-4-compare.png` });

  // approve
  await panel.click(".pf .btn.pri");
  await p.waitForFunction(() => window.__msgs.some((m) => m.type === "doop:verdict" && m.status === "ready_for_dev"), { timeout: 10000 });
  await sleep(1200);
  f = await frameNow();
  step(`doop now says: ${f.approval.status} by ${f.approval.approvedBy}; history: ${f.approval.history.map((h) => h.status).join(" → ")}`);
  await p.screenshot({ path: `${out}-5-approved.png` });
  step(`host page heard: ${(await p.evaluate(() => window.__msgs.map((m) => m.type + (m.status ? `(${m.status})` : "")))).join(", ")}`);

  // what the reviewer's session may not do
  const forbidden = await panel.evaluate(async (id) => (await fetch(`/api/frames/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "x" }) })).status, frameId);
  step(`reviewer editing the frame: HTTP ${forbidden}`);
} finally {
  await b.close(); host.kill();
}
