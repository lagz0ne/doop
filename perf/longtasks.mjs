// The longest main-thread tasks of the editor within a scenario, each broken down by what ran inside it.
// usage: node longtasks.mjs <trace> <scenario> [count=6]
import { readFileSync } from "node:fs";
const [file, scen, count = "6"] = process.argv.slice(2);
const tr = JSON.parse(readFileSync(file, "utf8")); const ev = tr.traceEvents || tr;
const marks = {}; for (const e of ev) if (e.cat?.includes("blink.user_timing")) marks[e.name] = e.ts;
const t0 = marks[scen + ":start"], t1 = marks[scen + ":end"]; if (!t0 || !t1) throw new Error("no marks for " + scen);
const m = ev.find((e) => e.name === scen + ":start");
const X = ev.filter((e) => e.ph === "X" && e.pid === m.pid && e.tid === m.tid && e.ts >= t0 && e.ts <= t1).sort((a, b) => a.ts - b.ts || b.dur - a.dur);
const tasks = X.filter((e) => e.name === "RunTask" || e.name === "ThreadControllerImpl::RunTask").sort((a, b) => b.dur - a.dur).slice(0, Number(count));
for (const t of tasks) {
  const inside = X.filter((e) => e !== t && e.ts >= t.ts && e.ts + e.dur <= t.ts + t.dur);
  // self time by name (stack-based)
  const self = new Map(); const st = [];
  for (const e of inside) { while (st.length && st[st.length - 1].end <= e.ts) st.pop(); if (st.length) st[st.length - 1].child += e.dur; const n = { e, end: e.ts + e.dur, child: 0 }; st.push(n); e._n = n; }
  for (const e of inside) { const s = e.dur - Math.min(e.dur, e._n.child); self.set(e.name, (self.get(e.name) || 0) + s); }
  const top = [...self].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([n, d]) => `${n} ${(d / 1000).toFixed(0)}`).join(" · ");
  console.log(`${(t.dur / 1000).toFixed(0).padStart(5)} ms at +${((t.ts - t0) / 1000).toFixed(0)} ms: ${top}`);
}
