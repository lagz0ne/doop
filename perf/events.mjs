// Occurrences of one timeline event on the editor's main thread within a scenario: how many, how long, element counts.
// usage: node events.mjs <trace> <scenario> <EventName> [EventName...]
import { readFileSync } from "node:fs";
const [file, scen, ...names] = process.argv.slice(2);
const tr = JSON.parse(readFileSync(file, "utf8")); const ev = tr.traceEvents || tr;
const marks = {}; for (const e of ev) if (e.cat?.includes("blink.user_timing")) marks[e.name] = e.ts;
const t0 = marks[scen + ":start"], t1 = marks[scen + ":end"]; if (!t0 || !t1) throw new Error("no marks for " + scen);
// the editor's main thread: the renderer thread that carries the marks
const m = ev.find((e) => e.name === scen + ":start"); const key = (e) => e.pid === m.pid && e.tid === m.tid;
const X = ev.filter((e) => e.ph === "X" && key(e) && e.ts >= t0 && e.ts <= t1);
for (const n of names) {
  const es = X.filter((e) => e.name === n); const d = es.map((e) => e.dur / 1000).sort((a, b) => b - a);
  const inJs = es.filter((e) => X.some((f) => (f.name === "FunctionCall" || f.name === "EvaluateScript" || f.name === "v8.callFunction") && f.ts <= e.ts && f.ts + f.dur >= e.ts + e.dur));
  const els = es.map((e) => e.args?.elementCount ?? e.args?.beginData?.dirtyObjects).filter((x) => x != null);
  console.log(`${n}: ${es.length} events, ${d.reduce((a, b) => a + b, 0).toFixed(0)} ms total, top ${d.slice(0, 6).map((x) => x.toFixed(0)).join(" ")} ms; ${inJs.length} forced from script (${inJs.reduce((a, e) => a + e.dur / 1000, 0).toFixed(0)} ms)` + (els.length ? `; elements per event: median ${els.sort((a, b) => a - b)[els.length >> 1]}, max ${Math.max(...els)}` : ""));
}
