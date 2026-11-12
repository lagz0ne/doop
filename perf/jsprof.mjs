// JS CPU profile from a trace, with source-mapped names: self time per function and hottest stacks, per scenario.
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
const { TraceMap, originalPositionFor } = createRequire(new URL("../build/doop/package.json", import.meta.url))("@jridgewell/trace-mapping");
const dist = new URL("../build/doop/dist/assets/", import.meta.url).pathname;
const maps = {}; for (const f of readdirSync(dist)) if (f.endsWith(".js.map")) maps[f.slice(0, -4)] = new TraceMap(readFileSync(dist + f, "utf8"));
const tr = JSON.parse(readFileSync(process.argv[2], "utf8")); const ev = tr.traceEvents || tr; const only = process.argv[3]; const depth = +(process.argv[4] || 0);
const marks = {}; for (const e of ev) if (e.cat?.includes("blink.user_timing") && /^S\d-/.test(e.name)) marks[e.name] = e.ts;
const prof = {};
for (const e of ev) if (e.name === "ProfileChunk") { const id = e.pid + ":" + e.id; const cp = e.args.data.cpuProfile || {}; const P = prof[id] || (prof[id] = { nodes: new Map(), samples: [], dts: [], t: null }); for (const n of cp.nodes || []) P.nodes.set(n.id, n); (cp.samples || []).forEach((s, i) => { P.samples.push(s); P.dts.push(e.args.data.timeDeltas[i]); }); }
for (const e of ev) if (e.name === "Profile") { const id = e.pid + ":" + e.id; if (prof[id]) prof[id].t = e.args.data.startTime; }
const nameOf = (cf) => { const file = String(cf.url).split("/").pop(); const m = maps[file]; if (m && cf.lineNumber >= 0) { const o = originalPositionFor(m, { line: cf.lineNumber + 1, column: cf.columnNumber }); if (o.source) return `${o.name || cf.functionName || "(anon)"} ${o.source.replace(/^.*\/(src|node_modules)\//, "$1/").slice(0, 46)}:${o.line}`; } return `${cf.functionName || "(anon)"} ${file.slice(0, 20) || "native"}:${cf.lineNumber}`; };
const ms = (us) => (us / 1000).toFixed(0).padStart(6);
for (const s of [...new Set(Object.keys(marks).map((k) => k.split(":")[0]))].sort()) {
  if (only && !s.includes(only)) continue; const t0 = marks[s + ":start"], t1 = marks[s + ":end"];
  const self = new Map(), incl = new Map(), stacks = new Map();
  for (const P of Object.values(prof)) { let t = P.t; P.samples.forEach((sid, i) => { t += P.dts[i]; if (t < t0 || t >= t1) return; let n = P.nodes.get(sid); if (!n) return; const leaf = nameOf(n.callFrame); if (/^\(idle\)|^\(program\)/.test(leaf)) return; self.set(leaf, (self.get(leaf) || 0) + P.dts[i]); const seen = new Set(); const path = []; for (; n; n = P.nodes.get(n.parent)) { const nm = nameOf(n.callFrame); path.push(nm); if (!seen.has(nm)) { seen.add(nm); incl.set(nm, (incl.get(nm) || 0) + P.dts[i]); } } if (depth) { const k = path.filter((x) => x.includes("src/")).slice(0, depth).join(" < "); stacks.set(k, (stacks.get(k) || 0) + P.dts[i]); } }); }
  console.log(`\n==== ${s}: JS self time`); for (const [k, v] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 14)) if (v > 4000) console.log(`${ms(v)} ms  ${k}`);
  console.log(`---- inclusive, app code (src/)`); for (const [k, v] of [...incl].filter(([k]) => k.includes("src/")).sort((a, b) => b[1] - a[1]).slice(0, 14)) if (v > 8000) console.log(`${ms(v)} ms  ${k}`);
  if (depth) { console.log(`---- hottest app stacks (leaf < callers)`); for (const [k, v] of [...stacks].sort((a, b) => b[1] - a[1]).slice(0, 8)) if (v > 8000 && k) console.log(`${ms(v)} ms  ${k}`); }
}
