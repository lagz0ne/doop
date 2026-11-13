// Summarize a Chrome trace per scenario: CPU by process/thread, timeline event self time, top JS functions, input latency.
import { readFileSync } from "node:fs";
const tr = JSON.parse(readFileSync(process.argv[2], "utf8")); const ev = tr.traceEvents || tr;
const only = process.argv[3];
const pname = {}, tname = {};
for (const e of ev) { if (e.ph === "M" && e.name === "process_name") pname[e.pid] = e.args.name; if (e.ph === "M" && e.name === "thread_name") tname[e.pid + ":" + e.tid] = e.args.name; if (e.ph === "M" && e.name === "process_labels") pname[e.pid] += " [" + String(e.args.labels).slice(0, 40) + "]"; }
const marks = {}; for (const e of ev) if (e.cat?.includes("blink.user_timing") && /^[A-Z]\d-/.test(e.name)) marks[e.name] = e.ts;
const scen = [...new Set(Object.keys(marks).map((k) => k.split(":")[0]))].sort();
const X = ev.filter((e) => e.ph === "X" && e.dur !== undefined);
const byThread = new Map(); for (const e of X) { const k = e.pid + ":" + e.tid; (byThread.get(k) || byThread.set(k, []).get(k)).push(e); }
const ms = (us) => (us / 1000).toFixed(0).padStart(6);
// self time per event name per thread (stack-based)
function selfTimes(list, t0, t1) {
  const es = list.filter((e) => e.ts >= t0 && e.ts < t1).sort((a, b) => a.ts - b.ts || b.dur - a.dur);
  const self = new Map(); const st = []; let top = 0;
  for (const e of es) {
    while (st.length && st[st.length - 1].end <= e.ts) st.pop();
    if (st.length) st[st.length - 1].child += e.dur; else top += e.dur;
    const n = { e, end: e.ts + e.dur, child: 0 }; st.push(n); n.e._n = n;
  }
  for (const e of es) { const s = e.dur - Math.min(e.dur, e._n.child); self.set(e.name, (self.get(e.name) || 0) + s); }
  return { self, top, n: es.length };
}
for (const s of scen) {
  if (only && !s.includes(only)) continue;
  const t0 = marks[s + ":start"], t1 = marks[s + ":end"]; if (!t0 || !t1) continue;
  console.log(`\n================ ${s}  (${((t1 - t0) / 1e6).toFixed(1)} s wall)`);
  const rows = [];
  for (const [k, list] of byThread) { const r = selfTimes(list, t0, t1); if (r.top > 20000) rows.push({ k, ...r }); }
  rows.sort((a, b) => b.top - a.top);
  let total = 0; for (const r of rows) total += r.top;
  console.log(`CPU busy, all threads: ${ms(total)} ms`);
  for (const r of rows.slice(0, 9)) {
    const [pid] = r.k.split(":");
    console.log(`${ms(r.top)} ms  ${(pname[pid] || pid).slice(0, 46).padEnd(46)} ${tname[r.k] || r.k}`);
    const top = [...r.self].sort((a, b) => b[1] - a[1]).slice(0, 9).filter((x) => x[1] > 8000);
    console.log("          " + top.map(([n, v]) => `${n} ${(v / 1000).toFixed(0)}`).join(" · "));
  }
  // long tasks on renderer main threads
  const longs = []; for (const [k, list] of byThread) if ((tname[k] || "").includes("CrRendererMain")) for (const e of list) if (e.name === "RunTask" && e.ts >= t0 && e.ts < t1 && e.dur > 50000) longs.push([e.dur, pname[k.split(":")[0]]]);
  longs.sort((a, b) => b[0] - a[0]);
  console.log(`long tasks >50ms on main threads: ${longs.length}, worst ${longs.slice(0, 5).map((l) => (l[0] / 1000).toFixed(0)).join(", ")} ms`);
  // frames presented
  const fr = ev.filter((e) => e.name === "DrawFrame" && e.ts >= t0 && e.ts < t1).length; if (fr) console.log(`DrawFrame events: ${fr}`);
}
// JS: top functions by self samples across renderer mains (whole trace or scenario)
const nodes = new Map(); const prof = {};
for (const e of ev) if (e.name === "ProfileChunk") { const id = e.pid + ":" + e.id; const cp = e.args.data.cpuProfile || {}; const P = prof[id] || (prof[id] = { nodes: new Map(), samples: [], dts: [], t: null, pid: e.pid }); for (const n of cp.nodes || []) P.nodes.set(n.id, n); (cp.samples || []).forEach((sId, i) => { P.samples.push(sId); P.dts.push(e.args.data.timeDeltas[i]); }); }
for (const e of ev) if (e.name === "Profile") { const id = e.pid + ":" + e.id; if (prof[id]) prof[id].t = e.args.data.startTime; }
function topFns(t0, t1, label) {
  const agg = new Map();
  for (const P of Object.values(prof)) { let t = P.t; P.samples.forEach((sId, i) => { t += P.dts[i]; if (t < t0 || t >= t1) return; const n = P.nodes.get(sId); if (!n) return; const cf = n.callFrame; const key = `${cf.functionName || "(anon)"} ${String(cf.url).split("/").pop().slice(0, 28)}:${cf.lineNumber}|${pname[P.pid]?.slice(0, 20)}`; agg.set(key, (agg.get(key) || 0) + P.dts[i]); }); }
  const top = [...agg].filter(([k]) => !/^\(idle\)|^\(program\)/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 22);
  console.log(`\n---- JS self time, ${label}`); for (const [k, v] of top) if (v > 3000) console.log(`${ms(v)} ms  ${k}`);
}
for (const s of scen) { if (only && !s.includes(only)) continue; topFns(marks[s + ":start"], marks[s + ":end"], s); }
