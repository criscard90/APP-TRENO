// Genera le icone Android da icons/icon.svg per ogni densità richiesta.
// Viene eseguito dal workflow GitHub Actions dopo "npx cap add android".
// Dipendenza: sharp (installata dal workflow).

import sharp from 'sharp';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SVG = path.join(ROOT, 'icons', 'icon.svg');
const OUT = path.join(ROOT, 'android', 'app', 'src', 'main', 'res');

const ICONS = [
  { dir: 'mipmap-mdpi', size: 48 },
  { dir: 'mipmap-hdpi', size: 72 },
  { dir: 'mipmap-xhdpi', size: 96 },
  { dir: 'mipmap-xxhdpi', size: 144 },
  { dir: 'mipmap-xxxhdpi', size: 192 }
];

async function main() {
  if (!fs.existsSync(SVG)) {
    console.error('Icona SVG non trovata:', SVG);
    process.exit(1);
  }

  const svgBuffer = fs.readFileSync(SVG);

  for (const { dir, size } of ICONS) {
    const destDir = path.join(OUT, dir);
    fs.mkdirSync(destDir, { recursive: true });
    const dest = path.join(destDir, 'ic_launcher.png');
    await sharp(svgBuffer)
      .resize(size, size)
      .png()
      .toFile(dest);
    console.log('OK', path.relative(ROOT, dest), size + 'x' + size);
  }

  console.log('Icone Android generate con successo.');
}

main().catch((err) => {
  console.error('Errore generazione icone:', err);
  process.exit(1);
});
