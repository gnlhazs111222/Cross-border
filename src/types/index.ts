export type Workspace = 'materials' | 'tasks' | 'evidence' | 'studio' | 'review';
export type Platform = 'amazon' | 'shopify';
export type Stage = 'initial' | 'materials_ready' | 'task_created' | 'sku_selected' | 'evidence_analyzed' | 'pricing_ready' | 'listing_generated' | 'review_blocked' | 'review_passed' | 'published';
export type Product = {
  sku: string; name: string; category: string; color: string; capacity: number;
  localizedCapacity: string; material: string; straw: boolean; countryOfOrigin: string;
  status: 'search_ready' | 'missing_data'; duplicateStatus: 'unique' | 'duplicate' | 'possible_duplicate';
  packagingWeight?: number; packagingDimensions?: string; supplierCost: number;
  missing: string[]; visual: 'bottle' | 'bag' | 'lamp';
};
export type Fact = {
  key: string; label: string; value: string; source: string; anchor: string;
  status: 'Confirmed' | 'Requires Confirmation'; allowed: boolean;
};
export type FactCard = { version: 1 | 2; sku: string; taskId?: string; facts: Fact[] };
export type Evidence = { id: string; name: string; type: 'sheet' | 'pdf' | 'image'; file: string; anchor: string; extracted: string[] };
export type Recommendation = { sku: string; score: number; reasons: string[]; deductions: string[] };
export type Task = { id: string; platform: string; market: string; category: string; requirements: string[]; minProfit: number };
export type Pricing = { version: 'v1'; status: 'ready' | 'blocked'; supplierCost: number; shipping: number; duty: number; platformCost: number; targetProfit: number; suggestedPrice: number | null; missing: string[] };
export type Listing = { platform: Platform; title: string; bullets: string[]; description: string; attributes: Record<string, string>; sources: Fact[]; revision: number; riskDemoInjected: boolean };
export type Issue = { id: string; severity: 'HIGH'; title: string; text: string; reason: string };
export type Review = { status: 'blocked' | 'passed'; revision: number; issues: Issue[] };
export type Publication = { platform: Platform; productId: string; status: string; revision: number };
export type DemoState = {
  schemaVersion: 1; workspace: Workspace; stage: Stage; history: Stage[];
  task: Task | null; selectedSku: string | null; v1: FactCard | null; v2: FactCard | null;
  pricing: Pricing | null; platform: Platform;
  listings: Partial<Record<Platform, Listing>>; reviews: Partial<Record<Platform, Review>>;
  publications: Partial<Record<Platform, Publication>>;
};
