import { amazonCsv } from '../../shared/csv';
import { baseFactCard, effectiveProduct, pricingFromFacts, productEvidence, reviewFact } from '../../shared/facts';
import type { WorkflowSnapshot, FactSnapshot, FactPreview } from '../../shared/contracts';
import { apiClient, SERVER_MODE } from './apiClient';
import { enrichProductEvidence, makeTemplateListing, rankProducts, reviewAgainstTemplate } from '../../shared/domain';
import { demoTask, products as builtInProducts } from '../data/mockData';
import { PRICING_FACTS, REQUIRED_COPY_FACTS, editableFact, factEditor } from './factReview';
import { SUPPLIER_COLUMNS } from '../data/supplierTemplate';
import type { DemoState, Evidence, Fact, FactCard, ImportMode, ImportPreview, Listing, Platform, Pricing, Product, Recommendation, Stage, Workspace } from '../types';

export const STORAGE_KEY = 'prismlaunch.demo.v1';
const delay = (ms = 420) => new Promise<void>(resolve => setTimeout(resolve, ms));
const clone = <T,>(value: T): T => structuredClone(value);
const initialState = (): DemoState => ({
  schemaVersion: 1, workspace: 'materials', stage: 'initial', history: ['initial'],
  catalog: clone(builtInProducts), datasetSource: 'builtin', importReport: null, factEdits: {},
  task: null, selectedSku: null, v1: null, v2: null, pricing: null, platform: 'amazon',
  listings: {}, reviews: {}, publications: {},
});
let storageAvailable = true;
function hydrate(input?: string | null): DemoState {
  try {
    const raw = input === undefined ? localStorage.getItem(STORAGE_KEY) : input;
    if (!raw) return initialState();
    const s = JSON.parse(raw) as DemoState;
    if (!SERVER_MODE && s.ownerId) return initialState();
    // Migrate existing v1 browser sessions without discarding their launch progress.
    s.catalog ??= clone(builtInProducts);
    s.datasetSource ??= 'builtin';
    s.importReport ??= null;
    s.factEdits ??= {};
    if (!s.factEdits || Array.isArray(s.factEdits) || typeof s.factEdits !== 'object'
      || !Object.values(s.factEdits).every(edits => edits && typeof edits === 'object' && Object.values(edits).every(f =>
        f && typeof f.key === 'string' && typeof f.value === 'string' && typeof f.source === 'string'
        && ['Confirmed', 'Requires Confirmation', 'Rejected', 'Missing'].includes(f.status)))) return initialState();
    if (!Array.isArray(s.catalog) || s.catalog.length > 500 || !s.catalog.every(p =>
      p && typeof p.sku === 'string' && typeof p.name === 'string' && typeof p.category === 'string'
      && typeof p.color === 'string' && typeof p.material === 'string' && typeof p.countryOfOrigin === 'string'
      && typeof p.capacity === 'number' && typeof p.localizedCapacity === 'string'
      && typeof p.straw === 'boolean' && typeof p.supplierCost === 'number' && Array.isArray(p.missing)
      && ['search_ready', 'missing_data'].includes(p.status)
      && ['unique', 'duplicate', 'possible_duplicate'].includes(p.duplicateStatus))) return initialState();
    if (s.schemaVersion !== 1 || !['materials', 'tasks', 'evidence', 'studio', 'review'].includes(s.workspace)
      || !['amazon', 'shopify'].includes(s.platform) || !Array.isArray(s.history)
      || !s.listings || !s.reviews || !s.publications
      || (s.selectedSku && !s.catalog.some(p => p.sku === s.selectedSku))) return initialState();
    for (const platform of ['amazon', 'shopify'] as const) {
      const listing = s.listings[platform];
      if (listing && (!Array.isArray(listing.bullets) || !Array.isArray(listing.sources) || typeof listing.title !== 'string' || typeof listing.description !== 'string' || !listing.attributes)) return initialState();
      const review = s.reviews[platform];
      if (review && !Array.isArray(review.issues)) return initialState();
    }
    if ((s.v1 && !Array.isArray(s.v1.facts)) || (s.v2 && !Array.isArray(s.v2.facts))) return initialState();
    return s;
  } catch { return initialState(); }
}
let current = SERVER_MODE ? initialState() : hydrate();
let serverOwner: string | null = null;
let serverPreviews: Record<string, FactPreview> = {};
let serverSnapshots: Record<string, FactSnapshot> = {};
let serverWorkflow: WorkflowSnapshot | null = null;
function applyWorkflow(workflow: WorkflowSnapshot) {
  serverWorkflow = clone(workflow);
  current.listings = clone(workflow.listings); current.reviews = clone(workflow.reviews); current.publications = clone(workflow.publications);
  const platform = current.platform;
  if (current.publications[platform]) advance('published');
  else if (current.reviews[platform]) advance(current.reviews[platform]!.status === 'passed' ? 'review_passed' : 'review_blocked');
  else if (current.listings[platform]) advance('listing_generated');
  else if (current.v2) advance(current.pricing?.status === 'ready' ? 'pricing_ready' : 'evidence_analyzed');
  else advance(current.selectedSku ? 'sku_selected' : current.task ? 'task_created' : 'materials_ready');
}
async function refreshWorkflow() {
  if (serverOwner && current.task && current.selectedSku) applyWorkflow(await apiClient.listings.list(current.task.recordId!, selected().recordId!));
}
async function serverAction(action: () => Promise<WorkflowSnapshot>) {
  try { applyWorkflow(await action()); return save(); }
  catch (error) { await refreshServerFacts(); await refreshWorkflow(); save(); throw error; }
}
function activeServerListing() {
  const listing = current.listings[current.platform];
  if (!listing?.recordId) throw new Error('Generate a listing first.');
  return listing;
}

function applySnapshot(snapshot: FactSnapshot) {
  serverSnapshots[snapshot.product.sku] = clone(snapshot);
  if (current.selectedSku !== snapshot.product.sku) return;
  const changed = current.factsRevision !== snapshot.factsRevision;
  current.v1 = clone(snapshot.v1); current.v2 = clone(snapshot.v2); current.pricing = clone(snapshot.pricing);
  current.factsRevision = snapshot.factsRevision; current.factEdits = {};
  if (changed || snapshot.downstreamInvalidated) {
    serverWorkflow = null; current.listings = {}; current.reviews = {}; current.publications = {};
    advance(snapshot.v2 ? snapshot.pricingReadiness.ready ? 'pricing_ready' : 'evidence_analyzed' : 'sku_selected');
  }
}
async function refreshServerFacts() {
  if (!serverOwner || !current.selectedSku || !current.task) return;
  applySnapshot(await apiClient.facts.getSnapshot(current.task.recordId!, selected().recordId!)); save();
}
async function mutateServerFact(key: string, action: 'edit' | 'confirm' | 'reject', value?: string) {
  const before = findCurrentFact(key);
  try {
    const snap = action === 'edit' ? await apiClient.facts.update(before.recordId!, value ?? '', current.factsRevision!) : await apiClient.facts[action](before.recordId!, current.factsRevision!);
    applySnapshot(snap);
    await refreshWorkflow();
    advance(snap.pricingReadiness.ready ? 'pricing_ready' : snap.v2 ? 'evidence_analyzed' : 'sku_selected');
    return save();
  } catch (error) { await refreshServerFacts(); throw error; }
}

let pendingImport: ImportPreview | null = null;
function save() {
  try {
    const payload = JSON.stringify({ ...current, ...(serverOwner ? { ownerId: serverOwner } : {}) });
    localStorage.setItem(STORAGE_KEY, payload);
    if (serverOwner) localStorage.setItem(`${STORAGE_KEY}:${serverOwner}`, payload);
    storageAvailable = true;
  }
  catch { storageAvailable = false; }
  return clone(current);
}
function advance(stage: Stage) {
  current.stage = stage;
  if (current.history.at(-1) !== stage) current.history.push(stage);
}
function selected(): Product {
  const product = current.catalog.find(p => p.sku === current.selectedSku);
  if (!product) throw new Error('Select a product first.');
  return product;
}
function eligible(p: Product) {
  return p.status === 'search_ready' && p.duplicateStatus === 'unique' && p.category === demoTask.category;
}
function cardV1(p: Product): FactCard {
  if (serverOwner) return clone(serverSnapshots[p.sku]?.v1 ?? serverPreviews[p.sku].v1);
  const card = baseFactCard(p);
  return { ...card, facts: card.facts.map(f => clone(editsFor(p.sku)[f.key] ?? f)) };
}
function editsFor(sku: string): Record<string, Fact> { return Object.hasOwn(current.factEdits, sku) ? current.factEdits[sku] : {}; }
function factRevision(sku: string, keys?: string[]) {
  if (serverOwner) return serverSnapshots[sku]?.factsRevision ?? 0;
  return Object.values(editsFor(sku)).filter(f => !keys || keys.includes(f.key)).reduce((sum, f) => sum + (f.revision ?? 0), 0);
}
function productView(p: Product): Product {
  if (serverOwner) return clone(serverSnapshots[p.sku]?.product ?? serverPreviews[p.sku].product);
  return Object.keys(editsFor(p.sku)).length ? effectiveProduct(p, [...cardV1(p).facts, ...Object.values(editsFor(p.sku)).filter(f => !cardV1(p).facts.some(b => b.key === f.key))]) : clone(p);
}
function pricingFor(p: Product): Pricing {
  return serverOwner ? clone(serverSnapshots[p.sku]?.pricing ?? serverPreviews[p.sku].pricing) : pricingFromFacts(p, cardV1(p).facts, factRevision(p.sku, PRICING_FACTS));
}
function synchronizeFacts() {
  if (serverOwner) return;
  if (!current.selectedSku) return;
  current.v1 = cardV1(selected());
  if (current.v2) {
    const baseKeys = new Set(current.v1.facts.map(f => f.key));
    current.v2 = { ...current.v2, facts: [...clone(current.v1.facts), ...current.v2.facts.filter(f => !baseKeys.has(f.key)).map(f => clone(editsFor(current.selectedSku!)[f.key] ?? f))] };
  }
}
function findCurrentFact(key: string): Fact {
  const f = (current.v2 ?? current.v1)?.facts.find(f => f.key === key);
  if (!f || !current.selectedSku) throw new Error('Open Fact Review for a product first.');
  return f;
}
function changeFact(key: string, action: 'edit' | 'confirm' | 'reject', input?: string) {
  const before = findCurrentFact(key);
  const updated = reviewFact(before, action, input);
  const sku = current.selectedSku!;
  current.factEdits = { ...current.factEdits, [sku]: { ...editsFor(sku), [key]: updated } };
  synchronizeFacts();
  // Both platforms depend on this product's facts and price. Never retain an old approval.
  current.listings = {}; current.reviews = {}; current.publications = {};
  current.pricing = pricingFor(selected());
  advance(current.pricing.status === 'ready' ? 'pricing_ready' : current.v2 ? 'evidence_analyzed' : 'sku_selected');
  return save();
}
function safeListing(platform: Platform, revision = 1): Listing {
  if (!current.v2 || current.pricing?.status !== 'ready') throw new Error('Analyze evidence and resolve pricing before generating a listing.');
  if (selected().duplicateStatus !== 'unique' || selected().category !== demoTask.category) throw new Error('Duplicate or out-of-category products cannot generate listings for this task.');
  return makeTemplateListing({ factCard: serverOwner ? serverSnapshots[current.selectedSku!].v2! : current.v2, pricing: current.pricing!, platform, revision, factRevision: factRevision(current.selectedSku!) });
}
function reviewIssues(listing: Listing) { return reviewAgainstTemplate(listing, safeListing(listing.platform, listing.revision)); }

export const mockApi = {
  getState: () => clone(current),
  async connectServer(userId: string) {
    const [catalog, tasks] = await Promise.all([apiClient.products.list(), apiClient.tasks.list()]);
    let cached = initialState();
    let corruptActiveCache = false;
    try {
      const active = localStorage.getItem(STORAGE_KEY);
      // Corrupt active state resets browser-only work; it never rewrites server products/tasks.
      const activeData = active ? JSON.parse(active) : null;
      const raw = activeData?.ownerId === userId ? active : localStorage.getItem(`${STORAGE_KEY}:${userId}`);
      if (raw) { const candidate = JSON.parse(raw); if (candidate.ownerId === userId && candidate.serverRevision === catalog.revision) cached = hydrate(raw); }
    } catch { cached = initialState(); corruptActiveCache = true; }
    serverOwner = userId;
    const task = tasks[0] ?? null;
    const selectedSku = corruptActiveCache ? null : task?.selectedSku ?? null;
    serverPreviews = catalog.factPreviews; serverSnapshots = {}; serverWorkflow = null;
    const importedCount = catalog.products.filter(p => p.importSource).length;
    current = { ...cached, catalog: catalog.products, serverRevision: catalog.revision, task, selectedSku, datasetSource: !importedCount ? 'builtin' : importedCount === catalog.products.length ? 'imported' : 'mixed' };
    if (!selectedSku) { current.v1 = null; current.v2 = null; current.pricing = null; current.listings = {}; current.reviews = {}; current.publications = {}; }
    current.listings = {}; current.reviews = {}; current.publications = {};
    current.factEdits = {}; current.v1 = null; current.v2 = null; current.pricing = null;
    if (task) {
      const snapshots = await apiClient.facts.list(task.recordId);
      for (const snap of snapshots) serverSnapshots[snap.product.sku] = snap;
      if (selectedSku) applySnapshot(serverSnapshots[selectedSku] ?? await apiClient.facts.createV1(task.recordId, selectedSku));
    }
    if (selectedSku) await refreshWorkflow();
    else advance(task ? 'task_created' : 'materials_ready');
    return save();
  },
  disconnectServer() { if (serverOwner) { try { localStorage.removeItem(STORAGE_KEY); } catch { /* in-memory logout */ } } serverOwner = null; serverSnapshots = {}; serverWorkflow = null; serverPreviews = {}; pendingImport = null; current = initialState(); },
  isStorageAvailable: () => storageAvailable,
  catalog: () => current.catalog.map(productView),
  async getCatalog() { await delay(180); return current.catalog.map(productView); },
  factEditor, editableFact,
  listingReady() { return !!current.v2 && !!current.selectedSku && selected().duplicateStatus === 'unique' && selected().category === demoTask.category && current.pricing?.status === 'ready' && REQUIRED_COPY_FACTS.every(key => current.v2!.facts.some(f => f.key === key && f.status === 'Confirmed' && f.allowed)); },
  getTaskTemplate: () => clone(demoTask),
  async ready() { synchronizeFacts(); if (current.pricing && current.selectedSku) current.pricing = pricingFor(selected()); if (current.stage === 'initial') advance('materials_ready'); return save(); },
  navigate(workspace: Workspace) { current.workspace = workspace; return save(); },
  async reset() { await delay(180); const data = serverOwner ? await apiClient.reset() : null; pendingImport = null; current = initialState(); serverSnapshots = {}; serverWorkflow = null; if (data) { serverPreviews = data.factPreviews; current.catalog = data.products; current.serverRevision = data.revision; } return save(); },
  async loadBuiltInDataset() { await this.reset(); advance('materials_ready'); return save(); },
  getSupplierTemplate: () => [...SUPPLIER_COLUMNS],
  async previewSupplierFile(file: File, mode: ImportMode): Promise<ImportPreview> {
    pendingImport = null;
    const { parseSupplierFile } = await import('./supplierImport');
    pendingImport = await parseSupplierFile(file, mode, current.catalog);
    if (mode === 'append' && current.catalog.length + pendingImport.products.length > 500) {
      pendingImport = null;
      throw new Error('Too many products. Keep the dataset within 500 products.');
    }
    return clone(pendingImport);
  },
  async importSupplierFile() {
    await delay(180);
    const preview = pendingImport;
    if (!preview?.products.length) throw new Error('No valid new products to import. The current dataset is unchanged.');
    if (serverOwner) {
      const result = await apiClient.products.import(preview, current.serverRevision!);
      serverSnapshots = {}; serverWorkflow = null; serverPreviews = result.factPreviews;
      current = { ...initialState(), catalog: result.products, serverRevision: result.revision, datasetSource: preview.mode === 'append' ? 'mixed' : 'imported', importReport: clone(result.report ?? preview) };
      advance('materials_ready'); pendingImport = null; return save();
    }
    const catalog = preview.mode === 'append' ? [...current.catalog, ...preview.products] : preview.products;
    if (new Set(catalog.map(p => p.sku)).size !== catalog.length) throw new Error('The dataset changed. Preview the file again.');
    const { products: importedProducts, ...report } = preview;
    void importedProducts;
    current = { ...initialState(), catalog: clone(catalog), datasetSource: preview.mode === 'append' ? 'mixed' : 'imported', importReport: clone(report) };
    advance('materials_ready'); pendingImport = null;
    return save();
  },
  async createTask() {
    await delay();
    if (current.stage === 'initial') advance('materials_ready');
    if (!current.task) { current.task = serverOwner ? await apiClient.tasks.create(demoTask) : clone(demoTask); advance('task_created'); }
    current.workspace = 'tasks'; return save();
  },
  recommendations(): Recommendation[] {
    return current.task ? rankProducts(current.catalog.map(productView), current.task) : [];
  },
  exclusionReason(p: Product) {
    if (p.duplicateStatus === 'duplicate') return 'Exact duplicate · excluded from recommendations';
    if (p.duplicateStatus === 'possible_duplicate') return 'Possible duplicate · human verification required';
    if (p.status === 'missing_data') return `Missing ${p.missing.join(', ')} · excluded from recommendations`;
    if (p.category !== demoTask.category) return 'Category mismatch · outside Home & Kitchen';
    return 'Eligible for the candidate pool';
  },
  isEligible: (p: Product) => eligible(productView(p)),
  previewPricing: (sku: string) => { const p = current.catalog.find(p => p.sku === sku); if (!p) throw new Error('Unknown SKU'); return pricingFor(p); },
  getFacts: (sku: string) => { const p = current.catalog.find(p => p.sku === sku); if (!p) throw new Error('Unknown SKU'); return cardV1(p); },
  async selectSku(sku: string) {
    await delay();
    if (!current.task) throw new Error('Create a launch task first.');
    const p = current.catalog.find(p => p.sku === sku);
    if (!p || !eligible(productView(p))) throw new Error('This product is not eligible for recommendation. Inspect missing data in Materials.');
    if (serverOwner) current.task = await apiClient.tasks.select(current.task.recordId ?? current.task.id, sku, 'selected');
    if (current.selectedSku !== sku) {
      current.selectedSku = sku; current.v1 = cardV1(p); current.v2 = null; current.pricing = null;
      current.listings = {}; current.reviews = {}; current.publications = {}; advance('sku_selected');
    }
    if (serverOwner) { applySnapshot(await apiClient.facts.createV1(current.task.recordId!, p.recordId!)); await refreshWorkflow(); }
    // Preserve the selected-hero story: its pricing appears after Analyze, while Fact Review can preview it immediately.
    if (!current.v2 && current.pricing?.status === 'ready') current.pricing = null;
    current.workspace = 'evidence'; return save();
  },
  async openFactReview(sku: string) {
    await delay(180);
    const p = current.catalog.find(p => p.sku === sku);
    if (!p) throw new Error('Unknown SKU');
    if (!current.task) current.task = serverOwner ? await apiClient.tasks.create(demoTask) : clone(demoTask);
    if (serverOwner) current.task = await apiClient.tasks.select(current.task.recordId ?? current.task.id, sku, 'fact_review');
    if (current.selectedSku !== sku) {
      current.selectedSku = sku; current.v1 = cardV1(p); current.v2 = null;
      current.listings = {}; current.reviews = {}; current.publications = {};
      advance('sku_selected');
    }
    if (serverOwner) { applySnapshot(await apiClient.facts.createV1(current.task.recordId!, p.recordId!)); await refreshWorkflow(); }
    current.pricing = pricingFor(p); current.workspace = 'evidence';
    return save();
  },
  async editFact(key: string, value: string) { await delay(180); return serverOwner ? mutateServerFact(key, 'edit', value) : changeFact(key, 'edit', value); },
  async confirmFact(key: string) { await delay(180); return serverOwner ? mutateServerFact(key, 'confirm') : changeFact(key, 'confirm'); },
  async rejectFact(key: string) { await delay(180); return serverOwner ? mutateServerFact(key, 'reject') : changeFact(key, 'reject'); },
  evidence(sku: string): Evidence[] {
    if (serverOwner) return clone(serverSnapshots[sku]?.evidence ?? []);
    const p = current.catalog.find(p => p.sku === sku);
    return p ? productEvidence(p) : [];
  },
  async analyzeEvidence() {
    await delay(700);
    const p = selected();
    if (!current.v1 || !current.task) throw new Error('Select a product and task first.');
    if (serverOwner) {
      applySnapshot(await apiClient.facts.analyze(current.task.recordId!, p.recordId!, current.factsRevision!));
      advance('evidence_analyzed'); if (current.pricing?.status === 'ready') advance('pricing_ready'); return save();
    }
    if (!current.v2) {
      current.v2 = enrichProductEvidence(p, current.v1, current.task);
      synchronizeFacts();
      advance('evidence_analyzed');
      current.pricing = pricingFor(p);
      if (current.pricing.status === 'ready') advance('pricing_ready');
    }
    return save();
  },
  setPlatform(platform: Platform) {
    current.platform = platform;
    const review = current.reviews[platform];
    if (current.publications[platform]) advance('published');
    else if (review) advance(review.status === 'passed' ? 'review_passed' : 'review_blocked');
    else if (current.listings[platform]) advance('listing_generated');
    else if (current.pricing?.status === 'ready') advance('pricing_ready');
    return save();
  },
  async generateListing() {
    await delay(600);
    if (serverOwner) return serverAction(() => apiClient.listings.create(current.task!.recordId!, selected().recordId!, current.platform, serverWorkflow?.heads[current.platform]?.revision ?? 0, current.factsRevision!));
    await refreshServerFacts();
    const previous = current.listings[current.platform];
    const listing = safeListing(current.platform, (previous?.revision ?? 0) + 1);
    // Intentional isolated demo fixture: the only generated claim outside the allowlist.
    if (current.platform === 'amazon' && !previous) { listing.bullets[2] = '100% leakproof'; listing.riskDemoInjected = true; }
    current.listings[current.platform] = listing;
    delete current.reviews[current.platform]; delete current.publications[current.platform];
    advance('listing_generated'); return save();
  },
  async editListing(edit: Pick<Listing, 'title' | 'bullets' | 'description'>) {
    await delay(200);
    if (serverOwner) { const l = activeServerListing(); return serverAction(() => apiClient.listings.update(l.recordId!, edit, l.revision, current.factsRevision!)); }
    await refreshServerFacts();
    const listing = current.listings[current.platform];
    if (!listing) throw new Error('Generate a listing first.');
    Object.assign(listing, clone(edit)); listing.revision += 1;
    delete current.reviews[current.platform]; delete current.publications[current.platform];
    advance('listing_generated'); return save();
  },
  async runReview() {
    await delay(650);
    if (serverOwner) { const l = activeServerListing(); return serverAction(() => apiClient.reviews.run(l.recordId!, l.revision, current.factsRevision!)); }
    await refreshServerFacts();
    const listing = current.listings[current.platform];
    if (!listing) throw new Error('Generate a listing first.');
    const issues = reviewIssues(listing);
    current.reviews[current.platform] = { status: issues.length ? 'blocked' : 'passed', revision: listing.revision, issues };
    delete current.publications[current.platform];
    advance(issues.length ? 'review_blocked' : 'review_passed'); return save();
  },
  async applyFix() {
    await delay(350);
    if (serverOwner) { const l = activeServerListing(); return serverAction(() => apiClient.listings.applySuggestedFix(l.recordId!, l.revision, current.factsRevision!)); }
    await refreshServerFacts();
    const listing = current.listings[current.platform];
    if (!listing) throw new Error('Generate a listing first.');
    current.listings[current.platform] = safeListing(current.platform, listing.revision + 1);
    delete current.reviews[current.platform]; delete current.publications[current.platform];
    advance('listing_generated'); return save();
  },
  canPublish() {
    if (serverOwner) return !!serverWorkflow?.publishAllowed[current.platform];
    if (!this.listingReady()) return false;
    const listing = current.listings[current.platform]; const review = current.reviews[current.platform];
    return !!listing && (listing.factRevision ?? 0) === factRevision(current.selectedSku!) && review?.status === 'passed' && review.revision === listing.revision && current.pricing?.status === 'ready' && reviewIssues(listing).length === 0;
  },
  async publish() {
    await delay(750);
    if (serverOwner) { const l = activeServerListing(); return serverAction(() => apiClient.publish.create(l.recordId!, l.revision, current.factsRevision!)); }
    await refreshServerFacts();
    if (!this.canPublish()) throw new Error('Publish blocked: the current revision must pass review.');
    const platform = current.platform;
    current.publications[platform] = { platform, productId: platform === 'shopify' ? 'SHOP-DEMO-1042' : 'AMZ-DEMO-1042', status: platform === 'shopify' ? 'Draft' : 'Export ready', revision: current.listings[platform]!.revision };
    advance('published'); return save();
  },
  async exportCsv() {
    if (serverOwner) {
      const id = current.publications.amazon?.recordId;
      if (!id) throw new Error('Publish the reviewed Amazon draft before exporting.');
      try { return await apiClient.publish.amazonCsv(id); }
      catch (error) { await refreshServerFacts(); await refreshWorkflow(); save(); throw error; }
    }
    await refreshServerFacts();
    if (current.platform !== 'amazon' || !current.publications.amazon || !this.canPublish()) throw new Error('Publish the reviewed Amazon draft before exporting.');
    const listing = current.listings.amazon!;
    return amazonCsv(current.selectedSku!, listing, current.pricing!.suggestedPrice!);
  },
};
