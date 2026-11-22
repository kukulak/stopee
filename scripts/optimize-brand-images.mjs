// Convierte los PNG de public/elementos-design a WebP (con transparencia) y
// los deja junto al original. Uso: npm run optimize:images
import sharp from "sharp";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";

const DIR = path.join(process.cwd(), "public", "elementos-design");
const MAX_WIDTH = 1600; // los remolinos se muestran a ~800 px; 1600 cubre pantallas retina

for (const file of await readdir(DIR)) {
  if (!file.endsWith(".png") || file.startsWith("._")) continue;
  const input = path.join(DIR, file);
  const output = input.replace(/\.png$/, ".webp");
  const info = await sharp(input)
    .resize({ width: MAX_WIDTH, withoutEnlargement: true })
    .webp({ quality: 85, alphaQuality: 100, effort: 6 })
    .toFile(output);
  const before = (await stat(input)).size;
  console.log(`${file}: ${(before / 1024).toFixed(0)} KB -> ${(info.size / 1024).toFixed(0)} KB (${info.width}x${info.height})`);
}
