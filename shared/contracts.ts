import type { Fact, FactCard, Evidence, Pricing, Listing, Review, Publication, Platform, ImportReport, Product, Task } from '../src/types';

export type PublicUser = { id: string; email: string; displayName: string };
export type ServerProduct = Product & { recordId: string };
export type CatalogResponse = { products: ServerProduct[]; revision: number; factPreviews: Record<string, FactPreview>; report?: ImportReport };
export type ServerTask = Task & { recordId: string; selectedSku: string | null; selectionPurpose: string | null };
export type Capabilities = {
  backend: boolean; database: boolean; authentication: boolean;
  storage: { server: string[]; browser: string[] };
  textModel: { activeProvider: 'mock'; liveAvailable: boolean; configured: boolean; liveEnabled: boolean; model: string; remainingCalls: number };
  recommendation: { activeProvider: 'rule' | 'qwen'; liveAvailable: boolean; liveImplemented: true; liveModel: string };
  evidence: { activeProvider: 'mock'; liveAvailable: boolean; liveImplemented: false };
  listing: { activeProvider: 'template' | 'qwen'; liveAvailable: boolean; liveImplemented: true; liveModel: string };
  review: { activeProvider: 'rules' | 'qwen'; liveAvailable: boolean; liveImplemented: true; liveModel: string };
};

export type FactPreview = { v1: FactCard; product: Product; pricing: Pricing };
export type FactSnapshot = FactPreview & {
  productId: string; taskId: string; v2: FactCard | null; facts: Fact[]; evidence: Evidence[];
  factsRevision: number; listingFactsRevision: number; downstreamInvalidated: boolean;
  pricingReadiness: { ready: boolean; missing: string[] };
  listingReadiness: { ready: boolean; blockedFacts: string[] };
};

export type WorkflowSnapshot = {
  taskId: string; productId: string; factsRevision: number;
  heads: Partial<Record<Platform, { recordId: string; revision: number; status: string }>>;
  listings: Partial<Record<Platform, Listing>>;
  reviews: Partial<Record<Platform, Review>>;
  publications: Partial<Record<Platform, Publication>>;
  publishAllowed: Partial<Record<Platform, boolean>>;
};
