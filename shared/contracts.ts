import type { Fact, FactCard, Evidence, Pricing, ImportReport, Product, Task } from '../src/types';

export type PublicUser = { id: string; email: string; displayName: string };
export type ServerProduct = Product & { recordId: string };
export type CatalogResponse = { products: ServerProduct[]; revision: number; factPreviews: Record<string, FactPreview>; report?: ImportReport };
export type ServerTask = Task & { recordId: string; selectedSku: string | null; selectionPurpose: string | null };
export type Capabilities = {
  backend: boolean; database: boolean; authentication: boolean;
  storage: { server: string[]; browser: string[] };
  textModel: { activeProvider: 'mock'; liveAvailable: boolean; configured: boolean; liveEnabled: boolean; model: string; remainingCalls: number };
  recommendation: { activeProvider: 'mock'; liveAvailable: boolean; liveImplemented: false };
  evidence: { activeProvider: 'mock'; liveAvailable: boolean; liveImplemented: false };
  listing: { activeProvider: 'template'; liveAvailable: boolean; liveImplemented: false };
  review: { activeProvider: 'rules'; liveAvailable: boolean; liveImplemented: false };
};

export type FactPreview = { v1: FactCard; product: Product; pricing: Pricing };
export type FactSnapshot = FactPreview & {
  productId: string; taskId: string; v2: FactCard | null; facts: Fact[]; evidence: Evidence[];
  factsRevision: number; downstreamInvalidated: boolean;
  pricingReadiness: { ready: boolean; missing: string[] };
  listingReadiness: { ready: boolean; blockedFacts: string[] };
};
