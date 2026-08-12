import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

/*
 * Writes the PNG icons the install prompt needs, from the SVG beside them.
 *
 * A script rather than committed binaries: the SVG is the source, and a PNG
 * that has drifted from it is worse than no PNG at all. Run by `pnpm build`.
 */
const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(here, '../public/icon.svg');
const out = process.env.ICON_OUTPUT_DIR
  ? resolve(process.env.ICON_OUTPUT_DIR)
  : resolve(here, '../public');

mkdirSync(out, { recursive: true });

// 192 and 512 are what the manifest asks for. The maskable one is padded,
// because a platform that crops to a circle would otherwise cut the bars off.
await Promise.all([
  sharp(source).resize(192, 192).png().toFile(resolve(out, 'icon-192.png')),
  sharp(source).resize(512, 512).png().toFile(resolve(out, 'icon-512.png')),
  sharp(source)
    .resize(410, 410)
    .extend({ top: 51, bottom: 51, left: 51, right: 51, background: '#12161c' })
    .png()
    .toFile(resolve(out, 'icon-maskable-512.png')),
]);

console.log('icons written');
