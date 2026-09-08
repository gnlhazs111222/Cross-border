import { createHash } from 'node:crypto';
import type { Fact, Product, Recommendation, Task } from '../../src/types';
import { baseFactCard } from '../../shared/facts';
import { hardFilter, type RecommendationContext } from '../../shared/recommendation';
import type { ServerConfig } from '../config';
import { MockRecommendationProvider, type RecommendationProvider } from './domain';
import type { TextModelProvider, TextResult } from './text';
import { AppError } from '../errors';
import { RECOMMENDATION_PROMPT_VERSION, recommendationSystemPrompt } from '../prompts/recommendation-v1';
import { recommendationOutputSchema, validateCandidateAuthorization, type RankedOutput } from './recommendationValidation';
const publicKeys = new Set(['color', 'capacity', 'material', 'straw', 'countryOfOrigin', 'finish', 'lidType', 'packageIncludes']);
export function normalizedRecommendationInput(products: Product[], task: Task, context?: RecommendationContext) {
  return { task: { platform: task.platform, market: task.market, category: task.category, requirements: task.requirements.map(r => r.trim().replace(/\s+/g, ' ')), minimumProfit: task.minProfit },
    taskRevision: context?.taskRevision ?? task.revision ?? 1, catalogRevision: context?.catalogRevision ?? 1, candidateVersion: context?.candidateVersion ?? 'fixture',
    candidates: products.map(p => ({ productId: p.recordId ?? p.sku, sku: p.sku, productName: p.name, category: p.category,
      attributes: { color: p.color, capacityMl: p.capacity, capacityLocalized: p.localizedCapacity, material: p.material, hasStraw: p.straw },
      completeness: 'Required facts and packaging are complete; demo profit requirement passed',
      confirmedFacts: (context?.facts[p.sku] ?? baseFactCard(p).facts).filter(f => f.status === 'Confirmed' && f.allowed && publicKeys.has(f.key)).map((f: Fact) => ({ field: f.key, value: f.value })).sort((a, b) => a.field.localeCompare(b.field)),
    })).sort((a, b) => a.sku.localeCompare(b.sku)) };
}
export function recommendationHash(products: Product[], task: Task, context: RecommendationContext | undefined, model: string, promptVersion = RECOMMENDATION_PROMPT_VERSION) {
  return createHash('sha256').update(JSON.stringify({ ...normalizedRecommendationInput(products, task, context), model, promptVersion })).digest('hex');
}
export type RecommendationOptions = { model: string; liveEnabled: boolean; configured: boolean; promptVersion?: string; maxTokens?: number; rejectedAudit?: (id: string, code: string) => Promise<unknown>; auditOutput?: (record: { inputHash: string; output: unknown; accepted: boolean; errorCode?: string }) => Promise<unknown> };
type Success = { output: RankedOutput; result: TextResult };
export class QwenRecommendationProvider implements RecommendationProvider {
  private cache = new Map<string, Success>(); private pending = new Map<string, Promise<Success>>(); private fallback = new MockRecommendationProvider();
  constructor(private text: TextModelProvider, private options: RecommendationOptions) {}
  async recommend(products: Product[], task: Task, context?: RecommendationContext): Promise<Recommendation[]> {
    const eligible = hardFilter(products, task).eligible;
    if (!eligible.length) return [];
    const wire = [...eligible].sort((a, b) => a.sku.localeCompare(b.sku)).map((p, i) => ({ ...p, recordId: `C${i + 1}` }));
    const promptVersion = this.options.promptVersion ?? RECOMMENDATION_PROMPT_VERSION;
    const inputHash = recommendationHash(eligible, task, context, this.options.model, promptVersion);
    try {
      if (eligible.length > 40) throw new AppError('candidate_limit', 'Too many eligible candidates for the demo model budget.');
      if (!this.options.liveEnabled) throw new AppError('live_ai_disabled', 'Live AI is disabled.');
      if (!this.options.configured) throw new AppError('bailian_not_configured', 'Bailian is not configured.');
      let success = this.cache.get(inputHash); const cacheHit = !!success || this.pending.has(inputHash);
      if (!success) {
        let run = this.pending.get(inputHash);
        if (!run) {
          run = (async () => {
            const baseline = await this.fallback.recommend(eligible, task, context);
            const example: RankedOutput = { rankedCandidates: baseline.map(r => ({ productId: wire.find(p => p.sku === r.sku)!.recordId, sku: r.sku, score: r.score, matchedReasons: r.reasons, concerns: r.deductions, summary: 'Relative match based on confirmed candidate facts.' })) };
            const result = await this.text.generateStructured({ purpose: 'recommendation_generation', mode: 'text', promptVersion, inputHash, maxTokens: this.options.maxTokens ?? 1800,
              systemPrompt: recommendationSystemPrompt, prompt: JSON.stringify({ task: normalizedRecommendationInput(wire, task, context).task, candidates: normalizedRecommendationInput(wire, task, context).candidates }), schema: recommendationOutputSchema, example });
            try { const output = validateCandidateAuthorization(recommendationOutputSchema.parse(result.data), wire); await this.options.auditOutput?.({ inputHash, output, accepted: true }); return { result, output }; }
            catch (error) { const code = error instanceof AppError ? error.code : 'invalid_recommendation_schema'; await this.options.auditOutput?.({ inputHash, output: result.data, accepted: false, errorCode: code }); if (result.aiCallId) await this.options.rejectedAudit?.(result.aiCallId, code); const failure = new AppError(code, 'Ranking validation failed.', 422); failure.aiCallId = result.aiCallId; throw failure; }
          })(); this.pending.set(inputHash, run);
        }
        try { success = await run; } finally { this.pending.delete(inputHash); }
        if (this.cache.size >= 100) this.cache.delete(this.cache.keys().next().value!); this.cache.set(inputHash, success);
      }
      return validateCandidateAuthorization(success.output, wire).rankedCandidates.map(r => ({ productId: eligible.find(p => p.sku === r.sku)!.recordId ?? r.sku, sku: r.sku, score: r.score, reasons: r.matchedReasons, deductions: r.concerns, summary: r.summary,
        generation: { mode: 'qwen', model: this.options.model, promptVersion, inputHash, aiCallId: success.result.aiCallId, cacheHit } }));
    } catch (error) {
      const code = error instanceof AppError && /^(live_ai_disabled|bailian_not_configured|bailian_timeout|bailian_http_\w+|bailian_auth_failed|bailian_connection_error|invalid_ai_json|invalid_ai_response|ai_output_limit|live_ai_budget_exhausted|unauthorized_candidate|invalid_ranking_count|invalid_score_order|candidate_limit|unsupported_recommendation_reason|invalid_recommendation_schema|insecure_tls_configuration|unsupported_model|premium_disabled)$/.test(error.code) ? error.code : 'provider_error';
      return (await this.fallback.recommend(eligible, task, context)).map(r => ({ ...r, generation: { mode: 'rule_fallback', model: this.options.model, promptVersion, inputHash, fallbackReason: code, aiCallId: error instanceof AppError ? error.aiCallId : undefined, cacheHit: false } }));
    }
  }
}
export type RecommendationRuntime = { requested: 'rule' | 'qwen'; provider: RecommendationProvider };
export function createRecommendationRuntime(config: ServerConfig, text: TextModelProvider, rejectedAudit?: RecommendationOptions['rejectedAudit'], auditOutput?: RecommendationOptions['auditOutput']): RecommendationRuntime {
  return { requested: config.RECOMMENDATION_PROVIDER, provider: config.RECOMMENDATION_PROVIDER === 'qwen' ? new QwenRecommendationProvider(text, { model: config.BAILIAN_TEXT_MODEL, liveEnabled: config.AI_LIVE_ENABLED, configured: !!config.BAILIAN_API_KEY, maxTokens: config.RECOMMENDATION_MAX_TOKENS, rejectedAudit, auditOutput }) : new MockRecommendationProvider() };
}
