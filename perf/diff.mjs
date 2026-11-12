// How far is a screenshot from a reference one? Mean absolute pixel difference and edge energy
// (mean gradient: sharpness) over a region. usage: node diff.mjs <ref.png> <x> <y> <w> <h> <shot.png>...
import { createRequire } from "node:module";
const sharp = createRequire(new URL("../build/doop/package.json", import.meta.url))("sharp");
const [ref, x, y, w, h, ...shots] = process.argv.slice(2);
const grey = async (f) => (await sharp(f).extract({ left: +x, top: +y, width: +w, height: +h }).greyscale().raw().toBuffer());
const edges = (d) => { let s = 0; for (let j = 0; j < +h - 1; j++) for (let i = 0; i < +w - 1; i++) { const k = j * +w + i; s += Math.abs(d[k] - d[k + 1]) + Math.abs(d[k] - d[k + +w]); } return s / d.length; };
const r = await grey(ref);
console.log("reference".padEnd(34), "edge energy", edges(r).toFixed(2));
for (const f of shots) { const d = await grey(f); let s = 0, big = 0; for (let i = 0; i < d.length; i++) { const e = Math.abs(d[i] - r[i]); s += e; if (e > 32) big++; } console.log(f.split("/").pop().padEnd(34), "edge energy", edges(d).toFixed(2), " mean |diff|", (s / d.length).toFixed(2), " px off by >32:", (100 * big / d.length).toFixed(2) + "%"); }
