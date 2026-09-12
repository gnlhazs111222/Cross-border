import type { ServerConfig } from '../config';
import { LocalImageCheckProvider, QwenImageCheckProvider, type ImageCheckProvider } from './multimodal';
import type { TextModelProvider } from './text';

/**
 * Runtime factory for the multimodal module (business-flow module 4). Mirrors the listing, review and
 * recommendation runtimes: the mode comes from configuration, and a local provider keeps the module
 * fully usable — with honest "not checked" verdicts — when no vision model is configured.
 */
export type MultimodalRuntime = { mode: 'local' | 'qwen'; model: string; provider: ImageCheckProvider };
/**
 * Names of this endpoint's picture *generating* models. They answer a text prompt and refuse a chat
 * request that carries a picture: configuring one here can only ever end in bailian_http_400, so the
 * runtime says so out loud at startup instead of letting the first check look like a network fault.
 */
export const looksLikePictureGenerator = (model: string) => /(^|[-_])image|^wan/i.test(model);
export const localImageCheckRuntime: MultimodalRuntime = { mode: 'local', model: 'local-resource-check', provider: new LocalImageCheckProvider() };
export function createMultimodalRuntime(config: ServerConfig, text: TextModelProvider): MultimodalRuntime {
  if (config.MULTIMODAL_PROVIDER !== 'qwen') return localImageCheckRuntime;
  if (looksLikePictureGenerator(config.BAILIAN_VL_MODEL)) console.warn(`[multimodal] BAILIAN_VL_MODEL=${config.BAILIAN_VL_MODEL} looks like a picture-generating model: it refuses a chat request that carries a picture (bailian_http_400). Use a multimodal chat model such as qwen3.7-plus.`);
  return { mode: 'qwen', model: config.BAILIAN_VL_MODEL, provider: new QwenImageCheckProvider(text, { model: config.BAILIAN_VL_MODEL, maxTokens: config.MULTIMODAL_MAX_TOKENS }) };
}
