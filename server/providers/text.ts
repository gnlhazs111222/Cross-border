import OpenAI from 'openai';
import type { PrismaClient } from '@prisma/client';
import type { z } from 'zod';
import type { ServerConfig } from '../config';
import { AppError } from '../errors';

export type TextRequest = { prompt: string; purpose: string; systemPrompt?: string; maxTokens?: number; promptVersion?: string; inputHash?: string; mode?: 'text' | 'reasoning' | 'premium' | 'vision'; /** Selected SKU pictures only: the multimodal module never ships the whole catalogue. */ images?: { fileName: string; dataUrl: string }[] };
export type TextResult = { aiCallId?: string; provider: 'mock' | 'bailian'; model: string; content: string; latencyMs: number; usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number } };
export interface TextModelProvider {
  generateText(request: TextRequest): Promise<TextResult>;
  generateStructured<T>(request: TextRequest & { schema: z.ZodType<T>; example: T }): Promise<TextResult & { data: T }>;
}
export class MockTextModelProvider implements TextModelProvider {
  async generateText(): Promise<TextResult> { return { provider: 'mock', model: 'mock-text-v1', content: 'Mock response: PrismLaunch is ready.', latencyMs: 0 }; }
  async generateStructured<T>(request: TextRequest & { schema: z.ZodType<T>; example: T }) { const data = request.schema.parse(request.example); return { ...await this.generateText(), content: JSON.stringify(data), data }; }
}
type AuditWriter = (row: { promptVersion?: string; inputHash?: string; provider: string; model: string; purpose: string; latencyMs: number; success: boolean; errorCode?: string; promptTokens?: number; completionTokens?: number; totalTokens?: number }) => Promise<unknown>;
export class BailianTextModelProvider implements TextModelProvider {
  private calls = 0;
  private client: OpenAI;
  constructor(private config: ServerConfig, private audit: AuditWriter, transport?: typeof fetch) {
    this.client = new OpenAI({ apiKey: config.BAILIAN_API_KEY || 'not-configured', baseURL: config.BAILIAN_BASE_URL, organization: null, project: null, logLevel: 'off', timeout: config.BAILIAN_REQUEST_TIMEOUT_MS, maxRetries: 0, ...(transport ? { fetch: transport } : {}) });
  }
  get remainingCalls() { return Math.max(0, this.config.AI_MAX_LIVE_CALLS_PER_SESSION - this.calls); }
  private model(mode: TextRequest['mode']) {
    if (mode === 'premium' && !this.config.AI_ALLOW_PREMIUM) throw new AppError('premium_disabled', 'Premium models require explicit opt-in.', 403);
    return mode === 'premium' ? this.config.BAILIAN_PREMIUM_MODEL : mode === 'reasoning' ? this.config.BAILIAN_REASONING_MODEL : mode === 'vision' ? this.config.BAILIAN_VL_MODEL : this.config.BAILIAN_TEXT_MODEL;
  }
  private async call<T>(request: TextRequest, structured?: { schema: z.ZodType<T>; example: T }): Promise<TextResult & { data?: T }> {
    if (!this.config.AI_LIVE_ENABLED) throw new AppError('live_ai_disabled', 'Live AI is disabled.', 403);
    if (!this.config.BAILIAN_API_KEY) throw new AppError('bailian_not_configured', 'Bailian is not configured.', 503);
    if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw new AppError('insecure_tls_configuration', 'Enable TLS certificate verification before live AI calls.', 503);
    if (this.remainingCalls === 0) throw new AppError('live_ai_budget_exhausted', 'The live AI call budget is exhausted.', 429);
    const model = this.model(request.mode);
    if (!model.startsWith('qwen')) throw new AppError('unsupported_model', 'Only configured Qwen models are enabled for this release.', 403);
    if (model === this.config.BAILIAN_PREMIUM_MODEL && request.mode !== 'premium') throw new AppError('premium_disabled', 'Premium models require explicit premium mode.', 403);
    this.calls++; // Reserve before awaiting: concurrent failures also consume the call budget.
    const started = Date.now();
    let usage: TextResult['usage'];
    try {
      const response = await this.client.chat.completions.create({
        model, messages: [
          { role: 'system', content: request.systemPrompt ?? (structured ? `Return only a JSON object with the same shape as this example: ${JSON.stringify(structured.example)}` : 'Reply briefly.') },
          { role: 'user', content: request.images?.length ? [{ type: 'text' as const, text: request.prompt }, ...request.images.map(image => ({ type: 'image_url' as const, image_url: { url: image.dataUrl } }))] : request.prompt },
        ], max_tokens: Math.min(3000, Math.max(1, request.maxTokens ?? 128)), temperature: 0,
        ...(structured ? { response_format: { type: 'json_object' as const } } : {}),
        ...{ enable_thinking: false },
      });
      usage = response.usage ? { prompt_tokens: response.usage.prompt_tokens, completion_tokens: response.usage.completion_tokens, total_tokens: response.usage.total_tokens } : undefined;
      if (response.choices[0]?.finish_reason === 'length') throw new AppError('ai_output_limit', 'The provider reached the output token limit.', 502);
      const content = response.choices[0]?.message.content;
      if (!content) throw new AppError('invalid_ai_response', 'The provider returned no text.', 502);
      let data: T | undefined;
      if (structured) {
        let parsed: unknown;
        try { parsed = JSON.parse(content); }
        catch { throw new AppError('invalid_ai_json', 'The provider returned invalid structured output.', 502); }
        const checked = structured.schema.safeParse(parsed);
        if (!checked.success) {
          const failure = new AppError(request.purpose === 'listing_review' ? 'invalid_ai_schema' : 'invalid_ai_json', 'The provider output failed field validation.', 502);
          // Keep constraint codes and known structural paths, never model values, messages or arbitrary keys.
          const safeKeys = new Set(['status', 'issues', 'category', 'location', 'field', 'index', 'key', 'occurrence', 'text', 'reason', 'factKeys', 'suggestedFix']);
          failure.validationIssues = checked.error.issues.slice(0, 8).map(issue => ({ code: issue.code, path: issue.path.slice(0, 8).map(part => typeof part === 'number' ? part : safeKeys.has(part) ? part : '[field]').join('.') || '$' }));
          throw failure;
        }
        data = checked.data;
      }
      const latencyMs = Date.now() - started;
      const audit = await this.audit({ promptVersion: request.promptVersion, inputHash: request.inputHash, provider: 'bailian', model, purpose: request.purpose, latencyMs, success: true, promptTokens: usage?.prompt_tokens, completionTokens: usage?.completion_tokens, totalTokens: usage?.total_tokens });
      return { aiCallId: audit && typeof audit === 'object' && 'id' in audit ? String(audit.id) : undefined, provider: 'bailian', model, content, latencyMs, usage, ...(structured ? { data } : {}) };
    } catch (error) {
      const code = error instanceof AppError ? error.code : error instanceof OpenAI.APIConnectionTimeoutError ? 'bailian_timeout' : error instanceof OpenAI.AuthenticationError ? 'bailian_auth_failed' : error instanceof OpenAI.APIError ? `bailian_http_${error.status ?? 'error'}` : 'bailian_connection_error';
      const audit = await this.audit({ promptVersion: request.promptVersion, inputHash: request.inputHash, provider: 'bailian', model, purpose: request.purpose, latencyMs: Date.now() - started, success: false, errorCode: code, promptTokens: usage?.prompt_tokens, completionTokens: usage?.completion_tokens, totalTokens: usage?.total_tokens });
      // Do not return upstream bodies, headers, full request prompts or SDK stack traces.
      const failure = new AppError(code, 'Bailian request failed. Check server configuration and the sanitized call log.', 502);
      if (error instanceof AppError) failure.validationIssues = error.validationIssues;
      if (audit && typeof audit === 'object' && 'id' in audit) failure.aiCallId = String(audit.id);
      throw failure;
    }
  }
  generateText(request: TextRequest) { return this.call(request); }
  async generateStructured<T>(request: TextRequest & { schema: z.ZodType<T>; example: T }) { const result = await this.call(request, request); return { ...result, data: result.data! }; }
}
export function createTextProviders(config: ServerConfig, db: PrismaClient, transport?: typeof fetch) {
  return { mock: new MockTextModelProvider(), bailian: new BailianTextModelProvider(config, row => db.aiCall.create({ data: row }), transport) };
}
