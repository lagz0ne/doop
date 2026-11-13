#!/usr/bin/env bash
# Interleaved A/B of perf/bench.mjs, medians per scenario.
# usage: perf/ab.sh <name> <A url> <B url> [runs=4]     (CHROME_PATH as for bench.mjs)
# Results: perf/out/ab-<name>.txt (every run) and a median table on stdout.
set -euo pipefail
cd "$(dirname "$0")"
name=$1 A=$2 B=$3 runs=${4:-4}
export CHROME_PATH=${CHROME_PATH:-$(ls -d ~/.cache/ms-playwright/chromium_headless_shell-*/*/chrome-headless-shell | tail -1)}
txt=out/ab-$name.txt json=out/ab-$name.jsonl; : > "$txt"; : > "$json"
for i in $(seq 1 "$runs"); do
  for side in A B; do
    url=$A; [ $side = B ] && url=$B
    echo "load $(cut -d' ' -f1-3 /proc/loadavg)" >> "$txt"
    DOOP=$url NAME="$side $i" JSON_OUT=$json node bench.mjs >> "$txt" 2>&1 || echo "run $side $i failed" >> "$txt"
  done
done
node - "$json" <<'JS'
const fs = require("fs"); const rows = fs.readFileSync(process.argv[2], "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] : NaN; };
const side = (k) => rows.filter((r) => r.name.startsWith(k));
const names = Object.keys(rows[0]?.raw || {});
console.log("scenario".padEnd(20), "main thread ms A -> B".padEnd(26), "worst frame A -> B".padEnd(22), "slow frames A -> B");
for (const n of names) { const g = (k, f) => med(side(k).map((r) => r.raw[n]?.[f]).filter((x) => x != null));
  console.log(n.padEnd(20), `${g("A", "task")} -> ${g("B", "task")}`.padEnd(26), `${g("A", "worst")} -> ${g("B", "worst")}`.padEnd(22), `${g("A", "slow")} -> ${g("B", "slow")}`); }
console.log(`runs: A ${side("A").length}, B ${side("B").length}`);
JS
