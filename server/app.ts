import { getRecommendations, runRecommendations } from './services/recommendations';
import { createRecommendationRuntime } from './providers/qwenRecommendation';
import { createListingRuntime } from './providers/qwenListing';
import { createReviewRuntime } from './providers/qwenReview';
import { createMultimodalRuntime } from './providers/multimodalRuntime';
import { createQualityReportReader } from './providers/qualityReport';
import { getWorkflow, getListing, createListing, reviseListing, reviewListing, publishListing, publishedAmazonCsv } from './services/listings';
import { createV1, factSnapshot, taskFactSnapshots, analyzeFacts, recheckImages, mutateFact, templateFromFacts } from './services/facts';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import type { Capabilities, PublicUser } from '../shared/contracts';
import type { ServerConfig } from './config';
import { AppError } from './errors';
import { credentialsSchema, importSchema, registerSchema, taskSchema } from './validation';
import { bulkResolveImportSchema, checkDecisionSchema, resolveImportSchema } from './validation';
import { decideCheck, recordQualityReport } from './services/checks';
import { hashPassword, newSessionToken, tokenHash, verifyPassword } from './auth/password';
import { catalog, resetCatalog, seedProducts, toProduct } from './services/catalog';
import { deleteImportRule, importBatchDetail, importBatchSourceFile, importWithAlignment, listImportBatches, listImportRules, previewImportAlignment, resolveImportOccurrence, resolveImportOccurrencesBulk } from './services/imports';
import { createTask, selectProduct, tasks, updateTask } from './services/tasks';
import { pricingSnapshotHistory, refreshPricingSnapshot } from './services/pricing-snapshots';
import { ASSET_MIME_TYPES, deleteProductAsset, listProductAssets, pruneOrphanAssetFiles, readProductAsset, storeProductAsset } from './services/assets';
import { recordHazmatRelease } from './services/hazmat';
import { assetUploadSchema } from './validation';
import { createTextProviders } from './providers/text';

declare module 'fastify' { interface FastifyRequest { user: PublicUser | null } }
const SESSION_COOKIE = 'prismlaunch_session';
const publicUser = (user: PublicUser): PublicUser => ({ id: user.id, email: user.email, displayName: user.displayName });
export async function buildApp(config: ServerConfig, db: PrismaClient, options: { transport?: typeof fetch; logger?: boolean; recommendationAudit?: import('./providers/qwenRecommendation').RecommendationOptions['auditOutput'] } = {}) {
  const app = Fastify({ logger: options.logger ?? (config.NODE_ENV === 'development' ? { level: 'info', redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]', 'password', 'apiKey'] } : false), requestTimeout: 35000, connectionTimeout: 35000, bodyLimit: 3 * 1024 * 1024 });
  const providers = createTextProviders(config, db, options.transport);
  const listingRuntime = createListingRuntime(config, providers.bailian, (id, errorCode) => db.aiCall.update({ where: { id }, data: { success: false, errorCode } }));
  const reviewRuntime = createReviewRuntime(config, providers.bailian, (id, errorCode) => db.aiCall.update({ where: { id }, data: { success: false, errorCode } }));
  const recommendationRuntime = createRecommendationRuntime(config, providers.bailian, (id, errorCode) => db.aiCall.update({ where: { id }, data: { success: false, errorCode } }), options.recommendationAudit);
  const multimodalRuntime = createMultimodalRuntime(config, providers.bailian);
  // The validity date is read from the submitted report picture. Only a provider that can actually see
  // picture content can do that, so an offline run files the submission exactly as before.
  const reportReader = multimodalRuntime.provider.readsPictures
    ? createQualityReportReader(providers.bailian, { model: config.BAILIAN_VL_MODEL, maxTokens: config.MULTIMODAL_MAX_TOKENS }) : undefined;
  await app.register(cookie);
  app.decorateRequest('user', null);
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof z.ZodError) return reply.code(400).send({ error: { code: 'validation_error', message: 'Invalid request.', fields: error.issues.map(i => ({ path: i.path.join('.'), message: i.message })) } });
    if (error instanceof AppError) return reply.code(error.status).send({ error: { code: error.code, message: error.message } });
    const status = typeof (error as { statusCode?: number }).statusCode === 'number' ? (error as { statusCode: number }).statusCode : 500;
    request.log.warn({ status, code: 'request_failed' }, 'Request failed');
    return reply.code(status).send({ error: { code: status >= 500 ? 'internal_error' : 'invalid_request', message: status >= 500 ? 'The request could not be completed.' : 'Invalid request.' } });
  });
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && request.headers.origin) {
      const sameOrigin = new URL(request.headers.origin).host === request.headers.host;
      if (!sameOrigin && !config.WEB_ORIGINS.split(',').includes(request.headers.origin)) throw new AppError('origin_forbidden', 'Request origin is not allowed.', 403);
    }
    const token = request.cookies[SESSION_COOKIE];
    if (token) {
      const session = await db.session.findUnique({ where: { tokenHash: tokenHash(token) }, include: { user: true } });
      if (session && session.expiresAt > new Date()) request.user = publicUser(session.user);
    }
  });
  const requireUser = async (request: import('fastify').FastifyRequest) => { if (!request.user) throw new AppError('unauthenticated', 'Please sign in.', 401); };
  const protectedRoute = { preHandler: requireUser };
  const setSession = async (userId: string, reply: import('fastify').FastifyReply) => {
    const token = newSessionToken(); const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000);
    await db.session.create({ data: { userId, tokenHash: tokenHash(token), expiresAt } });
    reply.setCookie(SESSION_COOKIE, token, { path: '/', httpOnly: true, sameSite: 'lax', secure: config.NODE_ENV === 'production', expires: expiresAt });
  };
  app.get('/api/health', async () => { await db.$queryRaw`SELECT 1`; return { status: 'ok', service: 'prismlaunch-api' }; });
  app.post('/api/auth/login', async (request, reply) => {
    const input = credentialsSchema.parse(request.body);
    const user = await db.user.findUnique({ where: { email: input.email } });
    if (!user || !await verifyPassword(input.password, user.passwordHash)) throw new AppError('invalid_credentials', 'Email or password is incorrect.', 401);
    await setSession(user.id, reply); return { data: publicUser(user) };
  });
  app.post('/api/auth/register', async (request, reply) => {
    if (!config.ALLOW_REGISTRATION || config.NODE_ENV === 'production') throw new AppError('registration_disabled', 'Local registration is disabled.', 403);
    const input = registerSchema.parse(request.body);
    if (await db.user.findUnique({ where: { email: input.email } })) throw new AppError('email_exists', 'This email is already registered.', 409);
    const passwordHash = await hashPassword(input.password);
    const user = await db.$transaction(async tx => { const u = await tx.user.create({ data: { email: input.email, displayName: input.displayName, passwordHash } }); await seedProducts(tx, u.id); return u; });
    await setSession(user.id, reply); return reply.code(201).send({ data: publicUser(user) });
  });
  app.get('/api/auth/me', protectedRoute, async request => ({ data: request.user }));
  app.post('/api/auth/logout', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE]; if (token) await db.session.deleteMany({ where: { tokenHash: tokenHash(token) } });
    reply.clearCookie(SESSION_COOKIE, { path: '/', httpOnly: true, sameSite: 'lax', secure: config.NODE_ENV === 'production' }); return { data: { ok: true } };
  });
  app.get('/api/products', protectedRoute, async request => ({ data: await catalog(db, request.user!.id) }));
  app.get('/api/products/:id', protectedRoute, async request => {
    const { id } = z.object({ id: z.string().min(1).max(220) }).parse(request.params);
    const row = await db.product.findFirst({ where: { userId: request.user!.id, OR: [{ id }, { sku: id }] } });
    if (!row) throw new AppError('not_found', 'Product not found.', 404); return { data: toProduct(row) };
  });
  app.post('/api/products/import', { preHandler: requireUser, bodyLimit: Math.ceil(config.ASSET_MAX_BYTES * 1.4) + 8192 }, async request => {
    const data = await importWithAlignment(db, config, request.user!.id, importSchema.parse(request.body));
    await pruneOrphanAssetFiles(db, config, request.user!.id);
    return { data };
  });
  app.get('/api/imports', protectedRoute, async request => ({ data: await listImportBatches(db, request.user!.id, Number((request.query as { limit?: string } | undefined)?.limit ?? 20)) }));
  app.post('/api/products/import/preview', protectedRoute, async request => ({ data: await previewImportAlignment(db, request.user!.id, importSchema.parse(request.body)) }));
  app.get('/api/imports/rules', protectedRoute, async request => ({ data: await listImportRules(db, request.user!.id) }));
  app.get('/api/imports/:id/source', protectedRoute, async (request, reply) => {
    const file = await importBatchSourceFile(db, config, request.user!.id, productParams.parse(request.params).id);
    return reply.type(file.mimeType).header('Content-Disposition', `attachment; filename="${file.fileName.replace(/["\\]/g, '')}"`).send(file.bytes);
  });
  app.delete('/api/imports/rules/:id', protectedRoute, async request => ({ data: await deleteImportRule(db, request.user!.id, productParams.parse(request.params).id) }));
  app.get('/api/imports/:id', protectedRoute, async request => ({ data: await importBatchDetail(db, request.user!.id, productParams.parse(request.params).id) }));
  app.post('/api/imports/:id/resolve-bulk', protectedRoute, async request => {
    const input = bulkResolveImportSchema.parse(request.body);
    return { data: await resolveImportOccurrencesBulk(db, request.user!.id, productParams.parse(request.params).id, input, input.expectedRevision) };
  });
  app.post('/api/imports/occurrences/:id/resolve', protectedRoute, async request => {
    const input = resolveImportSchema.parse(request.body);
    return { data: await resolveImportOccurrence(db, request.user!.id, productParams.parse(request.params).id, input.action, input.expectedRevision) };
  });
  const productParams = z.object({ id: z.string().min(1).max(220) });
  // Source assets keep zero extra dependencies: base64 JSON in, SQLite metadata plus a hashed file on disk out.
  const assetUploadRoute = { preHandler: requireUser, bodyLimit: Math.ceil(config.ASSET_MAX_BYTES * 1.4) + 8192 };
  app.get('/api/products/:id/assets', protectedRoute, async request => ({ data: await listProductAssets(db, request.user!.id, productParams.parse(request.params).id) }));
  app.post('/api/products/:id/assets', assetUploadRoute, async request => ({ data: await storeProductAsset(db, config, request.user!.id, productParams.parse(request.params).id, assetUploadSchema.parse(request.body)) }));
  app.post('/api/products/:id/hazmat-release', protectedRoute, async request => {
    const input = z.object({ documents: z.string().trim().min(1).max(500) }).strict().parse(request.body);
    return { data: await recordHazmatRelease(db, request.user!.id, productParams.parse(request.params).id, input.documents) };
  });
    /**
     * The quality report is required before the task moves on, so it can be submitted here as well as
     * imported. With a picture attached the document itself is read: the validity date is never typed in
     * by hand, and a report without a date or issued for another product is refused.
     */
    app.post('/api/products/:id/quality-report', protectedRoute, async request => {
      const input = z.object({ reportNo: z.string().trim().min(1).max(120), result: z.enum(['pass', 'fail']).optional(),
        validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), assetId: z.string().trim().min(1).max(220).optional() }).strict().parse(request.body);
      return { data: await recordQualityReport(db, config, request.user!.id, productParams.parse(request.params).id, input, reportReader) };
    });
  app.get('/api/assets/:id/content', protectedRoute, async (request, reply) => {
    const file = await readProductAsset(db, config, request.user!.id, productParams.parse(request.params).id);
    return reply.type(file.mimeType).header('Content-Disposition', `inline; filename="${file.fileName.replace(/["\\]/g, '')}"`).send(file.bytes);
  });
  app.delete('/api/assets/:id', protectedRoute, async request => ({ data: await deleteProductAsset(db, config, request.user!.id, productParams.parse(request.params).id) }));
  app.post('/api/demo/reset', protectedRoute, async request => {
    if (!config.ENABLE_DEMO_RESET || config.NODE_ENV === 'production') throw new AppError('demo_reset_disabled', 'Demo reset is disabled.', 403);
    z.object({}).strict().parse(request.body ?? {});
    const data = await resetCatalog(db, request.user!.id);
    await pruneOrphanAssetFiles(db, config, request.user!.id);
    return { data };
  });
  app.post('/api/tasks', protectedRoute, async request => ({ data: await createTask(db, request.user!.id, taskSchema.parse(request.body)) }));
  app.get('/api/tasks', protectedRoute, async request => ({ data: await tasks(db, request.user!.id) }));
  app.get('/api/tasks/:id', protectedRoute, async request => {
    const { id } = z.object({ id: z.string().max(220) }).parse(request.params); const task = (await tasks(db, request.user!.id)).find(t => t.recordId === id || t.id === id);
    if (!task) throw new AppError('not_found', 'Task not found.', 404); return { data: task };
  });
  app.post('/api/tasks/:id/selection', protectedRoute, async request => {
    const { id } = z.object({ id: z.string().max(220) }).parse(request.params);
    const input = z.object({ productId: z.string().max(220), purpose: z.enum(['selected', 'fact_review']) }).strict().parse(request.body);
    return { data: await selectProduct(db, request.user!.id, id, input.productId, input.purpose) };
  });
  app.patch('/api/tasks/:id', protectedRoute, async request => {
    const { id } = z.object({ id: z.string().min(1).max(220) }).parse(request.params);
    const input = taskSchema.omit({ code: true }).extend({ expectedRevision: z.number().int().positive() }).parse(request.body);
    return { data: await updateTask(db, request.user!.id, id, input) };
  });
  app.get('/api/tasks/:id/pricing-snapshots', protectedRoute, async request => {
    const { id } = z.object({ id: z.string().min(1).max(220) }).parse(request.params);
    return { data: await pricingSnapshotHistory(db, request.user!.id, id) };
  });
  app.post('/api/tasks/:id/pricing-snapshots', protectedRoute, async request => {
    const { id } = z.object({ id: z.string().min(1).max(220) }).parse(request.params);
    const input = z.object({ expectedVersion: z.number().int().positive() }).strict().parse(request.body);
    return { data: await refreshPricingSnapshot(db, request.user!.id, id, input.expectedVersion) };
  });
  app.get('/api/tasks/:id/recommendations', protectedRoute, async request => {
    const { id } = z.object({ id: z.string().min(1).max(220) }).parse(request.params);
    return { data: await getRecommendations(db, request.user!.id, id) };
  });
  app.post('/api/tasks/:id/recommendations', protectedRoute, async request => {
    const { id } = z.object({ id: z.string().min(1).max(220) }).parse(request.params);
    const input = z.object({ expectedTaskRevision: z.number().int().positive(), mode: z.enum(['configured', 'rule']).default('configured') }).strict().parse(request.body);
    return { data: await runRecommendations(db, request.user!.id, id, input.expectedTaskRevision, input.mode === 'rule' ? undefined : recommendationRuntime) };
  });
  const factPath = '/api/tasks/:taskId/products/:productId';
  const factParams = z.object({ taskId: z.string().min(1).max(220), productId: z.string().min(1).max(220) });
  const revisionBody = z.object({ expectedRevision: z.number().int().positive() }).strict();
  for (const resource of ['fact-snapshot', 'fact-cards', 'facts', 'evidence'] as const) {
    app.get(`${factPath}/${resource}`, protectedRoute, async request => {
      const p = factParams.parse(request.params); const snap = await factSnapshot(db, request.user!.id, p.taskId, p.productId);
      return { data: resource === 'fact-snapshot' ? snap : resource === 'fact-cards' ? { v1: snap.v1, v2: snap.v2, factsRevision: snap.factsRevision } : snap[resource] };
    });
  }
  app.get('/api/tasks/:id/fact-snapshots', protectedRoute, async request => {
    const { id } = z.object({ id: z.string().min(1).max(220) }).parse(request.params);
    return { data: await taskFactSnapshots(db, request.user!.id, id) };
  });
  app.post(`${factPath}/fact-cards/v1`, protectedRoute, async request => {
    const p = factParams.parse(request.params); z.object({}).strict().parse(request.body ?? {});
    return { data: await createV1(db, request.user!.id, p.taskId, p.productId) };
  });
  app.post(`${factPath}/analyze`, protectedRoute, async request => {
    const p = factParams.parse(request.params); const input = revisionBody.parse(request.body);
    return { data: await analyzeFacts(db, config, request.user!.id, p.taskId, p.productId, input.expectedRevision, multimodalRuntime.provider) };
  });
  /** Re-runs only the picture text check, so a new photo does not force a whole new fact card. */
  app.post(`${factPath}/image-check`, protectedRoute, async request => {
    const p = factParams.parse(request.params); const input = revisionBody.parse(request.body);
    return { data: await recheckImages(db, config, request.user!.id, p.taskId, p.productId, input.expectedRevision, multimodalRuntime.provider) };
  });
  /**
   * The decision half of the check area: take what the picture prints, correct the value by hand,
   * drop the picture, or drop a quality report. Every action is recorded, and none of them rewrites V1.
   */
  app.post(`${factPath}/check-decisions`, protectedRoute, async request => {
    const p = factParams.parse(request.params);
    return { data: await decideCheck(db, request.user!.id, p.taskId, p.productId, checkDecisionSchema.parse(request.body)) };
  });
  for (const action of ['edit', 'confirm', 'reject'] as const) {
    app.route({ method: action === 'edit' ? 'PATCH' : 'POST', url: `/api/facts/:factId${action === 'edit' ? '' : `/${action}`}`, ...protectedRoute, handler: async request => {
      const { factId } = z.object({ factId: z.string().min(1).max(220) }).parse(request.params);
      const input = (action === 'edit' ? revisionBody.extend({ value: z.string().max(220) }) : revisionBody).parse(request.body);
      return { data: await mutateFact(db, request.user!.id, factId, action, input.expectedRevision, 'value' in input ? input.value as string : undefined) };
    } });
  }
  app.post(`${factPath}/listing-template`, protectedRoute, async request => {
    const p = factParams.parse(request.params);
    const input = revisionBody.extend({ platform: z.enum(['amazon', 'shopify']), revision: z.number().int().positive() }).parse(request.body);
    return { data: await templateFromFacts(db, request.user!.id, p.taskId, p.productId, input.platform, input.revision, input.expectedRevision) };
  });
  const listingVersion = z.object({ expectedVersion: z.number().int().nonnegative().max(1_000_000), expectedFactsRevision: z.number().int().positive() }).strict();
  app.get(`${factPath}/listings`, protectedRoute, async request => {
    const p = factParams.parse(request.params); return { data: await getWorkflow(db, request.user!.id, p.taskId, p.productId, reviewRuntime) };
  });
  app.post(`${factPath}/listings`, protectedRoute, async request => {
    const p = factParams.parse(request.params); const input = listingVersion.extend({ platform: z.enum(['amazon', 'shopify']) }).parse(request.body);
    return { data: await createListing(db, request.user!.id, p.taskId, p.productId, input, listingRuntime, reviewRuntime) };
  });
  const listingParams = z.object({ id: z.string().min(1).max(220) });
  app.get('/api/listings/:id', protectedRoute, async request => ({ data: await getListing(db, request.user!.id, listingParams.parse(request.params).id, reviewRuntime) }));
  app.patch('/api/listings/:id', protectedRoute, async request => {
    const input = listingVersion.extend({ title: z.string().trim().min(1).max(220), bullets: z.array(z.string().max(1000)).min(1).max(20), description: z.string().trim().min(1).max(10000) }).parse(request.body);
    return { data: await reviseListing(db, request.user!.id, listingParams.parse(request.params).id, 'edit', input, listingRuntime, reviewRuntime) };
  });
  for (const action of ['regenerate', 'apply-suggested-fix', 'review', 'publish', 'inject-demo-risk'] as const) {
    app.post(`/api/listings/:id/${action}`, protectedRoute, async request => {
      if (action === 'inject-demo-risk' && config.NODE_ENV === 'production') throw new AppError('not_found', 'Not found.', 404);
      const id = listingParams.parse(request.params).id; const input = listingVersion.parse(request.body);
      return { data: action === 'review' ? await reviewListing(db, request.user!.id, id, input, reviewRuntime) : action === 'publish' ? await publishListing(db, request.user!.id, id, input, reviewRuntime) : await reviseListing(db, request.user!.id, id, action === 'regenerate' ? 'regenerate' : action === 'inject-demo-risk' ? 'inject-risk' : 'fix', input, listingRuntime, reviewRuntime) };
    });
  }
  app.get('/api/publish/:id/amazon-csv', protectedRoute, async (request, reply) => {
    const result = await publishedAmazonCsv(db, request.user!.id, listingParams.parse(request.params).id, reviewRuntime);
    return reply.type('text/csv; charset=utf-8').header('Content-Disposition', `attachment; filename="${result.filename}"`).send(result.csv);
  });
  app.get('/api/capabilities', async () => {
    await db.$queryRaw`SELECT 1`;
    const available = config.AI_LIVE_ENABLED && !!config.BAILIAN_API_KEY;
    const result: Capabilities = { backend: true, database: true, authentication: true,
      storage: { server: ['User', 'Product', 'ProductAsset', 'LaunchTask', 'PricingSnapshot', 'TaskSelection', 'FactCard', 'Fact', 'Evidence', 'ListingDraft', 'ReviewResult', 'PublishResult'], browser: ['Language', 'UI preferences', 'Non-authoritative cache'] },
      assets: { storage: 'server', acceptedTypes: [...ASSET_MIME_TYPES], maxBytesPerFile: config.ASSET_MAX_BYTES, maxPerProduct: config.ASSET_MAX_PER_PRODUCT },
      textModel: { activeProvider: 'mock', liveAvailable: available, configured: !!config.BAILIAN_API_KEY, liveEnabled: config.AI_LIVE_ENABLED, model: config.BAILIAN_TEXT_MODEL, remainingCalls: providers.bailian.remainingCalls },
      recommendation: { activeProvider: config.RECOMMENDATION_PROVIDER === 'qwen' && available ? 'qwen' : 'rule', liveAvailable: available, liveImplemented: true, liveModel: config.BAILIAN_TEXT_MODEL }, evidence: { activeProvider: multimodalRuntime.mode, liveAvailable: available, liveImplemented: true, liveModel: multimodalRuntime.model },
      listing: { activeProvider: config.LISTING_PROVIDER === 'qwen' && available ? 'qwen' : 'template', liveAvailable: available, liveImplemented: true, liveModel: config.BAILIAN_TEXT_MODEL }, review: { activeProvider: reviewRuntime.mode, liveAvailable: available, liveImplemented: true, liveModel: config.BAILIAN_TEXT_MODEL },
    }; return { data: result };
  });
  app.post('/api/ai/smoke-test', protectedRoute, async request => {
    if (config.NODE_ENV === 'production') throw new AppError('not_found', 'Not found.', 404);
    const input = z.object({ message: z.string().trim().min(1).max(500), structured: z.boolean().default(false) }).strict().parse(request.body);
    const result = input.structured ? await providers.bailian.generateStructured({ prompt: input.message, purpose: 'smoke-structured', schema: z.object({ ok: z.literal(true), service: z.literal('prismlaunch') }).strict(), example: { ok: true as const, service: 'prismlaunch' as const } }) : await providers.bailian.generateText({ prompt: input.message, purpose: 'smoke-text' });
    return { data: result };
  });
  return app;
}
