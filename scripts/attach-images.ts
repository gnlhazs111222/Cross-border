import { readFileSync, statSync } from 'node:fs';
import { extname, resolve } from 'node:path';

/**
 * Uploads image files to SKUs through the running local API, so the image-hash alignment signal
 * can be tested without clicking through the UI.
 *
 * Usage:
 *   npm run attach:images -- --assign "LM-KT-BTL-001-BLK-500=.local/test-images/image-01.png" \
 *                            --assign "LM-KT-BTL-002-BLK-500=.local/test-images/image-01-copy.png"
 *
 * Start the app first (npm run dev or npm run dev:api). Nothing is written unless the API accepts
 * the upload, and the app itself keeps the file and records its sha256.
 */

const args = process.argv.slice(2);
const optionValue = (name: string): string | undefined => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};
const assignments: string[] = [];
for (let index = 0; index < args.length; index++) if (args[index] === '--assign' && args[index + 1]) assignments.push(args[index + 1]);
const base = (optionValue('base') ?? 'http://127.0.0.1:3001').replace(/\/$/, '');
const email = optionValue('email') ?? 'demo@prismlaunch.local';
const password = optionValue('password') ?? 'Demo123456';

if (!assignments.length) {
  console.error('Provide at least one --assign "SKU=path/to/image.png". Generate files first with: npm run make:test-images');
  process.exit(2);
}

const MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.pdf': 'application/pdf' };
const pairs = assignments.map(assignment => {
  const separator = assignment.indexOf('=');
  if (separator < 1) throw new Error(`Use SKU=path form, got: ${assignment}`);
  const sku = assignment.slice(0, separator).trim();
  const path = resolve(assignment.slice(separator + 1).trim());
  const mimeType = MIME[extname(path).toLowerCase()];
  if (!mimeType) throw new Error(`Unsupported file type: ${path}. Use PNG, JPEG, WebP or PDF.`);
  if (!statSync(path).isFile()) throw new Error(`Not a file: ${path}`);
  return { sku, path, mimeType, bytes: readFileSync(path) };
});

const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) })
  .catch(() => { throw new Error(`Cannot reach ${base}. Start the app first: npm run dev`); });
if (!login.ok) throw new Error(`Login failed (${login.status}). Check --email/--password.`);
const cookie = (login.headers.getSetCookie?.() ?? [login.headers.get('set-cookie') ?? '']).map(value => value.split(';')[0]).join('; ');
console.log(`\nSigned in as ${email} on ${base}`);

for (const { sku, path, mimeType, bytes } of pairs) {
  const response = await fetch(`${base}/api/products/${encodeURIComponent(sku)}/assets`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ fileName: path.split(/[\\/]/).pop(), mimeType, contentBase64: bytes.toString('base64') }),
  });
  const body = await response.json().catch(() => null) as { data?: { asset?: { sha256?: string; recordId?: string }; duplicate?: boolean }; error?: { code?: string; message?: string } } | null;
  if (!response.ok) {
    console.log(`  ✗ ${sku} — ${body?.error?.code ?? response.status}: ${body?.error?.message ?? 'upload failed'}`);
    continue;
  }
  const asset = body?.data?.asset;
  console.log(`  ${body?.data?.duplicate ? '=' : '+'} ${sku} ← ${path.split(/[\\/]/).pop()} (${(bytes.length / 1024).toFixed(0)} KB, sha256 ${asset?.sha256?.slice(0, 12) ?? '?'}${body?.data?.duplicate ? ', already stored' : ''})`);
}

console.log('\nNow run: npm run align:catalog');
