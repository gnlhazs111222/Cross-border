import type { Fact, FactCard, Evidence, Pricing, PricingContextSnapshot, Listing, Review, Publication, Platform, ImportReport, Product, Task } from '../src/types';
import type { FieldDifference } from './alignment';

export type PublicUser = { id: string; email: string; displayName: string };
export type ServerProduct = Product & { recordId: string };
export type CatalogResponse = { products: ServerProduct[]; revision: number; factPreviews: Record<string, FactPreview>; report?: ImportReport; batch?: ImportBatchDto };

/** How an imported row relates to the pool. `new` is the only verdict that creates a product. */
export type ImportVerdict = 'new' | 'same' | 'conflict' | 'probable' | 'duplicate' | 'invalid';
/** `edited` only ever comes from the check area: a person corrected the value by hand instead of taking the picture wording. */
export type ImportResolution = 'pending' | 'keep_existing' | 'use_incoming' | 'separate' | 'skipped' | 'edited';
export type ImportOccurrenceDto = {
  recordId: string; rowNumber: number; sku: string; name: string; verdict: ImportVerdict;
  resolution: ImportResolution; matchedProductId: string | null; matchedSku: string | null;
  conflicts: FieldDifference[]; payload: Record<string, unknown>;
  /** Fields this row is missing, so an import shows its data gaps instead of only its conflicts. */
  missing: string[];
};
export type ImportBatchDto = {
  recordId: string; fileName: string; mode: string; status: string; rowCount: number;
  createdProducts: number; counts: Record<ImportVerdict, number>; createdAt: string;
  /** The uploaded spreadsheet itself, kept so a batch stays verifiable after the fact. */
  source: { fileName: string; byteSize: number; sha256: string; mimeType: string } | null;
  /** Result of the URL download channel: images listed as links in the sheet. */
  urlDownloads: { downloaded: number; failed: number; failures: { url: string; reason: string }[] } | null;
};
export type ImportBatchDetail = { batch: ImportBatchDto; occurrences: ImportOccurrenceDto[]; gaps: { field: string; rows: number }[] };
/** A remembered bulk decision, so the same kind of conflict does not have to be reviewed twice. */
export type ImportRuleDto = { recordId: string; verdict: string; field: string; action: ImportResolution; appliedCount: number; createdAt: string };
export type ImportBulkResult = { batch: ImportBatchDetail; applied: number; skipped: number };
export type ServerTask = Task & { recordId: string; selectedSku: string | null; selectionPurpose: string | null; pricingSnapshot: PricingContextSnapshot };
export type AssetKind = 'image' | 'pdf';
export type AssetRole = 'main' | 'detail' | 'packaging' | 'spec' | 'other';
export type AssetParseStatus = 'pending' | 'parsed' | 'failed';
/** Source material uploaded for one SKU. Pool-level: it is not tied to a task or a fact-card version. */
export type ProductAsset = {
  recordId: string; sku: string; kind: AssetKind; role: AssetRole;
  fileName: string; mimeType: string; byteSize: number; sha256: string;
  parseStatus: AssetParseStatus; uploadedAt: string;
};
export type Capabilities = {
  backend: boolean; database: boolean; authentication: boolean;
  storage: { server: string[]; browser: string[] };
  assets: { storage: 'server'; acceptedTypes: string[]; maxBytesPerFile: number; maxPerProduct: number };
  textModel: { activeProvider: 'mock'; liveAvailable: boolean; configured: boolean; liveEnabled: boolean; model: string; remainingCalls: number };
  recommendation: { activeProvider: 'rule' | 'qwen'; liveAvailable: boolean; liveImplemented: true; liveModel: string };
  /** Module 4: printed-text-versus-fact checking. local reads no printed words, qwen uses a vision model. */
  evidence: { activeProvider: 'local' | 'qwen'; liveAvailable: boolean; liveImplemented: true; liveModel: string };
  listing: { activeProvider: 'template' | 'qwen'; liveAvailable: boolean; liveImplemented: true; liveModel: string };
  review: { activeProvider: 'rules' | 'qwen'; liveAvailable: boolean; liveImplemented: true; liveModel: string };
};

export type FactPreview = { v1: FactCard; product: Product; pricing: Pricing };
export type FactSnapshot = FactPreview & {
  productId: string; taskId: string; v2: FactCard | null; facts: Fact[]; evidence: Evidence[]; assets: ProductAsset[];
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
