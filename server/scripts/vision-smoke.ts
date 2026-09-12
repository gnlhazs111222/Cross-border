import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { readConfig } from '../config';
import { BailianTextModelProvider } from '../providers/text';
import { QwenImageCheckProvider } from '../providers/multimodal';
import type { ImageCheckRequest } from '../providers/multimodal';
import type { Fact, Product, Task } from '../../src/types';

/**
 * Calls the configured vision model once with a small picture, to check that BAILIAN_VL_MODEL names a
 * model this endpoint actually serves. It first asks GET /models what is on offer, then runs every
 * candidate through the real QwenImageCheckProvider code path.
 *
 * Watch out: names containing "image" (qwen-image-2.0, wan2.7-image) are picture *generation* models.
 * They answer a chat request carrying a picture with HTTP 400 ("Either text or image must be provided,
 * but not both"), so they can never read printed text. On this endpoint the vision models are the
 * general qwen3.x ones, and the picture must be larger than 10 px on both sides.
 *
 * Usage: npm run ai:vision-smoke -- --live [--write] [--models a,b,c]
 *
 * --live            required; without it nothing is called
 * --models a,b,c    try exactly these names instead of the built-in list
 * --write           also stores the winning model in .env as BAILIAN_VL_MODEL
 *
 * At most one completion per candidate, retries disabled, no audit rows written: this is a
 * configuration check, not a business run. It never prints the key, request bodies or raw responses.
 */
if (!process.argv.includes('--live')) {
  console.log('Dry run: no model was called.');
  console.log('Run "npm run ai:vision-smoke -- --live" to test candidates; add --write to store the winner in .env.');
  process.exit(0);
}
const write = process.argv.includes('--write');
const config = readConfig();
if (!config.AI_LIVE_ENABLED || !config.BAILIAN_API_KEY) {
  console.error(config.AI_LIVE_ENABLED ? 'bailian_not_configured: BAILIAN_API_KEY is empty.' : 'live_ai_disabled: set AI_LIVE_ENABLED=true in .env.');
  process.exit(1);
}

/**
 * Vision candidates, strongest first: these qwen3.x models accept a picture and answer with JSON.
 * qwen3.8-max is left out on purpose — the premium guard refuses it outside premium mode, so it can
 * never be the vision reader without weakening that guard.
 */
const CANDIDATES = ['qwen3.7-plus', 'qwen3.6-plus', 'qwen3.8-flash', 'qwen3.6-flash'];

/** "--models a,b" or "--models=a,b" wins over the built-in list, so any console name can be tested as-is. */
const modelsArg = process.argv.findIndex(arg => arg === '--models' || arg.startsWith('--models='));
const requested = modelsArg < 0 ? [] : (process.argv[modelsArg].includes('=')
  ? process.argv[modelsArg].slice(process.argv[modelsArg].indexOf('=') + 1)
  : process.argv[modelsArg + 1] ?? '').split(',').map(name => name.trim()).filter(Boolean);

/**
 * Every id the endpoint advertises, so a model that is missing from the plan is visible instead of
 * guessed at. The full list lands in .local/vision-smoke-models.json for inspection. The vision
 * candidates are the general qwen3.x models: this endpoint serves no separate -vl model.
 */
async function servedModels(): Promise<string[]> {
  try {
    const response = await fetch(`${config.BAILIAN_BASE_URL}/models`, { headers: { authorization: `Bearer ${config.BAILIAN_API_KEY}` } });
    if (!response.ok) { console.log(`GET /models returned ${response.status}; using the built-in candidate list.`); return []; }
    const body = await response.json() as { data?: { id?: unknown }[] };
    const ids = (body.data ?? []).map(row => String(row.id ?? '')).filter(Boolean);
    mkdirSync('.local', { recursive: true });
    writeFileSync('.local/vision-smoke-models.json', JSON.stringify({ timestamp: new Date().toISOString(), count: ids.length, ids }, null, 2));
    console.log(`The endpoint advertises ${ids.length} model(s); full list written to .local/vision-smoke-models.json:`);
    for (const id of ids) console.log(`  ${id}`);
    return ids.filter(id => /vl|vision|omni/i.test(id) || /^qwen3\./i.test(id));
  } catch (error) {
    console.log(`GET /models is not reachable (${error instanceof Error ? error.name : 'error'}); using the built-in candidate list.`);
    return [];
  }
}

/**
 * The probe picture is built here, not pasted in as base64: the endpoint refuses anything 10 px or
 * smaller ("height:1 or width:1 must be larger than 10"), and a hand-copied blob is one wrong
 * character away from "The image format is illegal and cannot be opened".
 */
function probePng(): { base64: string; bytes: number } {
  const width = 64; const height = 64;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 3 + 1); raw[row] = 0;
    for (let x = 0; x < width; x += 1) { const at = row + 1 + x * 3; raw[at] = x < 32 ? 200 : 40; raw[at + 1] = y < 32 ? 80 : 180; raw[at + 2] = 120; }
  }
  const crc = (buffer: Buffer) => { let value = ~0; for (const byte of buffer) { value ^= byte; for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (0xEDB88320 & -(value & 1)); } return ~value >>> 0; };
  const chunk = (type: string, data: Buffer) => { const length = Buffer.alloc(4); length.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type, 'ascii'), data]); const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body)); return Buffer.concat([length, body, sum]); };
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  return { base64: png.toString('base64'), bytes: png.length };
}
const PROBE = probePng();
const product: Product = { sku: 'SMOKE-VISION-1', name: 'Smoke test bottle', category: 'Drinkware', color: 'Black', capacity: 500,
  localizedCapacity: '17 oz', material: 'Unknown', straw: false, countryOfOrigin: 'Unknown', status: 'search_ready', duplicateStatus: 'unique',
  supplierCost: 0, missing: [], visual: 'bottle' };
const task: Task = { id: 'smoke-vision', platform: 'amazon', market: 'US', category: 'Drinkware', requirements: [], minProfit: 0 };
const facts: Fact[] = [
  { key: 'color', label: 'Color', value: 'Black', source: 'smoke check', anchor: 'smoke check', status: 'Confirmed', allowed: true, sourceKind: 'supplier' },
  { key: 'capacity', label: 'Capacity', value: '500 ml', source: 'smoke check', anchor: 'smoke check', status: 'Confirmed', allowed: true, sourceKind: 'supplier' },
];
const request: ImageCheckRequest = { product, task, facts,
  images: [{ asset: { recordId: 'smoke', sku: product.sku, kind: 'image', role: 'main', fileName: 'smoke.png', mimeType: 'image/png',
    byteSize: PROBE.bytes, sha256: 'smoke', parseStatus: 'pending', uploadedAt: new Date().toISOString() }, mimeType: 'image/png', dataUrl: `data:image/png;base64,${PROBE.base64}` }],
  assets: [{ assetId: 'smoke', fileName: 'smoke.png', role: 'main', mimeType: 'image/png', byteSize: PROBE.bytes, sha256: 'smoke', status: 'checked' }],
  notes: [] };

const discovered = await servedModels();
const pool = requested.length ? requested : [...discovered, ...CANDIDATES].filter((model, index, all) => all.indexOf(model) === index);
const candidates = pool.slice(0, 12);
console.log(`Trying ${candidates.length} candidate model(s), one call each, retries disabled: ${candidates.join(', ')}`);
const attempts: { model: string; ok: boolean; reason?: string; findings?: number; latencyMs?: number }[] = [];
const started = Date.now();
for (const model of candidates) {
  const text = new BailianTextModelProvider({ ...config, BAILIAN_VL_MODEL: model, AI_MAX_LIVE_CALLS_PER_SESSION: 1 }, async () => null);
  const outcome = await new QwenImageCheckProvider(text, { model, maxTokens: 600 }).analyze(request);
  const ok = !outcome.fallbackReason;
  attempts.push({ model, ok, reason: outcome.fallbackReason, findings: outcome.findings.length, latencyMs: outcome.latencyMs });
  console.log(ok ? `- ${model}: ok, ${outcome.findings.length} finding(s), ${outcome.latencyMs ?? 0} ms` : `- ${model}: failed (${outcome.fallbackReason})`);
  if (ok) break;
}
mkdirSync('.local', { recursive: true });
writeFileSync('.local/vision-smoke-last.json', JSON.stringify({ timestamp: new Date().toISOString(), baseURL: config.BAILIAN_BASE_URL, elapsedMs: Date.now() - started, attempts }, null, 2));
console.log('\nWrote .local/vision-smoke-last.json');
const winner = attempts.find(attempt => attempt.ok);
if (!winner) {
  console.error('No candidate answered. Check the key, the quota and model access on this endpoint, then try --models with a name from the console.');
  process.exit(1);
}
console.log(`\nWorking model: ${winner.model}`);
console.log('Put this in .env:');
console.log(`BAILIAN_VL_MODEL=${winner.model}`);
console.log('MULTIMODAL_PROVIDER=qwen');
console.log('AI_LIVE_ENABLED=true');
if (write) {
  const line = `BAILIAN_VL_MODEL=${winner.model}`;
  const current = existsSync('.env') ? readFileSync('.env', 'utf8') : '';
  const next = /^BAILIAN_VL_MODEL=.*$/m.test(current) ? current.replace(/^BAILIAN_VL_MODEL=.*$/m, line)
    : `${current}${current && !current.endsWith('\n') ? '\n' : ''}${line}\n`;
  writeFileSync('.env', next);
  console.log(`Updated .env: ${line}`);
}