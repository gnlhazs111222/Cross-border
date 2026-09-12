import { createHash } from 'node:crypto';
import { AppError } from '../errors';
import type { Fact, Product, Task } from '../../src/types';
import type { ProductAsset } from '../../shared/contracts';
import { MULTIMODAL_PROMPT_VERSION, imageCheckFactPayload, localImageCheckFindings, type ImageCheckAsset, type ImageCheckFinding } from '../../shared/multimodal';
import { MULTIMODAL_SYSTEM_PROMPT, multimodalModelInput, multimodalModelPrompt } from '../prompts/multimodal-v2';
import { mapMultimodalFindings, multimodalOutputSchema } from './multimodalValidation';
import type { TextModelProvider } from './text';

/** Everything a check needs: the selected SKU, the pictures that may travel, and the resource findings files already prove. */
export type ImageCheckRequest = {
  product: Product; task: Task; facts: Fact[];
  images: { asset: ProductAsset; mimeType: string; dataUrl: string }[];
  assets: ImageCheckAsset[]; notes: string[];
};
export type ImageCheckOutcome = { findings: ImageCheckFinding[]; notes: string[]; aiCallId?: string; latencyMs?: number; fallbackReason?: string };
export interface ImageCheckProvider { readonly name: string; readonly model: string; /** False when the provider cannot see picture content, so nothing has to be read or sent. */ readonly readsPictures: boolean; analyze(request: ImageCheckRequest): Promise<ImageCheckOutcome> }

export class LocalImageCheckProvider implements ImageCheckProvider {
  readonly name = 'local';
  readonly model = 'local-resource-check';
  readonly readsPictures = false;
  /**
   * Offline mode cannot read picture content, so it reports every attribute that would need a look
   * as not_checked and keeps the resource findings the files themselves prove. It never guesses a value.
   */
  async analyze(request: ImageCheckRequest): Promise<ImageCheckOutcome> {
    const findings: ImageCheckFinding[] = localImageCheckFindings(request.facts, request.images[0]?.asset.fileName ?? '');
    return { findings, notes: [...request.notes, 'Local mode reads no picture content, so the listed attributes still need a person or a live multimodal model.'] };
  }
}

export class QwenImageCheckProvider implements ImageCheckProvider {
  readonly name = 'qwen';
  readonly readsPictures = true;
  constructor(private text: TextModelProvider, private options: { model: string; maxTokens: number }) {}
  get model() { return this.options.model; }
  async analyze(request: ImageCheckRequest): Promise<ImageCheckOutcome> {
    if (!request.images.length) return { findings: [], notes: [...request.notes, 'No picture was available, so no printed text could be compared.'] };
    try {
      return await this.compare(request);
    } catch (error) {
      // A failed live call must not block the fact card: keep the offline findings and say so.
      const reason = error instanceof AppError ? error.code : 'multimodal_failed';
      const fallback = await new LocalImageCheckProvider().analyze(request);
      return { ...fallback, notes: [...fallback.notes, `Live image check did not complete (${reason}); only the file-level checks ran.`],
        fallbackReason: reason, aiCallId: error instanceof AppError ? error.aiCallId : undefined };
    }
  }
  private async compare(request: ImageCheckRequest): Promise<ImageCheckOutcome> {
    const payload = multimodalModelInput({ sku: request.product.sku, name: request.product.name, category: request.product.category,
      platform: request.task.platform, market: request.task.market,
      images: request.images.map(image => ({ file: image.asset.fileName, role: image.asset.role })), facts: request.facts });
    const result = await this.text.generateStructured({
      prompt: multimodalModelPrompt(payload), purpose: 'image_check', systemPrompt: MULTIMODAL_SYSTEM_PROMPT, maxTokens: this.options.maxTokens,
      promptVersion: MULTIMODAL_PROMPT_VERSION, mode: 'vision' as const,
      inputHash: createHash('sha256').update(JSON.stringify({ payload, model: this.options.model })).digest('hex'),
      images: request.images.map(image => ({ fileName: image.asset.fileName, dataUrl: image.dataUrl })),
      schema: multimodalOutputSchema, example: { findings: [] },
    });
    // The model may only cite the pictures we sent and the facts we hold; anything else is dropped here.
    const mapped = mapMultimodalFindings(result.data, { facts: imageCheckFactPayload(request.facts).map(fact => ({ key: fact.field, value: fact.value })),
      images: request.images.map(image => ({ file: image.asset.fileName })) });
    return { findings: mapped.findings, notes: [...request.notes, ...mapped.dropped.map(reason => `Dropped a model finding · ${reason}`)],
      aiCallId: result.aiCallId, latencyMs: result.latencyMs };
  }
}