// Raster and compositing work in a trace-pinch.mjs trace, per scenario: counts and time of raster tasks, commits, layerizes and draws per process, and raster tiles per layer.
// usage: node raster.mjs <trace>
import { readFileSync } from "node:fs";
const tr = JSON.parse(readFileSync(process.argv[2], "utf8")); const ev = tr.traceEvents || tr;
const pname = {}; for (const e of ev) { if (e.ph === "M" && e.name === "process_name") pname[e.pid] = e.args.name; }
for (const e of ev) if (e.ph === "M" && e.name === "process_labels") pname[e.pid] += " [" + String(e.args.labels).slice(0, 30) + "]";
const marks = {}; for (const e of ev) if (e.cat?.includes("blink.user_timing") && /^[A-Z]\d-/.test(e.name)) marks[e.name] = e.ts;
const scen = [...new Set(Object.keys(marks).map((k) => k.split(":")[0]))].sort();
const names = new Set(["RasterTask", "ImageDecodeTask", "ImageUploadTask", "Layerize", "Paint", "UpdateLayoutTree", "Commit", "DrawFrame", "BeginMainThreadFrame", "Display::DrawAndSwap", "TileManager::PrepareTiles", "PictureLayerImpl::UpdateTiles", "RasterDecoderImpl::DoRasterCHROMIUM", "RasterDecoderImpl::DoEndRasterCHROMIUM", "ActivateLayerTree", "PictureLayerTilingSet::UpdateTilePriorities", "LayerTreeHostImpl::PrepareToDraw", "GpuRasterBuffer::Playback"]);
for (const s of scen) {
  const t0 = marks[s + ":start"], t1 = marks[s + ":end"]; console.log(`\n== ${s} (${((t1 - t0) / 1e6).toFixed(1)} s)`);
  const agg = new Map(); const layers = new Map();
  for (const e of ev) { if (e.ts < t0 || e.ts >= t1 || !names.has(e.name)) continue; if (e.ph !== "X" && e.ph !== "I" && e.ph !== "B") continue;
    const k = `${e.name} | ${pname[e.pid] || e.pid}#${e.pid}`; const a = agg.get(k) || agg.set(k, { n: 0, dur: 0 }).get(k); a.n++; a.dur += e.dur || 0;
    if (e.name === "RasterTask") { const d = e.args?.tileData || {}; const lk = `${e.pid}:${d.layerId}`; const l = layers.get(lk) || layers.set(lk, { n: 0, dur: 0, res: new Set(), frames: new Set() }).get(lk); l.n++; l.dur += e.dur || 0; l.res.add(d.tileResolution); l.frames.add(d.sourceFrameNumber); } }
  for (const [k, a] of [...agg].sort((x, y) => x[0].localeCompare(y[0]))) console.log(`  ${String(a.n).padStart(5)} × ${(a.dur / 1000).toFixed(0).padStart(6)} ms  ${k}`);
  console.log("  raster by layer:"); for (const [k, l] of [...layers].sort((x, y) => y[1].n - x[1].n).slice(0, 14)) console.log(`    layer ${k.padEnd(12)} ${String(l.n).padStart(4)} tiles ${(l.dur / 1000).toFixed(0).padStart(5)} ms  in ${l.frames.size} frames  ${[...l.res].join(",")}`);
}
