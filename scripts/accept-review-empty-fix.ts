import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { mkdirSync, writeFileSync } from 'node:fs';
import { readConfig } from '../server/config';
import type { WorkflowSnapshot } from '../shared/contracts';

if (process.argv.slice(2).join(' ') !== '--live') throw new Error('Explicit --live required: isolated fixture, at most three reviews, no retries.');
const config = readConfig();
const db = new PrismaClient({ datasources: { db: { url: config.DATABASE_URL } } });
const folder = `artifacts/b-review/empty-fix-http-${Date.now()}`;
mkdirSync(folder, { recursive: true });
const steps: unknown[] = [];
let workflowPath = ''; let cookie = ''; let state: WorkflowSnapshot; let dirty = false;
const started = new Date();
async function request(path: string, method = 'GET', body?: unknown) {
  const response = await fetch(`http://127.0.0.1:3001/api${path}`, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  if (path === '/auth/login') cookie = response.headers.get('set-cookie')?.split(';')[0] ?? '';
  return { status: response.status, body: await response.json() };
}
const versions = () => ({ expectedVersion: state.heads.shopify!.revision, expectedFactsRevision: state.factsRevision });
async function action(name: string, edit?: string) {
  const response = await request(`/listings/${state.heads.shopify!.recordId}${edit ? '' : '/' + name}`, edit ? 'PATCH' : 'POST', { ...versions(), ...(edit ? { title: edit, bullets: state.listings.shopify!.bullets, description: state.listings.shopify!.description } : {}) });
  assert.equal(response.status, 200); state = response.body.data;
  steps.push({ name, state });
}
async function reread(name: string) {
  const response = await request(workflowPath);
  assert.equal(response.status, 200); state = response.body.data; steps.push({ name, state });
}
try {
  const row = await db.listingDraft.findFirstOrThrow({ where: { taskId: 'cmtssduyf0003qqy054f36fao', platform: 'shopify' }, orderBy: { revision: 'desc' } });
  const login = await request('/auth/login', 'POST', { email: 'demo@prismlaunch.local', password: 'Demo123456' });
  assert.equal(login.status, 200); assert.ok(cookie);
  workflowPath = `/tasks/${row.taskId}/products/${row.productId}/listings`;
  state = (await request(workflowPath)).body.data;
  assert.equal(state.listings.shopify!.title, 'Black stainless steel bottle, 500ml');
  assert.equal(state.factsRevision, 2);
  await action('review'); assert.equal(state.reviews.shopify!.status, 'passed'); assert.equal(state.publishAllowed.shopify, true);
  await action('wrong-title', 'Black stainless steel bottle, 750ml'); dirty = true;
  assert.equal(state.publishAllowed.shopify, false);
  await reread('pending-after-get'); assert.equal(state.publishAllowed.shopify, false);
  await action('review');
  assert.equal(state.reviews.shopify!.status, 'blocked'); assert.equal(state.publishAllowed.shopify, false);
  const issues = state.reviews.shopify!.issues;
  assert.equal(issues.length, 1); assert.equal(issues[0].location?.field, 'title'); assert.equal(issues[0].text, '750ml');
  assert.ok(issues[0].factKeys?.includes('capacity')); assert.ok(issues[0].suggestedFix?.trim());
  await reread('blocked-after-get'); assert.equal(state.reviews.shopify!.status, 'blocked');
  const denied = await request(`/listings/${state.heads.shopify!.recordId}/publish`, 'POST', versions());
  steps.push({ name: 'blocked-publication', response: denied });
  assert.equal(denied.status, 409); assert.equal(denied.body.error.code, 'publish_blocked');
} finally {
  try {
    if (dirty) {
      await action('restore-title', 'Black stainless steel bottle, 500ml');
      assert.equal(state!.publishAllowed.shopify, false);
      await action('review'); assert.equal(state!.reviews.shopify!.status, 'passed');
      await reread('restored-after-get'); assert.equal(state!.publishAllowed.shopify, true);
    }
  } finally {
    const calls = await db.aiCall.findMany({ where: { createdAt: { gte: started } }, orderBy: { createdAt: 'asc' } });
    writeFileSync(`${folder}/report.json`, JSON.stringify({ kind: 'real HTTP acceptance, not browser UI', steps, calls }, null, 2));
    console.log(JSON.stringify({ folder, steps: steps.map((s: any) => ({ name: s.name, status: s.state?.reviews.shopify?.status, revision: s.state?.heads.shopify?.revision, publishAllowed: s.state?.publishAllowed.shopify })), calls: calls.length, tokens: calls.reduce((sum, c) => sum + (c.totalTokens ?? 0), 0) }));
    await db.$disconnect();
  }
}
