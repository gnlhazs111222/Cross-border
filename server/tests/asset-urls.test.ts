import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { readConfig } from '../config';
import { downloadAssetUrls } from '../services/asset-urls';

/** A local stand-in for an image host, so the whole channel is tested without touching the internet. */

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
let server: Server; let origin = '';

const fixtureConfig = (overrides: Record<string, string> = {}) => readConfig({ NODE_ENV: 'test',
  ASSET_URL_ALLOWED_HOSTS: '127.0.0.1', ASSET_URL_ALLOW_LOOPBACK: 'true', ASSET_URL_MAX_BYTES: '4096', ASSET_URL_TIMEOUT_MS: '1000', ...overrides });

before(async () => {
  server = createServer((request, response) => {
    const url = request.url ?? '/';
    if (url === '/image.png') { response.writeHead(200, { 'content-type': 'image/png' }); response.end(PNG); return; }
    if (url === '/big.png') { response.writeHead(200, { 'content-type': 'image/png' }); response.end(Buffer.concat([PNG.subarray(0, 8), Buffer.alloc(9000)])); return; }
    if (url === '/notes.txt') { response.writeHead(200, { 'content-type': 'text/plain' }); response.end('not an asset'); return; }
    if (url === '/slow.png') { return; }
    if (url === '/redirect-away.png') { response.writeHead(302, { location: 'https://evil.test/x.png' }); response.end(); return; }
    if (url === '/redirect-ok.png') { response.writeHead(302, { location: '/image.png' }); response.end(); return; }
    if (url === '/missing.png') { response.writeHead(404); response.end(); return; }
    response.writeHead(404); response.end();
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  origin = typeof address === 'object' && address ? `http://127.0.0.1:${address.port}` : '';
});
after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });

test('a valid image is downloaded and its real type is sniffed from the bytes', async () => {
  const [result] = await downloadAssetUrls(fixtureConfig(), [`${origin}/image.png`]);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.mimeType, 'image/png');
    assert.ok(result.bytes.equals(PNG));
    assert.ok(result.fileName.endsWith('.png'));
  }
});

test('a redirect to an allowed host is followed, a redirect away from it is refused', async () => {
  const [allowed, blocked] = await downloadAssetUrls(fixtureConfig(), [`${origin}/redirect-ok.png`, `${origin}/redirect-away.png`]);
  assert.equal(allowed.ok, true, 'the hop-by-hop check lets an allowed redirect through');
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.equal(blocked.reason, 'host_not_allowed', 'the second hop is validated again');
});

test('size, type, status and timeout failures are reported instead of stored', async () => {
  const config = fixtureConfig();
  const [big] = await downloadAssetUrls(config, [`${origin}/big.png`]);
  const [text] = await downloadAssetUrls(config, [`${origin}/notes.txt`]);
  const [missing] = await downloadAssetUrls(config, [`${origin}/missing.png`]);
  const [slow] = await downloadAssetUrls(config, [`${origin}/slow.png`]);
  const [bad] = await downloadAssetUrls(config, ['not-a-url']);
  assert.deepEqual([big.ok, text.ok, missing.ok, slow.ok, bad.ok], [false, false, false, false, false]);
  if (!big.ok) assert.equal(big.reason, 'too_large');
  if (!text.ok) assert.equal(text.reason, 'unsupported_type');
  if (!missing.ok) assert.equal(missing.reason, 'http_404');
  if (!slow.ok) assert.equal(slow.reason, 'request_failed');
  if (!bad.ok) assert.equal(bad.reason, 'invalid_url');
});

test('production defaults still refuse plain http, unknown hosts and private addresses', async () => {
  const strict = readConfig({ NODE_ENV: 'test', ASSET_URL_ALLOWED_HOSTS: 'img.alicdn.com', ASSET_URL_ALLOW_LOOPBACK: 'false' });
  const results = await downloadAssetUrls(strict, [`${origin}/image.png`, 'https://evil.test/a.png', 'https://127.0.0.1/a.png']);
  assert.deepEqual(results.map(result => result.ok ? 'ok' : result.reason), ['https_required', 'host_not_allowed', 'host_not_allowed']);
});

test('the per-import cap limits how many urls are fetched', async () => {
  const results = await downloadAssetUrls(fixtureConfig({ ASSET_URL_MAX_PER_IMPORT: '2' }), [`${origin}/image.png`, `${origin}/image.png`, `${origin}/image.png`]);
  assert.equal(results.length, 2);
});
