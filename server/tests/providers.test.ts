import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { readConfig } from '../config';
import { BailianTextModelProvider, MockTextModelProvider } from '../providers/text';
import { domainProviders, QwenListingProvider } from '../providers/domain';
import { demoTask, products } from '../../src/data/mockData';

const config = { ...readConfig({ NODE_ENV: 'test' }), NODE_ENV: 'development' as const, AI_LIVE_ENABLED: true, BAILIAN_API_KEY: 'unit-test-key', BAILIAN_BASE_URL: 'https://provider.test/v1' };
test('MockTextModelProvider and active domain providers are deterministic and local', async () => {
  const mock = new MockTextModelProvider();
  assert.equal((await mock.generateText()).provider, 'mock');
  const result = await mock.generateStructured({ prompt: 'test', purpose: 'unit', example: { ok: true }, schema: z.object({ ok: z.boolean() }) }); assert.deepEqual(result.data, { ok: true });
  const top = await domainProviders.recommendation.recommend(products, demoTask); assert.equal(top[0].score, 94); assert.equal(top[0].sku, products[0].sku);
  await assert.rejects(new QwenListingProvider().generate(), /not implemented/);
});
test('OpenAI SDK uses the supplied base URL, model and auth with mock transport; budget is enforced', async () => {
  let count = 0; const audit: unknown[] = [];
  const transport: typeof fetch = async (input, init) => {
    count++; assert.equal(String(input), 'https://provider.test/v1/chat/completions');
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer unit-test-key');
    const body = JSON.parse(String(init?.body)); assert.equal(body.model, 'qwen3.6-flash'); assert.equal(body.response_format.type, 'json_object');
    return new Response(JSON.stringify({ id: 'mock', object: 'chat.completion', created: 1, model: body.model, choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: '{"ok":true,"service":"prismlaunch"}' } }], usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 } }), { headers: { 'content-type': 'application/json' } });
  };
  const provider = new BailianTextModelProvider({ ...config, AI_MAX_LIVE_CALLS_PER_SESSION: 1 }, async row => { audit.push(row); }, transport);
  const result = await provider.generateStructured({ prompt: 'private input', purpose: 'unit-json', schema: z.object({ ok: z.literal(true), service: z.literal('prismlaunch') }), example: { ok: true, service: 'prismlaunch' } });
  assert.equal(result.usage?.total_tokens, 7); assert.deepEqual(result.data, { ok: true, service: 'prismlaunch' });
  await assert.rejects(provider.generateText({ prompt: 'again', purpose: 'unit' }), /budget/);
  assert.equal(count, 1); assert.equal(audit.length, 1); assert.doesNotMatch(JSON.stringify(audit), /private input|unit-test-key|authorization/i);
});
test('disabled, missing-key and premium gates make zero transport calls', async () => {
  let count = 0; const transport: typeof fetch = async () => { count++; throw new Error('must not call'); };
  for (const [overrides, pattern, mode] of [
    [{ AI_LIVE_ENABLED: false }, /disabled/, 'text'],
    [{ BAILIAN_API_KEY: '' }, /not configured/, 'text'],
    [{ AI_ALLOW_PREMIUM: false }, /Premium/, 'premium'],
  ] as const) {
    const p = new BailianTextModelProvider({ ...config, ...overrides }, async () => {}, transport);
    await assert.rejects(p.generateText({ prompt: 'test', purpose: 'unit', mode }), pattern);
  }
  assert.equal(count, 0);
  const testEnv = readConfig({ NODE_ENV: 'test', AI_LIVE_ENABLED: 'true', BAILIAN_API_KEY: 'unit-test-key' });
  assert.equal(testEnv.AI_LIVE_ENABLED, false); assert.equal(testEnv.BAILIAN_API_KEY, '');
});
test('live calls are blocked if TLS certificate verification is disabled', async () => {
  const previous = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  let calls = 0;
  try {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    const provider = new BailianTextModelProvider(config, async () => {}, async () => { calls++; throw new Error('must not call'); });
    await assert.rejects(provider.generateText({ prompt: 'test', purpose: 'tls-test' }), /TLS certificate/);
    assert.equal(calls, 0);
  } finally {
    if (previous === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED; else process.env.NODE_TLS_REJECT_UNAUTHORIZED = previous;
  }
});
test('HTTP failures are not retried and are recorded without upstream secrets', async () => {
  let count = 0; const rows: unknown[] = [];
  const p = new BailianTextModelProvider(config, async row => { rows.push(row); }, async () => { count++; return new Response(JSON.stringify({ error: { message: 'upstream-private-detail', type: 'server_error' } }), { status: 500, headers: { 'content-type': 'application/json' } }); });
  await assert.rejects(p.generateText({ prompt: 'sensitive', purpose: 'unit-error' }), error => { assert.doesNotMatch(String(error), /upstream-private-detail|unit-test-key|sensitive/); return true; });
  assert.equal(count, 1); assert.equal(rows.length, 1); assert.equal((rows[0] as { success: boolean }).success, false);
});
test('timeouts abort the mock transport and invalid JSON cannot become a successful structured result', async () => {
  const rows: { success: boolean; errorCode?: string; totalTokens?: number }[] = [];
  const hanging: typeof fetch = async (_input, init) => new Promise((_resolve, reject) => { init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }); });
  const slow = new BailianTextModelProvider({ ...config, BAILIAN_REQUEST_TIMEOUT_MS: 100 }, async row => { rows.push(row); }, hanging);
  await assert.rejects(slow.generateText({ prompt: 'test', purpose: 'timeout-test' }));
  assert.equal(rows[0].success, false); assert.equal(rows[0].errorCode, 'bailian_timeout');
  const malformed = new BailianTextModelProvider(config, async row => { rows.push(row); }, async () => new Response(JSON.stringify({ choices: [{ message: { content: 'not json' } }], usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 } }), { headers: { 'content-type': 'application/json' } }));
  await assert.rejects(malformed.generateStructured({ prompt: 'test', purpose: 'invalid-json-test', schema: z.object({ ok: z.boolean() }), example: { ok: true } }));
  assert.equal(rows[1].success, false); assert.equal(rows[1].errorCode, 'invalid_ai_json');
  assert.equal(rows[1].totalTokens, 5);
});
