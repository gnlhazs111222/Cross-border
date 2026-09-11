import { createHash } from 'node:crypto';
import type { ListingInput } from '../../shared/domain';
import type { Listing } from '../../src/types';
import { AppError } from '../errors';
import type { ServerConfig } from '../config';
import type { TextModelProvider, TextResult } from './text';
import { TemplateListingProvider, type ListingProvider } from './domain';
import { LISTING_PROMPT_VERSION, listingSystemPrompt } from '../prompts/listing-v1';
import { authorizedCopyFacts, listingOutputSchema, validateGeneratedListingAgainstFacts, type GeneratedListing } from './listingValidation';

export type AuthorizedListing = Listing & { authorization?: { output: GeneratedListing; factsRevision: number; inputHash: string } };
type Success = { output: GeneratedListing; result: TextResult };
export type QwenOptions = {
  model: string; liveEnabled: boolean; configured: boolean; maxTokens?: number; promptVersion?: string;
  rejectedAudit?: (aiCallId: string, code: string) => Promise<unknown>;
};
export function normalizedListingInput(input: ListingInput) {
  const facts = authorizedCopyFacts(input.factCard.facts);
  return {
    platform: input.platform, market: input.context?.market ?? 'United States', category: input.context?.category ?? 'Home & Kitchen',
    requirements: (input.context?.requirements ?? []).filter(r => !/profit|cost|declared|freight|duty|margin|\bUSD\b|\$/i.test(r)).map(r => r.trim().replace(/\s+/g, ' ')),
    product: input.context?.product ?? { sku: input.factCard.sku, name: 'Product' }, factsRevision: input.factRevision,
    ALLOWED_FACTS: facts.map(f => ({ field: f.key, label: f.label, value: f.value, source: f.sourceKind === 'supplier' ? 'Supplier File' : f.sourceKind === 'manual' ? 'Manual Confirmation' : 'Mock Evidence' })).sort((a, b) => a.field.localeCompare(b.field)),
  };
}
export function listingInputHash(input: ListingInput, model: string, promptVersion = LISTING_PROMPT_VERSION) {
  return createHash('sha256').update(JSON.stringify({ ...normalizedListingInput(input), model, promptVersion })).digest('hex');
}
export class QwenListingProvider implements ListingProvider {
  private cache = new Map<string, Success>();
  private pending = new Map<string, Promise<Success>>();
  private fallback = new TemplateListingProvider();
  constructor(private text: TextModelProvider, private options: QwenOptions) {}
  private async run(input: ListingInput, inputHash: string, promptVersion: string): Promise<Success> {
    const allowed = authorizedCopyFacts(input.factCard.facts);
    const template = await this.fallback.generate(input);
    const example: GeneratedListing = { title: template.title, bullets: template.bullets.slice(0, 5), description: template.description, attributes: template.attributes, usedFacts: allowed.map(f => ({ field: f.key, value: f.value })) };
    const schema = listingOutputSchema(input.platform);
    const result = await this.text.generateStructured({ purpose: 'listing_generation', mode: 'text', promptVersion, inputHash,
      systemPrompt: listingSystemPrompt(input.platform, input.context?.category), maxTokens: this.options.maxTokens ?? 1800,
      prompt: JSON.stringify(normalizedListingInput(input)), schema, example });
    try {
      const output = validateGeneratedListingAgainstFacts(schema.parse(result.data), allowed);
      return { output, result };
    } catch (error) {
      const code = error instanceof AppError ? error.code : 'invalid_listing_schema';
      if (result.aiCallId) await this.options.rejectedAudit?.(result.aiCallId, code);
      const rejected = new AppError(code, 'Generated copy did not pass validation.', 422); rejected.aiCallId = result.aiCallId; throw rejected;
    }
  }
  async generate(input: ListingInput): Promise<AuthorizedListing> {
    const promptVersion = this.options.promptVersion ?? LISTING_PROMPT_VERSION;
    const inputHash = listingInputHash(input, this.options.model, promptVersion);
    let cacheHit = false;
    try {
      if (!this.options.liveEnabled) throw new AppError('live_ai_disabled', 'Live AI is disabled.');
      if (!this.options.configured) throw new AppError('bailian_not_configured', 'Bailian is not configured.');
      let success = this.cache.get(inputHash);
      cacheHit = !!success || this.pending.has(inputHash);
      if (!success) {
        let pending = this.pending.get(inputHash);
        if (!pending) { pending = this.run(input, inputHash, promptVersion); this.pending.set(inputHash, pending); }
        try { success = await pending; } finally { this.pending.delete(inputHash); }
        if (this.cache.size >= 100) this.cache.delete(this.cache.keys().next().value!);
        this.cache.set(inputHash, success);
      }
      const output = validateGeneratedListingAgainstFacts(success.output, input.factCard.facts);
      const { usedFacts, ...copy } = output; const used = new Set(usedFacts.map(f => f.field));
      return { ...structuredClone(copy), platform: input.platform, revision: input.revision, factRevision: input.factRevision, generationMode: 'qwen', riskDemoInjected: false,
        sources: structuredClone(authorizedCopyFacts(input.factCard.facts).filter(f => used.has(f.key))),
        generation: { provider: 'bailian', model: this.options.model, promptVersion, inputHash, aiCallId: success.result.aiCallId, cacheHit },
        authorization: { output: structuredClone(output), factsRevision: input.factRevision, inputHash } };
    } catch (error) {
      const allowedCodes = /^(live_ai_disabled|bailian_not_configured|bailian_timeout|bailian_auth_failed|bailian_http_\w+|bailian_connection_error|invalid_ai_response|ai_output_limit|invalid_ai_json|invalid_listing_schema|unauthorized_fact|unauthorized_attribute|internal_or_unsafe_content|unsupported_claim|unsupported_quantity|unsupported_specification|live_ai_budget_exhausted|premium_disabled|unsupported_model|insecure_tls_configuration)$/;
      const fallbackReason = error instanceof AppError && allowedCodes.test(error.code) ? error.code : 'provider_error';
      const fallback = await this.fallback.generate(input);
      return { ...fallback, generationMode: 'template_fallback', generation: { provider: 'template', model: this.options.model, promptVersion, inputHash, fallbackReason, aiCallId: error instanceof AppError ? error.aiCallId : undefined, cacheHit: false } };
    }
  }
}
export type ListingRuntime = { requested: 'template' | 'qwen'; provider: ListingProvider };
export function createListingRuntime(config: ServerConfig, text: TextModelProvider, rejectedAudit: QwenOptions['rejectedAudit']): ListingRuntime {
  return { requested: config.LISTING_PROVIDER, provider: config.LISTING_PROVIDER === 'qwen' ? new QwenListingProvider(text, {
    model: config.BAILIAN_TEXT_MODEL, liveEnabled: config.AI_LIVE_ENABLED, configured: !!config.BAILIAN_API_KEY, maxTokens: config.BAILIAN_LISTING_MAX_TOKENS, rejectedAudit,
  }) : new TemplateListingProvider() };
}
