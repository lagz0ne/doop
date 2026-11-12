# perf/: render-performance harness for the doop editor

Moved here from `tmp/2026-11-11-doop-crosspage/` (the investigation that produced
patches 0001-0004). Outputs (Chrome traces, screenshots) are in `out/`, which git ignores.

## Local setup

    bin/doop apply && bin/doop serve           # patched doop on http://localhost:4477
    bin/doop base  && bin/doop serve --base    # pristine upstream on :4478, for A/B

`local.json` / `local-base.json` (ignored) hold the local perf account
(`{canvas, email, password, name}`) for those servers; `seed.py` / `stress.py` create it and
seed the 188-frame stress page from `canvas.json` (uses `../host-app/scripts/canvas`).
`base/` is the same seed for the :4478 server.

## Scripts (node, puppeteer-core from build/doop/node_modules)

| script | what |
|---|---|
| `trace.mjs <out.json> [page] [cull=on\|off]` | Chrome trace (all processes) through fixed scenarios: open, pan at fit, zoom 8→60%, pan at 60%, fit jump |
| `analyze.mjs <trace>` | CPU per process/thread, event self time, top JS functions, input latency per scenario |
| `jsprof.mjs <trace>` | source-mapped JS profile (needs `vite build --sourcemap`, which `serve` does) |
| `bench.mjs` | main-thread busy time + worst frame gap for pan / zoom / fit, per CSS variant |
| `fit.mjs`, `pancheck.mjs`, `layers.mjs`, `wake.mjs`, `oop.mjs` | single-question probes (fit stall, pan, layer count, frame wake-up, out-of-process frames on :4478) |

`final-bench.txt` is the before/after that justified patched.2. Headline (188 frames, editor
main thread): pan at fit 2260 → 245 ms, zoom 8→60% 1700 → 480-540 ms, open page
10.4 → 2.2 s renderer CPU, heap 116 → 27 MB.

## probes/

Playwright probes against **production** doop.example.com, logged in as the agent account
(`~/.config/doop/doop-claude-*`), on the host's "Big canvas" canvas. They measured the
cross-page prototype flow (`cases.json`) and gave `baseline-v0.12.0.txt`. They use the host's
playwright install (`../host-app/node_modules`). Read-only, except `layout.new.py`, which
reorganised the host's canvas pages (a reorg) and should not be re-run blindly.
