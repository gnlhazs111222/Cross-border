import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { deflateSync } from 'node:zlib';

/**
 * Product pictures for the dangerous-goods sample rows in
 * `evaluation/asset-import-sample/危险品运输属性样本.csv`.
 *
 * The picture is the same illustration the product pool shows: the bottle from `ProductVisual`
 * (src/components/ui.tsx) is rasterised here from its own path data, on the same card background,
 * with the colour taken from the same `colorHex` map. Nothing is drawn "in the style of" the pool —
 * it is the pool drawing, at full size.
 *
 * Every picture is then wrong on purpose, because the multimodal module has to have something to catch:
 * - each one prints wording the row contradicts (a capacity the product does not have, a country we do
 *   not import from), so the printed-text check must come back `differ`;
 * - HAZ-001 is drawn pink with a straw while the row declares Black and no straw, HAZ-005 is drawn
 *   blue while the row declares White: the picture is visibly the wrong product;
 * - each one carries an exaggerated marketing slogan (KEEPS HOT 72H, BPA FREE, AEROSOL FREE,
 *   NON-FLAMMABLE, HAND PAINTED). Those are exactly the claims the module must never turn into a fact.
 *
 * Usage:
 *   npm run make:hazmat-images
 *   npm run make:hazmat-images -- [--out evaluation/asset-import-sample/hazmat-images] [--size 1024]
 */

const args = process.argv.slice(2);
const optionValue = (name: string): string | undefined => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};
const out = resolve(optionValue('out') ?? 'evaluation/asset-import-sample/hazmat-images');
const size = Math.max(320, Math.min(1600, Number(optionValue('size') ?? 1024) || 1024));

/** The product-pool drawing, copied from src/components/ui.tsx · ProductVisual (viewBox 0 0 100 140). */
const POOL_ART = {
  shadow: { cx: 50, cy: 126, rx: 26, ry: 5, fill: '#d7dfd9' },
  cap: { x: 35, y: 13, width: 30, height: 19, radius: 5 },
  body: 'M35 28h30v9c0 5 10 9 10 21v56c0 9-5 13-13 13H38c-8 0-13-4-13-13V58c0-12 10-16 10-21v-9Z',
  highlight: 'M34 57v53c0 5 1 7 4 8',
  bands: 'M37 23h26M36 29h28',
  mark: 'm46 91 4-7 4 7h-8Z',
  straw: 'M51 14V3h12',
  /** Same card the pool thumbnail sits on (.product-visual in src/styles.css). */
  card: '#f1f4ee',
  strawStroke: '#58635b',
};
/** Same palette the pool uses (colorHex in src/components/presentation.ts). */
const COLOR_HEX: Record<string, string> = {
  black: '#303737', white: '#f2f2ef', ivory: '#ddd8ce', pink: '#e3a7b4', blue: '#4a7fb5', sage: '#8b9c89',
};
const markColor = (body: string) => (body === COLOR_HEX.black ? '#a9b6ad' : '#6d776e');

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

type Rgb = readonly [number, number, number];
const canvas = Buffer.alloc(size * size * 3);
const rgbCache = new Map<string, Rgb>();
const rgb = (hex: string): Rgb => {
  const cached = rgbCache.get(hex);
  if (cached) return cached;
  const value: Rgb = [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
  rgbCache.set(hex, value);
  return value;
};
const blend = (x: number, y: number, hex: string, alpha = 1) => {
  if (x < 0 || y < 0 || x >= size || y >= size) return;
  const colour = rgb(hex);
  const at = (y * size + x) * 3;
  canvas[at] = Math.round(canvas[at] * (1 - alpha) + colour[0] * alpha);
  canvas[at + 1] = Math.round(canvas[at + 1] * (1 - alpha) + colour[1] * alpha);
  canvas[at + 2] = Math.round(canvas[at + 2] * (1 - alpha) + colour[2] * alpha);
};
const fillAll = (hex: string) => { for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) blend(x, y, hex); };
const fillRect = (x: number, y: number, width: number, height: number, hex: string, alpha = 1) => {
  for (let row = Math.round(y); row < Math.round(y + height); row++) for (let column = Math.round(x); column < Math.round(x + width); column++) blend(column, row, hex, alpha);
};
const fillEllipse = (cx: number, cy: number, rx: number, ry: number, hex: string) => {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
    const dx = (x - cx) / rx, dy = (y - cy) / ry;
    if (dx * dx + dy * dy <= 1) blend(x, y, hex);
  }
};

type Point = { x: number; y: number };
/** Flattens the SVG path subset the pool art uses (M L H V C Z, absolute and relative). */
function parsePath(path: string): Point[][] {
  const tokens = path.match(/[MmLlHhVvCcZz]|-?\d*\.?\d+/g) ?? [];
  const subpaths: Point[][] = [];
  let points: Point[] = [];
  let current = { x: 0, y: 0 };
  let start = { x: 0, y: 0 };
  let command = '';
  let index = 0;
  const number = () => Number(tokens[index++]);
  const line = (x: number, y: number) => { points.push({ x, y }); current = { x, y }; };
  const curve = (x1: number, y1: number, x2: number, y2: number, x3: number, y3: number) => {
    for (let step = 1; step <= 24; step++) {
      const t = step / 24, u = 1 - t;
      line(u * u * u * current.x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
           u * u * u * current.y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3);
    }
  };
  while (index < tokens.length) {
    const token = tokens[index];
    if (/[A-Za-z]/.test(token)) { command = token; index++; }
    else if (command === 'M') command = 'L';
    else if (command === 'm') command = 'l';
    switch (command) {
      case 'M': { const x = number(), y = number(); if (points.length > 1) subpaths.push(points); points = []; start = { x, y }; line(x, y); break; }
      case 'm': { const x = current.x + number(), y = current.y + number(); if (points.length > 1) subpaths.push(points); points = []; start = { x, y }; line(x, y); break; }
      case 'L': line(number(), number()); break;
      case 'l': line(current.x + number(), current.y + number()); break;
      case 'H': line(number(), current.y); break;
      case 'h': line(current.x + number(), current.y); break;
      case 'V': line(current.x, number()); break;
      case 'v': line(current.x, current.y + number()); break;
      case 'C': { const x1 = number(), y1 = number(), x2 = number(), y2 = number(), x3 = number(), y3 = number(); curve(x1, y1, x2, y2, x3, y3); break; }
      case 'c': { const x1 = current.x + number(), y1 = current.y + number(), x2 = current.x + number(), y2 = current.y + number(), x3 = current.x + number(), y3 = current.y + number(); curve(x1, y1, x2, y2, x3, y3); break; }
      case 'Z': case 'z': { if (points.length > 1) { line(start.x, start.y); subpaths.push(points); } points = []; break; }
      default: index++;
    }
  }
  if (points.length > 1) subpaths.push(points);
  return subpaths;
}
/** Even-odd scanline fill: the pool art has no holes, so this stays simple and exact enough. */
const fillPolygon = (polygon: Point[], hex: string, alpha = 1) => {
  let minY = Infinity, maxY = -Infinity;
  for (const point of polygon) { minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y); }
  for (let y = Math.max(0, Math.floor(minY)); y <= Math.min(size - 1, Math.ceil(maxY)); y++) {
    const crossings: number[] = [];
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i], b = polygon[(i + 1) % polygon.length];
      if ((a.y <= y + 0.5 && b.y > y + 0.5) || (b.y <= y + 0.5 && a.y > y + 0.5)) crossings.push(a.x + (y + 0.5 - a.y) / (b.y - a.y) * (b.x - a.x));
    }
    crossings.sort((left, right) => left - right);
    for (let i = 0; i + 1 < crossings.length; i += 2) {
      const from = Math.max(0, Math.round(crossings[i])), to = Math.min(size - 1, Math.round(crossings[i + 1]));
      for (let x = from; x <= to; x++) blend(x, y, hex, alpha);
    }
  }
};
/** Round-capped thick line, the only stroke style the pool art uses. */
const strokeLine = (points: Point[], thickness: number, hex: string, alpha = 1) => {
  const radius = thickness / 2;
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i], b = points[i + 1];
    const minX = Math.max(0, Math.floor(Math.min(a.x, b.x) - radius)), maxX = Math.min(size - 1, Math.ceil(Math.max(a.x, b.x) + radius));
    const minY = Math.max(0, Math.floor(Math.min(a.y, b.y) - radius)), maxY = Math.min(size - 1, Math.ceil(Math.max(a.y, b.y) + radius));
    const dx = b.x - a.x, dy = b.y - a.y, lengthSquared = dx * dx + dy * dy || 1;
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / lengthSquared));
      const ox = x - (a.x + t * dx), oy = y - (a.y + t * dy);
      if (ox * ox + oy * oy <= radius * radius) blend(x, y, hex, alpha);
    }
  }
};

/** 5x7 uppercase bitmap font: enough for the printed marks without pulling in a font dependency. */
const GLYPHS: Record<string, string[]> = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.####', '#....', '#....', '#....', '#....', '#....', '.####'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.###.', '#...#', '#....', '#..##', '#...#', '#...#', '.###.'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'],
  J: ['....#', '....#', '....#', '....#', '#...#', '#...#', '.###.'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#...#', '#...#', '#...#', '#...#'],
  N: ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'],
  X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  '0': ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  '2': ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  '3': ['####.', '....#', '....#', '.###.', '....#', '....#', '####.'],
  '4': ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  '5': ['#####', '#....', '#....', '####.', '....#', '#...#', '.###.'],
  '6': ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'],
  '7': ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  '9': ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '.##..'],
  ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
  '-': ['.....', '.....', '.....', '#####', '.....', '.....', '.....'],
  '.': ['.....', '.....', '.....', '.....', '.....', '..##.', '..##.'],
};
const textWidth = (text: string, scale: number) => text.length * 6 * scale - scale;
/** One scale for a whole plate, so a label never mixes glyph sizes. */
const plateScale = (lines: string[], maxWidth: number) =>
  Math.max(1, Math.min(...lines.map(line => Math.floor((maxWidth + 1) / (line.length * 6)))));
const drawText = (text: string, centreX: number, top: number, scale: number, hex: string) => {
  let x = Math.round(centreX - textWidth(text, scale) / 2);
  for (const character of text) {
    const rows = GLYPHS[character] ?? GLYPHS['-'];
    for (let row = 0; row < 7; row++) for (let column = 0; column < 5; column++) {
      if (rows[row][column] === '#') fillRect(x + column * scale, top + row * scale, scale, scale, hex);
    }
    x += 6 * scale;
  }
};

type Shot = {
  file: string; sku: string; declares: string; colourKey: keyof typeof COLOR_HEX; straw: boolean;
  printed: string[]; slogan: string; sticker: string; stickerText: string; note: string;
};

const SHOTS: Shot[] = [
  { file: 'haz-001-battery-cup-pink-straw-wrong-capacity-country.png', sku: 'HAZ-001',
    colourKey: 'pink', straw: true, declares: '500 ml · Stainless Steel · Black · 中国 · hasStraw=false · battery',
    printed: ['750 ML', 'MADE IN JAPAN'], slogan: 'KEEPS HOT 72H', sticker: '#b5524c', stickerText: '#fff4f0',
    note: 'drawn pink with a straw while the row declares Black and no straw; prints 750 ML (row says 500) and MADE IN JAPAN (row says 中国); 72H keeps-hot is a performance claim that must never become a fact' },
  { file: 'haz-002-magnetic-cup-wrong-capacity.png', sku: 'HAZ-002',
    colourKey: 'black', straw: false, declares: '500 ml · Stainless Steel · Black · 中国 · magnetic',
    printed: ['800 ML'], slogan: 'BPA FREE', sticker: '#3f7d5c', stickerText: '#f2fff8',
    note: 'prints 800 ML (row says 500); BPA FREE is a safety claim the pictures may only quote, never establish' },
  { file: 'haz-003-spray-set-wrong-colour-and-capacity.png', sku: 'HAZ-003',
    colourKey: 'black', straw: false, declares: '500 ml · Stainless Steel · Ivory · 中国 · liquid + aerosol',
    printed: ['1000 ML'], slogan: 'AEROSOL FREE', sticker: '#d9a63c', stickerText: '#3a2f10',
    note: 'drawn black while the row declares Ivory, and prints 1000 ML (row says 500); AEROSOL FREE contradicts the declared aerosol row without changing it' },
  { file: 'haz-004-alcohol-cup-non-flammable-claim.png', sku: 'HAZ-004',
    colourKey: 'black', straw: false, declares: '500 ml · Stainless Steel · Black · 中国 · liquid + flammable',
    printed: ['750 ML'], slogan: 'NON-FLAMMABLE', sticker: '#d07a30', stickerText: '#2a1a08',
    note: 'prints 750 ML (row says 500) and shouts NON-FLAMMABLE while the row declares a flammable liquid: this is a forbidden row and no picture may talk it out of that' },
  { file: 'haz-005-ceramic-mug-wrong-colour-and-capacity.png', sku: 'HAZ-005',
    colourKey: 'blue', straw: false, declares: '350 ml · Ceramic · White · 中国 · fragile',
    printed: ['500 ML', 'MADE IN CHINA'], slogan: 'HAND PAINTED', sticker: '#5f8f66', stickerText: '#f4fff6',
    note: 'drawn blue while the row declares White ceramic, and prints 500 ML (row says 350); MADE IN CHINA does agree with 中国, so one field should come back agreeing' },
];

const png = (): Buffer => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit truecolour RGB
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    const row = y * (size * 3 + 1);
    raw[row] = 0; // filter: none
    canvas.copy(raw, row + 1, y * size * 3, (y + 1) * size * 3);
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
};

mkdirSync(out, { recursive: true });
const written: string[] = [];
for (const shot of SHOTS) {
  const body = COLOR_HEX[shot.colourKey];
  fillAll(POOL_ART.card);

  // The pool art, scaled up: viewBox 0 0 100 140, drawn to 88% of the frame height and centred.
  const unit = (size * 0.80) / 140;
  const originX = size / 2 - 50 * unit, originY = (size - 140 * unit) / 2;
  const tx = (x: number) => originX + x * unit, ty = (y: number) => originY + y * unit;
  const move = (subpath: Point[]): Point[] => subpath.map(point => ({ x: tx(point.x), y: ty(point.y) }));

  fillEllipse(tx(POOL_ART.shadow.cx), ty(POOL_ART.shadow.cy), POOL_ART.shadow.rx * unit, POOL_ART.shadow.ry * unit, POOL_ART.shadow.fill);
  if (shot.straw) strokeLine(move(parsePath(POOL_ART.straw)[0]), 4 * unit, POOL_ART.strawStroke);
  fillRect(tx(POOL_ART.cap.x), ty(POOL_ART.cap.y), POOL_ART.cap.width * unit, POOL_ART.cap.height * unit, body);
  for (const subpath of parsePath(POOL_ART.body)) fillPolygon(move(subpath), body);
  strokeLine(move(parsePath(POOL_ART.highlight)[0]), 3 * unit, '#ffffff', 0.15);
  for (const subpath of parsePath(POOL_ART.bands)) {
    const points = move(subpath);
    strokeLine(points, 1.2 * unit, '#ffffff', 0.14);
  }

  // The printed marks the check has to compare, written where a bottle would print them.
  const bodyLeft = tx(25), bodyWidth = 50 * unit;
  const textScale = Math.min(5, plateScale(shot.printed, bodyWidth * 0.96));
  const lineHeight = 9 * textScale;
  const textColour = shot.colourKey === 'black' ? '#f4f6f2' : '#414f46';
  let top = ty(60);
  for (const line of shot.printed) { drawText(line, tx(50), top, textScale, textColour); top += lineHeight; }
  // The pool's own little mark stays where the pool puts it, below the printed wording.
  for (const subpath of parsePath(POOL_ART.mark)) strokeLine(move(subpath), 1.2 * unit, markColor(body));

  // The exaggerated slogan, on a promo sticker in the corner e-commerce photos carry them at.
  const sloganScale = Math.min(7, plateScale([shot.slogan], size * 0.62));
  const padding = 2 * sloganScale;
  const stickerWidth = textWidth(shot.slogan, sloganScale) + padding * 2, stickerHeight = 7 * sloganScale + padding * 2;
  const stickerX = Math.round(size * 0.045), stickerY = Math.round(size - stickerHeight - size * 0.045);
  fillRect(stickerX, stickerY, stickerWidth, stickerHeight, shot.sticker);
  drawText(shot.slogan, stickerX + stickerWidth / 2, stickerY + padding, sloganScale, shot.stickerText);

  const bytes = png();
  writeFileSync(resolve(out, shot.file), bytes);
  written.push(resolve(out, shot.file));
  console.log(`  ${shot.sku}  ${shot.file}  ${(bytes.length / 1024).toFixed(0)} KB  (${shot.colourKey}${shot.straw ? ' + straw' : ''})`);
}

console.log(`\n${written.length} PNG file(s) in ${out}`);
console.log('Product-pool drawing (src/components/ui.tsx · ProductVisual) on the pool card background, with the marks made deliberately wrong:');
for (const shot of SHOTS) console.log(`  ${shot.sku}  declares ${shot.declares}\n        ${shot.note}`);
console.log('\nUpload one to each SKU after importing the sample rows:');
console.log('  npm run attach:images -- ' + SHOTS.map(shot => `--assign "${shot.sku}=${resolve(out, shot.file)}"`).join(' \\\n                            '));
console.log('\nThen: Evidence & Facts → Analyze Evidence, and look at the Picture text check column.');