// Each long task on the page's main thread, broken down: what Blink did in it (self time per trace event)
// and which JS ran (source-mapped self time from the CPU profile). The flame chart, read as a table.
// usage: node tasks.mjs <trace.json> [scenario=L1-load] [min task ms=50]
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
const { TraceMap, originalPositionFor } = createRequire(new URL("../build/doop/package.json", import.meta.url))("@jridgewell/trace-mapping");
const dist = new URL(`../build/${process.env.TREE || "doop"}/dist/assets/`, import.meta.url).pathname;
const maps = {}; for (const f of readdirSync(dist)) if (f.endsWith(".js.map")) maps[f.slice(0, -4)] = new TraceMap(readFileSync(dist + f, "utf8"));
const [file, scen = "L1-load", minArg = "50"] = process.argv.slice(2);
const tr = JSON.parse(readFileSync(file, "utf8")); const ev = tr.traceEvents || tr;
const marks = {}; for (const e of ev) if (e.cat?.includes("blink.user_timing") && e.name.startsWith(scen + ":")) marks[e.name.split(":")[1]] = e.ts;
const t0 = marks.start, t1 = marks.end;
if (!t0 || !t1) throw new Error(`no ${scen}:start/end marks`);
const tname = {}; for (const e of ev) if (e.ph === "M" && e.name === "thread_name") tname[e.pid + ":" + e.tid] = e.args.name;
/* the page's main thread: the renderer main thread that recorded the end mark */
const endMark = ev.find((e) => e.cat?.includes("blink.user_timing") && e.name === scen + ":end");
const key = endMark.pid + ":" + endMark.tid;
const X = ev.filter((e) => e.ph === "X" && e.dur !== undefined && e.pid + ":" + e.tid === key && e.ts + e.dur > t0 && e.ts < t1).sort((a, b) => a.ts - b.ts || b.dur - a.dur);
const tasks = X.filter((e) => (e.name === "RunTask" || e.name === "ThreadControllerImpl::RunTask") && e.dur >= +minArg * 1000);
/* drop tasks nested in another listed task */
const top = tasks.filter((e, i) => !tasks.some((o, j) => j !== i && o.ts <= e.ts && o.ts + o.dur >= e.ts + e.dur && o.dur > e.dur));
const prof = {};
for (const e of ev) if (e.name === "ProfileChunk" && e.pid === endMark.pid) { const id = e.pid + ":" + e.id; const cp = e.args.data.cpuProfile || {}; const P = prof[id] || (prof[id] = { nodes: new Map(), samples: [], dts: [], t: null }); for (const n of cp.nodes || []) P.nodes.set(n.id, n); (cp.samples || []).forEach((s, i) => { P.samples.push(s); P.dts.push(e.args.data.timeDeltas[i]); }); }
for (const e of ev) if (e.name === "Profile" && e.pid === endMark.pid) { const id = e.pid + ":" + e.id; if (prof[id]) prof[id].t = e.args.data.startTime; }
const nameOf = (cf) => { const f = String(cf.url).split("/").pop(); const m = maps[f]; if (m && cf.lineNumber >= 0) { const o = originalPositionFor(m, { line: cf.lineNumber + 1, column: cf.columnNumber }); if (o.source) return `${o.name || cf.functionName || "(anon)"} ${o.source.replace(/^.*\/(src|node_modules)\//, "$1/").slice(0, 50)}:${o.line}`; } return `${cf.functionName || "(anon)"} ${f.slice(0, 24) || "native"}`; };
const samples = []; for (const P of Object.values(prof)) { let t = P.t; P.samples.forEach((sid, i) => { t += P.dts[i]; samples.push([t, P.dts[i], P.nodes.get(sid), P]); }); }
const ms = (us) => (us / 1000).toFixed(0).padStart(5);
console.log(`${scen}: ${((t1 - t0) / 1000).toFixed(0)} ms, ${top.length} tasks ≥ ${minArg} ms on ${tname[key]} (${top.reduce((a, e) => a + e.dur, 0) / 1000 | 0} ms)`);
for (const task of top) {
  const end = task.ts + task.dur;
  const inner = X.filter((e) => e.ts >= task.ts && e.ts + e.dur <= end);
  const self = new Map(); const st = [];
  for (const e of inner) { while (st.length && st.at(-1).end <= e.ts) st.pop(); if (st.length) st.at(-1).child += e.dur; const n = { e, end: e.ts + e.dur, child: 0 }; st.push(n); e._n = n; }
  for (const e of inner) self.set(e.name, (self.get(e.name) || 0) + e.dur - Math.min(e.dur, e._n.child));
  const js = new Map(), incl = new Map();
  for (const [t, dt, node, P] of samples) { if (t < task.ts || t >= end || !node) continue; const leaf = nameOf(node.callFrame); if (/^\((idle|program)\)/.test(leaf)) continue; js.set(leaf, (js.get(leaf) || 0) + dt); const seen = new Set(); for (let n = node; n; n = P.nodes.get(n.parent)) { const nm = nameOf(n.callFrame); if (nm.includes("src/") && !seen.has(nm)) { seen.add(nm); incl.set(nm, (incl.get(nm) || 0) + dt); } } }
  const url = inner.find((e) => e.args?.data?.url)?.args.data.url;
  console.log(`\n@${ms(task.ts - t0)} ms  ${ms(task.dur)} ms ${url ? "  " + String(url).replace(/^https?:\/\/[^/]+/, "").slice(0, 60) : ""}`);
  console.log("   blink: " + [...self].sort((a, b) => b[1] - a[1]).filter(([n, v]) => v > 3000 && !/RunTask/.test(n)).slice(0, 8).map(([n, v]) => `${n} ${(v / 1000).toFixed(0)}`).join(" · "));
  for (const [k, v] of [...js].sort((a, b) => b[1] - a[1]).slice(0, 6)) if (v > 3000) console.log(`   js self ${ms(v)}  ${k}`);
  for (const [k, v] of [...incl].sort((a, b) => b[1] - a[1]).slice(0, 8)) if (v > 5000) console.log(`   app incl ${ms(v)}  ${k}`);
}
