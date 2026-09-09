import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Issue } from '../../src/types';
import { REVIEW_PROMPT_VERSION, REVIEW_RULE_VERSION, type ReviewInput, type ReviewLocation, type ReviewMetadata, type SemanticReviewResult } from '../../shared/review';
import type { TextModelProvider } from './text';
import { REVIEW_SYSTEM_PROMPT } from '../prompts/review-v1';
import { AppError } from '../errors';
import type { ServerConfig } from '../config';

const locationSchema = z.preprocess(value => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const location = { ...value } as Record<string, unknown>;
  // Models may serialize unused optional members as null. Never erase required members or unknown keys.
  if (location.field !== 'bullets' && location.index === null) delete location.index;
  if (location.field !== 'attributes' && location.key === null) delete location.key;
  if (location.occurrence === null) delete location.occurrence;
  return location;
}, z.object({ field: z.enum(['title', 'bullets', 'description', 'attributes']), index: z.number().int().min(0).optional(), key: z.string().min(1).max(220).optional(), occurrence: z.number().int().min(0).max(100).optional() }).strict());
const issueSchema = z.object({ category: z.enum(['spec_conflict', 'unsupported_claim', 'unauthorized_fact', 'internal_disclosure']),
  location: locationSchema,
  text: z.string().min(1).max(1500), reason: z.string().min(1).max(900), factKeys: z.array(z.string().min(1).max(80)).max(20), suggestedFix: z.string().trim().min(1).max(600),
}).strict();
export const reviewOutputSchema = z.object({ status: z.enum(['passed', 'blocked', 'needs_human_review']), issues: z.array(issueSchema).max(12) }).strict()
  .refine(v => v.status === 'passed' ? v.issues.length === 0 : v.issues.length > 0, 'Status and issues must agree');
export function reviewFields(input: ReviewInput): { location: ReviewLocation; text: string }[] {
  return [{ location: { field: 'title' }, text: input.listing.title }, ...input.listing.bullets.map((text, index) => ({ location: { field: 'bullets' as const, index }, text })),
    { location: { field: 'description' }, text: input.listing.description }, ...Object.entries(input.listing.attributes).map(([key, text]) => ({ location: { field: 'attributes' as const, key }, text }))];
}
export function hardReviewIssues(input: ReviewInput): Issue[] {
  const issues: Issue[] = [];
  for (const { text, location } of reviewFields(input)) {
    // Never send already-recognized private disclosures to a cloud reviewer.
    const disclosurePattern = /(?:supplier|procurement|purchase|unit)[\s_-]*(?:cost|price)|declared[\s_-]*(?:customs[\s_-]*)?value|\bwholesale\b|\bprofit\b|\bfreight\b|BAILIAN_API_KEY|sk-[a-zA-Z0-9_-]{12,}/i;
    const internal = disclosurePattern.exec(text) ?? (location.key ? disclosurePattern.exec(location.key) : null);
    if (internal) issues.push({ id: `B-LOCAL-${issues.length + 1}`, severity: 'HIGH', category: 'internal_disclosure', title: 'Internal commercial information', text: '[Internal information withheld]', location, reason: 'Remove internal commercial or credential information before public copy is reviewed.', factKeys: [], suggestedFix: 'Remove the internal information and run review again.', origin: 'rules' });
    if (/100%\s*leakproof/i.test(text)) issues.push({ id: `B-LOCAL-${issues.length + 1}`, severity: 'HIGH', category: 'unsupported_claim', title: 'Unsupported performance claim', text: text.match(/100%\s*leakproof/i)![0], location, reason: 'The demo does not authorize the absolute leakproof claim.', factKeys: [], suggestedFix: 'Remove the unsupported performance promise.', origin: 'rules' });
  }
  return issues;
}
export function reviewModelInput(input: ReviewInput) {
  // Review has its own consumer-field scope; generation's narrower whitelist must not erase valid review evidence.
  const publicKeys = new Set(['leakproof', 'color', 'capacity', 'material', 'straw', 'countryOfOrigin', 'packageIncludes', 'finish', 'lidType',
    'bpaFree', 'foodSafe', 'dishwasherSafe', 'coldRetention', 'heatRetention', 'dropTest', 'power', 'supply']);
  const allowed = input.facts.filter(f => publicKeys.has(f.key) && f.status === 'Confirmed' && f.allowed);
  return { platform: input.listing.platform, market: input.context.market, category: input.context.category,
    ALLOWED_FACTS: allowed.map(f => ({ field: f.key, label: f.label, value: f.value, sourceKind: f.sourceKind ?? 'supplier' })),
    COPY: { title: input.listing.title, bullets: input.listing.bullets, description: input.listing.description, attributes: input.listing.attributes },
    COPY_FIELDS: reviewFields(input).filter(f => f.text.length > 0),
    UNAUTHORIZED_FIELDS: input.facts.filter(f => publicKeys.has(f.key) && !allowed.some(a => a.key === f.key)).map(f => ({ field: f.key, status: f.status, allowed: false })),
  };
}
export function reviewInputHash(input: ReviewInput, model: string) {
  return createHash('sha256').update(JSON.stringify({ data: reviewModelInput(input), versions: [input.listingRevision, input.factsRevision, input.context.taskRevision, REVIEW_PROMPT_VERSION, REVIEW_RULE_VERSION, model] })).digest('hex');
}
type Options = { model: string; liveEnabled: boolean; configured: boolean; maxTokens?: number; rejectedAudit?: (id: string, code: string) => Promise<unknown> };
export class QwenReviewProvider {
  constructor(private text: TextModelProvider, private options: Options) {}
  async review(input: ReviewInput): Promise<SemanticReviewResult> {
    const metadata: ReviewMetadata = { mode: 'rules_qwen', model: this.options.model, promptVersion: REVIEW_PROMPT_VERSION, ruleVersion: REVIEW_RULE_VERSION, inputHash: reviewInputHash(input, this.options.model), listingRevision: input.listingRevision, factsRevision: input.factsRevision, taskRevision: input.context.taskRevision, modelCalled: false };
    const hard = hardReviewIssues(input);
    if (hard.length) return { status: 'blocked', issues: hard, metadata };
    try {
      if (!this.options.liveEnabled) throw new AppError('live_ai_disabled', 'Live disabled');
      if (!this.options.configured) throw new AppError('bailian_not_configured', 'Key missing');
      const payload = reviewModelInput(input);
      if (JSON.stringify(payload).length > 24000) throw new AppError('review_input_limit', 'Review input too large');
      const result = await this.text.generateStructured({ purpose: 'listing_review', systemPrompt: REVIEW_SYSTEM_PROMPT, prompt: JSON.stringify(payload), promptVersion: REVIEW_PROMPT_VERSION, inputHash: metadata.inputHash,
        maxTokens: this.options.maxTokens ?? 1800, schema: reviewOutputSchema, example: { status: 'passed', issues: [] } });
      metadata.modelCalled = true; metadata.aiCallId = result.aiCallId;
      const output = reviewOutputSchema.parse(result.data);
      const fields = reviewFields(input); const keys = new Set([...payload.ALLOWED_FACTS, ...payload.UNAUTHORIZED_FIELDS].map(f => f.field));
      // Conservative lexical completeness check, not semantic entailment.
      // Only an entire, multiword, uniquely mapped authorized value can require a reference.
      const words = (text: string) => text.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
      const factPhrases = payload.ALLOWED_FACTS.map(f => ({ key: f.field, phrase: words(f.value).join(' '), count: words(f.value).length }));
      const issues: Issue[] = output.issues.map((i, index) => {
        const loc = i.location;
        if ((loc.field === 'bullets') !== (loc.index !== undefined) || (loc.field === 'attributes') !== (loc.key !== undefined)) throw new AppError('invalid_review_location', 'Bad field location');
        const field = fields.find(f => f.location.field === loc.field && f.location.index === loc.index && f.location.key === loc.key);
        const occurrences = field?.text.split(i.text).length ?? 0;
        if (!field || occurrences - 1 <= (loc.occurrence ?? 0)) throw new AppError('invalid_review_quote', 'Bad quote');
        if (i.factKeys.some(k => !keys.has(k)) || new Set(i.factKeys).size !== i.factKeys.length) throw new AppError('invalid_review_reference', 'Bad fact reference');
        if (i.category === 'spec_conflict' && !i.factKeys.some(k => payload.ALLOWED_FACTS.some(f => f.field === k))) throw new AppError('invalid_review_reference', 'Conflict requires authorized evidence');
        if (i.category === 'unauthorized_fact' && !i.factKeys.some(k => payload.UNAUTHORIZED_FIELDS.some(f => f.field === k))) throw new AppError('invalid_review_reference', 'Authorization issue requires unauthorized field');
        const explanation = ` ${words(i.reason + ' ' + i.suggestedFix).join(' ')} `;
        for (const fact of factPhrases) {
          if (fact.count >= 2 && factPhrases.filter(other => other.phrase === fact.phrase).length === 1
            && explanation.includes(` ${fact.phrase} `) && !i.factKeys.includes(fact.key)) {
            throw new AppError('invalid_review_reference', 'Explicitly discussed authorized fact requires a reference');
          }
        }
        // Final findings must not contain the reviewer's discarded deliberation.
        // This catches explicit revision markers, not arbitrary semantic inconsistency.
        if (/(?:\bwait\s*[,;:]|\b(?:let['’]s\s+(?:look|check|reconsider)|on second thought|i (?:was wrong|misread)|this is (?:actually )?a match)\b)/i.test(i.reason)) throw new AppError('invalid_review_reason', 'Non-final review reasoning');
        const normalize = (value: string) => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
        if (i.category === 'spec_conflict' && i.factKeys.length === 1) {
          const evidence = payload.ALLOWED_FACTS.find(f => f.field === i.factKeys[0]);
          if (evidence && normalize(i.text) === normalize(evidence.value)) throw new AppError('invalid_review_reason', 'Identical values cannot establish the reported conflict');
        }
        // Prevent example quantities from becoming invented evidence/corrections.
        // This is a numeric provenance check, not proof of semantic entailment or unit conversion.
        const numbers = (s: string) => [...s.matchAll(/\d+(?:\.\d+)?/g)].map(m => Number(m[0]));
        const evidenceText = payload.ALLOWED_FACTS.filter(f => i.factKeys.includes(f.field)).map(f => f.value).join(' ');
        const knownNumbers = new Set(numbers(i.text + ' ' + evidenceText));
        if (numbers(i.reason + ' ' + i.suggestedFix).some(n => !knownNumbers.has(n))) throw new AppError('invalid_review_reference', 'Unsubstantiated numeric explanation');
        if (/<[^>]+>|https?:\/\/|sk-[a-zA-Z0-9_-]{12,}/i.test(i.reason + i.suggestedFix)) throw new AppError('invalid_review_output', 'Unsafe explanation');
        return { id: `B-${index + 1}`, severity: 'HIGH', title: i.category.replaceAll('_', ' '), ...i, origin: 'qwen' };
      });
      return { status: output.status, issues, metadata };
    } catch (error) {
      const safe = /^(live_ai_disabled|bailian_not_configured|bailian_timeout|bailian_auth_failed|bailian_http_\w+|bailian_connection_error|invalid_ai_response|invalid_ai_json|invalid_ai_schema|ai_output_limit|live_ai_budget_exhausted|insecure_tls_configuration|review_input_limit|invalid_review_reference|invalid_review_location|invalid_review_quote|invalid_review_output|invalid_review_reason)$/;
      metadata.errorCode = error instanceof AppError && safe.test(error.code) ? error.code : 'invalid_review_output';
      metadata.aiCallId ??= error instanceof AppError ? error.aiCallId : undefined;
      if (error instanceof AppError && error.validationIssues) metadata.validationIssues = error.validationIssues;
      metadata.modelCalled = !!metadata.aiCallId;
      if (metadata.aiCallId && this.options.rejectedAudit) await this.options.rejectedAudit(metadata.aiCallId, metadata.errorCode).catch(() => undefined);
      return { status: 'failed', issues: [], metadata };
    }
  }
}
export type ReviewRuntime = { mode: 'rules' | 'qwen'; model: string; provider?: QwenReviewProvider };
export const rulesReviewRuntime: ReviewRuntime = { mode: 'rules', model: '' };
export function createReviewRuntime(config: ServerConfig, text: TextModelProvider, rejectedAudit?: Options['rejectedAudit']): ReviewRuntime {
  return { mode: config.REVIEW_PROVIDER, model: config.BAILIAN_TEXT_MODEL, provider: config.REVIEW_PROVIDER === 'qwen' ? new QwenReviewProvider(text, { model: config.BAILIAN_TEXT_MODEL, liveEnabled: config.AI_LIVE_ENABLED, configured: !!config.BAILIAN_API_KEY, maxTokens: config.REVIEW_MAX_TOKENS, rejectedAudit }) : undefined };
}
