// crop a region of a screenshot (original px) and optionally upscale: node crop.mjs in out x y w h [scale]
import { createRequire } from "node:module";
const sharp = createRequire(new URL("../build/doop/package.json", import.meta.url))("sharp");
const [i, o, x, y, w, h, s = "1"] = process.argv.slice(2);
await sharp(i).extract({ left: +x, top: +y, width: +w, height: +h }).resize({ width: Math.round(+w * +s), kernel: "nearest" }).toFile(o);
