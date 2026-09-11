import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { deflateSync } from 'node:zlib';

/**
 * Writes small, valid PNG files so the image-hash alignment signal can be exercised without any
 * real product photos and without crawling anything.
 *
 * Usage: npm run make:test-images -- [--out .local/test-images] [--count 4] [--size 320]
 *
 * image-01-copy.png is byte-identical to image-01.png on purpose: upload image-01 to one SKU and
 * image-01-copy to another, and the alignment report must treat them as the same item.
 */

const args = process.argv.slice(2);
const optionValue = (name: string): string | undefined => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};
const out = resolve(optionValue('out') ?? '.local/test-images');
const count = Math.max(1, Math.min(20, Number(optionValue('count') ?? 4) || 4));
const size = Math.max(16, Math.min(1024, Number(optionValue('size') ?? 320) || 320));

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length, 0);
  const header = Buffer.from(type, 'latin1');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([header, data])), 0);
  return Buffer.concat([length, header, data, crc]);
}
/** Minimal truecolour PNG: no dependency, deterministic bytes for a given colour and size. */
function png(rgb: [number, number, number]): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit, truecolour RGB
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    const row = y * (size * 3 + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const pixel = row + 1 + x * 3;
      raw[pixel] = (rgb[0] + x) % 256;
      raw[pixel + 1] = (rgb[1] + y) % 256;
      raw[pixel + 2] = rgb[2];
    }
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const palette: [number, number, number][] = [[32, 32, 32], [220, 220, 210], [70, 110, 150], [90, 140, 90], [150, 90, 90], [120, 100, 160], [200, 160, 60], [60, 140, 140]];
mkdirSync(out, { recursive: true });
const written: string[] = [];
for (let index = 1; index <= count; index++) {
  const file = resolve(out, `image-${String(index).padStart(2, '0')}.png`);
  writeFileSync(file, png(palette[(index - 1) % palette.length]));
  written.push(file);
}
const first = resolve(out, 'image-01.png');
const copy = resolve(out, 'image-01-copy.png');
writeFileSync(copy, readFileSync(first));

for (const file of written) console.log(`  ${file}`);
console.log(`  ${copy}  (byte-identical to image-01.png)`);
console.log(`\n${written.length + 1} PNG file(s) in ${out}`);
console.log('Upload them from Materials → a product → Source assets.');
console.log('Give image-01.png and image-01-copy.png to two different SKUs, then run: npm run align:catalog');
