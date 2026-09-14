import { eligibilityReason, type RecommendationSnapshot } from '../../shared/recommendation';
import { sameCategory } from '../../shared/categories';
import { matchAssetFiles } from '../../shared/asset-match';
import { systemForMarket, type UnitSystem } from '../../shared/units';
import { amazonCsv } from '../../shared/csv';
import { baseFactCard, effectiveProduct, pricingFromFacts, productEvidence, reviewFact, variesFromSupplier } from '../../shared/facts';
import type { WorkflowSnapshot, FactSnapshot, FactPreview, ProductAsset, AssetRole, ImportBatchDto, ImportBatchDetail, ImportBulkResult, ImportResolution, ImportRuleDto } from '../../shared/contracts';
import { apiClient, SERVER_MODE } from './apiClient';
import { enrichProductEvidence, makeTemplateListing, rankProducts, reviewAgainstTemplate } from '../../shared/domain';
import { bagDemoTask, demoTask, newTaskTemplate, products as builtInProducts } from '../data/mockData';
import { COPY_FACTS, requiredCopyFactsFor, PRICING_FACTS, editableFact, factEditor } from './factReview';
import { QUALITY_REPORT_COLUMNS, SUPPLIER_COLUMNS } from '../data/supplierTemplate';
import { IMAGE_CHECK_SOURCE, MULTIMODAL_PROMPT_VERSION, describeImageAssets, factImageCheck, imageCheckCounts, imageCheckFindingText, localImageCheckFindings, type ImageCheckEvidence, type ImageCheckResult } from '../../shared/multimodal';
import { appliedFactDecision, type CheckDecisionTarget } from '../../shared/checks';
import type { CheckDecisionRequest } from '../../server/services/checks';
import type { DemoState, Evidence, Fact, FactCard, ImportMode, ImportPreview, Listing, Platform, Pricing, Product, Recommendation, Stage, Task, Workspace } from '../types';

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
let serverRecommendation: RecommendationSnapshot | null = null;
let serverAssets: Record<string, ProductAsset[]> = {};
let lastImportBatch: ImportBatchDto | null = null;
let pendingSourceFile: { fileName: string; mimeType: string; contentBase64: string } | null = null;
const SOURCE_MIME: Record<string, string> = { csv: 'text/csv', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
/** Keeps the uploaded spreadsheet so the server can store it alongside the parsed rows. */
function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the selected file.'));
    reader.onload = () => { const result = String(reader.result ?? ''); const comma = result.indexOf(','); resolve(comma < 0 ? '' : result.slice(comma + 1)); };
    reader.readAsDataURL(file);
  });
}
async function refreshRecommendation() {
  serverRecommendation = serverOwner && current.task ? await apiClient.recommendations.get(current.task.recordId!) : null;
}
async function useServerTask(task: Task) {
  current.task = task; current.platform = task.platform === 'Shopify US' ? 'shopify' : 'amazon'; current.selectedSku = null; current.v1 = null; current.v2 = null; current.pricing = null; current.factsRevision = undefined; current.listingFactsRevision = undefined;
  current.listings = {}; current.reviews = {}; current.publications = {}; serverWorkflow = null; serverSnapshots = {};
  for (const snap of await apiClient.facts.list(task.recordId!)) serverSnapshots[snap.product.sku] = snap;
  await refreshRecommendation(); current.workspace = 'tasks'; advance('task_created'); return save();
}

function applyWorkflow(workflow: WorkflowSnapshot) {
  serverWorkflow = clone(workflow);
  current.listings = clone(workflow.listings); current.reviews = clone(workflow.reviews); current.publications = clone(workflow.publications);
  const platform = current.platform;
  if (current.publications[platform]) advance('published');
  else if (current.reviews[platform]) advance(workflow.publishAllowed[platform] || (current.reviews[platform]!.status === 'passed' && current.pricing?.status !== 'ready') ? 'review_passed' : current.reviews[platform]!.status === 'blocked' ? 'review_blocked' : 'listing_generated');
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
  serverAssets[snapshot.product.sku] = clone(snapshot.assets ?? []);
  if (current.selectedSku !== snapshot.product.sku) return;
  // Only copy facts invalidate the listing: a price-only edit keeps the approved wording in place.
  const listingChanged = current.listingFactsRevision !== undefined && current.listingFactsRevision !== snapshot.listingFactsRevision;
  current.v1 = clone(snapshot.v1); current.v2 = clone(snapshot.v2); current.pricing = clone(snapshot.pricing);
  current.changedFactKeys = [...snapshot.changedFactKeys];
  current.factsRevision = snapshot.factsRevision; current.listingFactsRevision = snapshot.listingFactsRevision; current.factEdits = {};
  if (listingChanged || snapshot.downstreamInvalidated) {
    serverWorkflow = null; current.listings = {}; current.reviews = {}; current.publications = {};
    advance(snapshot.v2 ? snapshot.pricingReadiness.ready ? 'pricing_ready' : 'evidence_analyzed' : 'sku_selected');
  }
}
async function refreshServerFacts() {
  if (!serverOwner || !current.selectedSku || !current.task) return;
  applySnapshot(await apiClient.facts.getSnapshot(current.task.recordId!, selected().recordId!)); save();
}
/**
 * A product-row change is not a fact change, but the snapshot the checks read keeps its own copy of the
 * product. Submitting or dropping a quality report has to re-read it, otherwise the check panel (which
 * reads the freshly listed catalog) and the gate on "continue to Listing Studio" (which reads the
 * snapshot) disagree about the same SKU: the report shows as on file and the next step still stays shut.
 */
async function refreshSnapshotAfterProductChange(sku: string) {
  if (!serverOwner || current.selectedSku !== sku) return;
  await refreshServerFacts();
}
async function mutateServerFact(key: string, action: 'edit' | 'confirm' | 'reject', value?: string) {
  const before = findCurrentFact(key);
  try {
    const snap = action === 'edit' ? await apiClient.facts.update(before.recordId!, value ?? '', current.factsRevision!) : await apiClient.facts[action](before.recordId!, current.factsRevision!);
    applySnapshot(snap);
    await refreshWorkflow(); await refreshRecommendation();
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
  if (serverOwner) return !eligibilityReason(p, current.task ?? demoTask);
  return p.status === 'search_ready' && p.duplicateStatus === 'unique' && sameCategory(p.category, demoTask.category);
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
  return serverOwner ? clone(serverSnapshots[p.sku]?.pricing ?? serverPreviews[p.sku].pricing) : pricingFromFacts(p, cardV1(p).facts, factRevision(p.sku, PRICING_FACTS), current.task?.minProfit ?? demoTask.minProfit);
}
function synchronizeFacts() {
  if (serverOwner) return;
  if (!current.selectedSku) return;
  const base = baseFactCard(selected());
  const edits = editsFor(current.selectedSku);
  // Before the task card exists, a person's value is the only card there is, so it lands on V1. Once V2
  // exists, V1 stays as the supplier delivered it and every change belongs to the task card — the same
  // split the server keeps, so the comparison reads the same in both modes.
  current.v1 = current.v2 ? base : { ...base, facts: base.facts.map(f => clone(edits[f.key] ?? f)) };
  if (current.v2) {
    const baseKeys = new Set(base.facts.map(f => f.key));
    current.v2 = { ...current.v2, facts: [...base.facts.map(f => clone(edits[f.key] ?? f)), ...current.v2.facts.filter(f => !baseKeys.has(f.key)).map(f => clone(edits[f.key] ?? f))] };
  }
  refreshChangedFactKeys();
}
/**
 * Which task-card fields are the card's own work. The server decides this in `factSnapshotTx` with the
 * same rule; offline mode has to decide it too, otherwise the comparison claims nothing ever differs.
 */
function refreshChangedFactKeys() {
  if (serverOwner || !current.selectedSku || !current.v1) { current.changedFactKeys = []; return; }
  const supplier = new Map(current.v1.facts.map(fact => [fact.key, fact]));
  current.changedFactKeys = (current.v2?.facts ?? []).filter(fact => variesFromSupplier(fact, supplier.get(fact.key))).map(fact => fact.key);
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
  // Price-only facts clear the drafts' numbers, copy facts clear the whole approval.
  const pricingOnly = PRICING_FACTS.includes(key) && !COPY_FACTS.includes(key);
  if (pricingOnly) current.publications = {};
  else { current.listings = {}; current.reviews = {}; current.publications = {}; }
  current.pricing = pricingFor(selected());
  const review = current.reviews[current.platform];
  if (review) advance(review.status === 'passed' ? 'review_passed' : 'review_blocked');
  else if (current.listings[current.platform]) advance('listing_generated');
  else advance(current.pricing.status === 'ready' ? 'pricing_ready' : current.v2 ? 'evidence_analyzed' : 'sku_selected');
  return save();
}
function safeListing(platform: Platform, revision = 1): Listing {
  // Pricing, including the tariff estimate, only ever produces a reminder: an incomplete price
  // leaves the suggested price pending and never stops a draft from being generated.
  if (!current.v2) throw new Error('Analyze evidence before generating a listing.');
  if (selected().duplicateStatus !== 'unique' || !sameCategory(selected().category, serverOwner ? current.task?.category : demoTask.category)) throw new Error('Duplicate or out-of-category products cannot generate listings for this task.');
  // The marketplace decides the copy language and its unit system, so the generator is told which one it
  // writes for instead of guessing from the platform code.
  const task = serverOwner ? current.task : demoTask;
  return makeTemplateListing({ factCard: serverOwner ? serverSnapshots[current.selectedSku!].v2! : current.v2, pricing: current.pricing!, platform, revision,
    factRevision: factRevision(current.selectedSku!, COPY_FACTS),
    context: { market: task?.market ?? demoTask.market, category: task?.category ?? demoTask.category, requirements: task?.requirements ?? demoTask.requirements,
      product: { sku: selected().sku, name: selected().name } } });
}
function reviewIssues(listing: Listing) { return reviewAgainstTemplate(listing, safeListing(listing.platform, listing.revision)); }

/**
 * Offline picture text check. It cannot read the printed words, so it reports the file-level findings and
 * marks every attribute not_checked; a guess would be worse than an honest "needs a look".
 */
function offlineImageCheck(card: FactCard, product: Product): ImageCheckResult {
  const described = describeImageAssets({ references: product.assetReferences ?? [], assets: [], reuseByHash: {} });
  const findings = localImageCheckFindings(card.facts.map(f => ({ key: f.key, label: f.label, value: f.value, status: f.status, allowed: f.allowed, sourceKind: f.sourceKind })), '');
  return { sku: product.sku, mode: 'local', provider: 'local', model: 'local-resource-check', status: findings.length ? 'needs_review' : 'no_images',
    promptVersion: MULTIMODAL_PROMPT_VERSION, baseVersion: 2, findings, assets: described.assets, transmitted: [], counts: imageCheckCounts(findings),
    notes: [...described.notes, 'Local mode reads no picture content, so the listed attributes still need a person or a live multimodal model.'],
    checkedAt: new Date().toISOString() };
}
function annotateFactsWithImageCheck(card: FactCard, result: ImageCheckResult): FactCard {
  return { ...card, facts: card.facts.map(fact => {
    const finding = result.findings.find(candidate => candidate.factKey === fact.key);
    return finding ? { ...fact, imageCheck: factImageCheck(finding, { mode: result.mode, model: result.model, checkedAt: result.checkedAt }) } : fact;
  }) };
}
/** The offline evidence list grows one card once the facts carry a picture verdict. */
function imageCheckEvidence(card: FactCard | null): Evidence | null {
  const findings = (card?.facts ?? []).flatMap(fact => fact.imageCheck ? [fact.imageCheck] : []);
  const first = findings[0];
  if (!first) return null;
  const counts = imageCheckCounts(findings);
  const payload: ImageCheckEvidence = { mode: first.mode, model: first.model, status: 'needs_review', promptVersion: MULTIMODAL_PROMPT_VERSION, checkedAt: first.checkedAt,
    counts, transmitted: [], assets: [], notes: [], findings };
  return { id: `IMGCHK-${first.mode.toUpperCase()}`, name: 'Multimodal picture text check', type: 'image_check', sourceKind: 'image', file: first.model,
    anchor: `${counts.agree} agree · ${counts.differ} differ · ${counts.not_visible} no such text · ${counts.not_checked} not checked`,
    extracted: findings.map(imageCheckFindingText), imageCheck: payload };
}

/**
 * The decisions the check area offers. They are the same three answers wherever a problem is raised,
 * so the picture table and the report panel share one implementation, and the queue row that opened
 * the dispute is closed by the very same action on the server.
 */
async function checkDecision(input: CheckDecisionRequest) {
  await delay(220);
  if (!current.v2 || !current.task) throw new Error('Analyze evidence before deciding on a check.');
  if (serverOwner) {
    applySnapshot(await apiClient.facts.checkDecision(current.task.recordId!, selected().recordId!, input, current.factsRevision!));
    // Dropping evidence is recorded on the product, so the pool copy the checks read is refreshed too.
    if (input.action === 'discard_image' || input.action === 'discard_report' || input.action === 'restore_image') {
      const catalog = await apiClient.products.list();
      serverPreviews = catalog.factPreviews; current.catalog = catalog.products; current.serverRevision = catalog.revision;
      await refreshSnapshotAfterProductChange(selected().sku);
    }
    await refreshWorkflow(); await refreshRecommendation();
    return save();
  }
  if (input.action === 'discard_image' || input.action === 'discard_report' || input.action === 'restore_image') {
    const target: CheckDecisionTarget = input.action === 'discard_report' ? 'quality_report' : 'image_text';
    const ref = input.action === 'discard_report' ? input.reportNo : input.asset;
    const product = selected();
    const kept = (product.checkDecisions ?? []).filter(decision => !(decision.target === target && decision.ref === ref));
    product.checkDecisions = input.action === 'restore_image' ? kept : [...kept, { target, ref, by: 'Demo operator', at: new Date().toISOString() }];
    // Dropping a picture drops the candidate fields it produced, and clears the verdicts it left on
    // fields the card already had. The server does the same, so both modes agree.
    if (target === 'image_text' && input.action === 'discard_image') current.v2.facts = current.v2.facts
      .filter(fact => !(fact.imageCheck?.asset === ref && fact.sourceKind === 'image' && fact.source === IMAGE_CHECK_SOURCE))
      .map(fact => fact.imageCheck?.asset === ref ? { ...fact, imageCheck: undefined } : fact);
    refreshChangedFactKeys();
    return save();
  }
  const fact = current.v2.facts.find(candidate => candidate.key === input.factKey);
  if (!fact) throw new Error('That fact is not on the task card.');
  const updated = appliedFactDecision(fact, input);
  current.v2.facts = current.v2.facts.map(candidate => candidate.key === updated.key ? updated : candidate);
  const pricingOnly = PRICING_FACTS.includes(updated.key) && !COPY_FACTS.includes(updated.key);
  if (pricingOnly) current.publications = {};
  else { current.listings = {}; current.reviews = {}; current.publications = {}; }
  current.pricing = pricingFor(selected());
  advance(current.pricing.status === 'ready' ? 'pricing_ready' : 'evidence_analyzed');
  refreshChangedFactKeys();
  return save();
}

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
    serverPreviews = catalog.factPreviews; serverSnapshots = {}; serverWorkflow = null; serverAssets = {};
    const importedCount = catalog.products.filter(p => p.importSource).length;
    current = { ...cached, catalog: catalog.products, serverRevision: catalog.revision, task, selectedSku, platform: cached.task?.recordId === task?.recordId ? cached.platform : task?.platform === 'Shopify US' ? 'shopify' : 'amazon', datasetSource: !importedCount ? 'builtin' : importedCount === catalog.products.length ? 'imported' : 'mixed' };
    if (!selectedSku) { current.v1 = null; current.v2 = null; current.pricing = null; current.listings = {}; current.reviews = {}; current.publications = {}; }
    current.listings = {}; current.reviews = {}; current.publications = {};
    current.factEdits = {}; current.v1 = null; current.v2 = null; current.pricing = null;
    if (task) {
      const snapshots = await apiClient.facts.list(task.recordId);
      for (const snap of snapshots) { serverSnapshots[snap.product.sku] = snap; serverAssets[snap.product.sku] = clone(snap.assets ?? []); }
      if (selectedSku) applySnapshot(serverSnapshots[selectedSku] ?? await apiClient.facts.createV1(task.recordId, selectedSku));
    }
    await refreshRecommendation();
    if (selectedSku) await refreshWorkflow();
    else advance(task ? 'task_created' : 'materials_ready');
    return save();
  },
  disconnectServer() { if (serverOwner) { try { localStorage.removeItem(STORAGE_KEY); } catch { /* in-memory logout */ } } serverOwner = null; serverRecommendation = null; serverSnapshots = {}; serverWorkflow = null; serverPreviews = {}; serverAssets = {}; pendingImport = null; current = initialState(); },
  isStorageAvailable: () => storageAvailable,
  catalog: () => current.catalog.map(productView),
  async getCatalog() { await delay(180); return current.catalog.map(productView); },
  factEditor, editableFact,
  // Pricing is not part of readiness: an incomplete price leaves the suggested price pending.
  listingReady() {
    return !!current.v2 && !!current.selectedSku && selected().duplicateStatus === 'unique'
      && sameCategory(selected().category, serverOwner ? current.task?.category : demoTask.category) && this.listingBlockedFacts().length === 0;
  },
  /** The copy facts still waiting for a person: the same rule the generate button reads, named out loud. */
  listingBlockedFacts(): { key: string; label: string; missing: boolean }[] {
    if (!current.v2) return [];
    const facts = current.v2.facts;
    return requiredCopyFactsFor(selected().visual)
      .filter(key => !facts.some(f => f.key === key && f.status === 'Confirmed' && f.allowed))
      .map(key => { const fact = facts.find(f => f.key === key); return { key, label: fact?.label ?? key, missing: !fact || fact.value === 'Missing' }; });
  },
  getTaskTemplate: () => clone(newTaskTemplate),
  async ready() { synchronizeFacts(); if (current.pricing && current.selectedSku) current.pricing = pricingFor(selected()); if (current.stage === 'initial') advance('materials_ready'); return save(); },
  navigate(workspace: Workspace) { current.workspace = workspace; return save(); },
  async reset() { await delay(180); const data = serverOwner ? await apiClient.reset() : null; pendingImport = null; current = initialState(); serverRecommendation = null; serverSnapshots = {}; serverWorkflow = null; serverAssets = {}; if (data) { serverPreviews = data.factPreviews; current.catalog = data.products; current.serverRevision = data.revision; } return save(); },
  async loadBuiltInDataset() { await this.reset(); advance('materials_ready'); return save(); },
  /** The report columns are part of the template a supplier file may carry, so they are listed with the rest. */
  getSupplierTemplate: () => [...SUPPLIER_COLUMNS, ...QUALITY_REPORT_COLUMNS],
  /** Display units: the task market decides the default, a manual choice wins until the task changes. */
  /** Records the transport paperwork for a declared-dangerous product, then refreshes the pool. */
  async releaseHazmat(sku: string, documents: string) {
    if (!serverOwner) throw new Error('Transport release requires the server-backed workspace.');
    const product = await apiClient.assets.hazmatRelease(this.assetProductId(sku), documents);
    const catalog = await apiClient.products.list();
    serverPreviews = catalog.factPreviews; current.catalog = catalog.products; current.serverRevision = catalog.revision;
    return product;
  },
  unitSystem(): UnitSystem { return current.units ?? systemForMarket(serverOwner ? current.task?.market : undefined); },
  /** Records the quality report a person submits for a SKU, then refreshes the pool it is read from. */
  async submitQualityReport(sku: string, input: { reportNo: string; result?: 'pass' | 'fail'; validUntil?: string; assetId?: string }) {
    if (!serverOwner) throw new Error('Submitting a quality report requires the server-backed workspace.');
    const recorded = await apiClient.assets.qualityReport(this.assetProductId(sku), input);
    const catalog = await apiClient.products.list();
    serverPreviews = catalog.factPreviews; current.catalog = catalog.products; current.serverRevision = catalog.revision;
    await refreshSnapshotAfterProductChange(sku);
    return recorded;
  },
  setUnits(units: UnitSystem) { current.units = units; return save(); },
  /** Classifies the pending file against the pool before anything is written. Server mode only. */
  async previewImportAlignment(): Promise<import('../../server/services/imports').ImportPreviewResult | null> {
    if (!serverOwner || !pendingImport) return null;
    return clone(await apiClient.products.previewAlignment(pendingImport, current.serverRevision!));
  },
  /** Summary of the most recent import: how many rows were new, duplicated, conflicting or uncertain. */
  importBatch: (): ImportBatchDto | null => lastImportBatch ? clone(lastImportBatch) : null,
  /** Import history and the rows that still need a human decision. Server mode only. */
  async importBatches(): Promise<ImportBatchDto[]> {
    if (!serverOwner) return [];
    return clone(await apiClient.imports.list());
  },
  async importBatchDetail(batchId: string): Promise<ImportBatchDetail> {
    if (!serverOwner) throw new Error('Import review requires the server-backed workspace.');
    return clone(await apiClient.imports.get(batchId));
  },
  async resolveOccurrence(occurrenceId: string, action: Exclude<ImportResolution, 'pending'>): Promise<ImportBatchDetail> {
    if (!serverOwner) throw new Error('Import review requires the server-backed workspace.');
    const detail = await apiClient.imports.resolve(occurrenceId, action, current.serverRevision!);
    // Adopting or creating a product changes the pool, so refresh what the rest of the app reads.
    const catalog = await apiClient.products.list();
    serverPreviews = catalog.factPreviews; current.catalog = catalog.products; current.serverRevision = catalog.revision;
    return clone(detail);
  },
  /** Bulk decisions and remembered rules. Both still require an explicit click; nothing auto-resolves. */
  async resolveOccurrencesBulk(batchId: string, input: { action: Exclude<ImportResolution, 'pending'>; verdict?: 'conflict' | 'probable'; field?: string; remember?: boolean }): Promise<ImportBulkResult> {
    if (!serverOwner) throw new Error('Import review requires the server-backed workspace.');
    const result = await apiClient.imports.resolveBulk(batchId, { ...input, expectedRevision: current.serverRevision! });
    const catalog = await apiClient.products.list();
    serverPreviews = catalog.factPreviews; current.catalog = catalog.products; current.serverRevision = catalog.revision;
    return clone(result);
  },
  async importRules(): Promise<ImportRuleDto[]> {
    if (!serverOwner) return [];
    return clone(await apiClient.imports.rules());
  },
  async deleteImportRule(ruleId: string): Promise<ImportRuleDto[]> {
    if (!serverOwner) return [];
    return clone(await apiClient.imports.deleteRule(ruleId));
  },
  /** Source assets live on the server per SKU. Offline competition mode keeps them unavailable instead of faking a local copy. */
  assetsFor: (sku: string): ProductAsset[] => clone(serverAssets[sku] ?? []),
  async listAssets(sku: string): Promise<ProductAsset[]> {
    if (!serverOwner) throw new Error('Source assets require the server-backed workspace.');
    const { assets } = await apiClient.assets.list(this.assetProductId(sku));
    serverAssets[sku] = assets; return clone(assets);
  },
  async uploadAsset(sku: string, file: { fileName: string; mimeType: string; role?: AssetRole; contentBase64: string }) {
    if (!serverOwner) throw new Error('Source assets require the server-backed workspace.');
    const result = await apiClient.assets.upload(this.assetProductId(sku), file);
    serverAssets[sku] = result.assets;
    const snapshot = serverSnapshots[sku]; if (snapshot) snapshot.assets = clone(result.assets);
    return { asset: clone(result.asset), duplicate: result.duplicate, assets: clone(result.assets) };
  },
  async deleteAsset(sku: string, assetId: string): Promise<ProductAsset[]> {
    if (!serverOwner) throw new Error('Source assets require the server-backed workspace.');
    const { assets } = await apiClient.assets.remove(assetId);
    serverAssets[sku] = assets;
    const snapshot = serverSnapshots[sku]; if (snapshot) snapshot.assets = clone(assets);
    return clone(assets);
  },
  assetContentUrl: (assetId: string) => SERVER_MODE ? apiClient.assets.contentUrl(assetId) : '',
  assetProductId(sku: string) {
    const product = current.catalog.find(p => p.sku === sku);
    if (!product?.recordId) throw new Error('Unknown SKU');
    return product.recordId;
  },
  async previewSupplierFile(file: File, mode: ImportMode): Promise<ImportPreview> {
    pendingImport = null;
    pendingSourceFile = null;
    const { parseSupplierFile } = await import('./supplierImport');
    pendingImport = await parseSupplierFile(file, mode, current.catalog);
    if (mode === 'append' && current.catalog.length + pendingImport.products.length > 500) {
      pendingImport = null;
      throw new Error('Too many products. Keep the dataset within 500 products.');
    }
    const extension = file.name.toLowerCase().split('.').at(-1) ?? '';
    if (SERVER_MODE) pendingSourceFile = { fileName: file.name, mimeType: SOURCE_MIME[extension] ?? 'application/octet-stream', contentBase64: await readAsBase64(file) };
    return clone(pendingImport);
  },
  async importSupplierFile() {
    await delay(180);
    const preview = pendingImport;
    if (!preview?.products.length) throw new Error('No valid new products to import. The current dataset is unchanged.');
    if (serverOwner) {
      const result = await apiClient.products.import(preview, current.serverRevision!, pendingSourceFile ?? undefined);
      serverSnapshots = {}; serverWorkflow = null; serverRecommendation = null; serverPreviews = result.factPreviews; serverAssets = {};
      lastImportBatch = result.batch ?? null;
      current = { ...initialState(), catalog: result.products, serverRevision: result.revision, datasetSource: preview.mode === 'append' ? 'mixed' : 'imported', importReport: clone(result.report ?? preview) };
      advance('materials_ready'); pendingImport = null; pendingSourceFile = null; return save();
    }
    const catalog = preview.mode === 'append' ? [...current.catalog, ...preview.products] : preview.products;
    if (new Set(catalog.map(p => p.sku)).size !== catalog.length) throw new Error('The dataset changed. Preview the file again.');
    const { products: importedProducts, ...report } = preview;
    void importedProducts;
    current = { ...initialState(), catalog: clone(catalog), datasetSource: preview.mode === 'append' ? 'mixed' : 'imported', importReport: clone(report) };
    advance('materials_ready'); pendingImport = null;
    return save();
  },
  /**
   * Uploads the files a spreadsheet referenced. Matching is by file name, so the operator picks the
   * folder once instead of attaching images product by product.
   */
  async attachReferencedAssets(files: File[]): Promise<{ attached: number; missing: string[]; unreferenced: string[]; grouped: string[] }> {
    if (!serverOwner) return { attached: 0, missing: [], unreferenced: [], grouped: [] };
    // Which file belongs to which SKU is decided by a pure, tested function; this only uploads.
    const match = matchAssetFiles(current.catalog.map(product => ({ sku: product.sku, assetReferences: product.assetReferences })), files.map(file => file.name));
    const byName = new Map(files.map(file => [file.name, file]));
    let attached = 0;
    for (const assignment of match.assignments) {
      const file = byName.get(assignment.fileName);
      if (!file) continue;
      const extension = file.name.toLowerCase().split('.').at(-1) ?? '';
      await apiClient.assets.upload(this.assetProductId(assignment.sku), {
        fileName: file.name, mimeType: SOURCE_MIME[extension] ?? (extension === 'pdf' ? 'application/pdf' : `image/${extension === 'jpg' ? 'jpeg' : extension}`),
        contentBase64: await readAsBase64(file),
      });
      attached++;
    }
    const catalog = await apiClient.products.list();
    serverPreviews = catalog.factPreviews; current.catalog = catalog.products; current.serverRevision = catalog.revision;
    return { attached, missing: [...new Set(match.missing)], unreferenced: match.unreferenced, grouped: match.grouped };
  },
  async createTask() {
    await delay();
    if (current.stage === 'initial') advance('materials_ready');
    if (!current.task) {
      if (!serverOwner) { current.task = clone(newTaskTemplate); advance('task_created'); }
      else {
        // A row may already exist under this code, and creating only returns what the database holds, so the
        // fields are written explicitly: the task the demo starts from has to be the brief the page showed.
        const created = await apiClient.tasks.create(newTaskTemplate);
        const task = await apiClient.tasks.update(created.recordId, newTaskTemplate, created.revision!);
        await useServerTask(task);
        serverRecommendation = await apiClient.recommendations.run(task.recordId!, task.revision!, 'rule');
      }
    }
    if (serverOwner && current.task && !serverRecommendation) serverRecommendation = await apiClient.recommendations.run(current.task.recordId!, current.task.revision!, 'rule');
    current.workspace = 'tasks'; return save();
  },
  async saveTask(task: Task, editing: boolean) {
    if (!serverOwner) throw new Error('Task editing requires Full Demo mode.');
    try { return await useServerTask(editing ? await apiClient.tasks.update(task.recordId!, task, task.revision!) : await apiClient.tasks.create({ ...task, id: `PL-${crypto.randomUUID().slice(0, 8).toUpperCase()}` })); }
    catch (error) { await this.connectServer(serverOwner); throw error; }
  },
  async loadDemoTask() {
    if (!serverOwner) return this.createTask();
    const task = await apiClient.tasks.create(demoTask);
    const restored = await apiClient.tasks.update(task.recordId, demoTask, task.revision!);
    await useServerTask(restored); serverRecommendation = await apiClient.recommendations.run(restored.recordId, restored.revision!, 'rule'); return save();
  },
  async loadBagDemoTask() {
    if (!serverOwner) throw new Error('Bag demo task requires Full Demo mode.');
    const task = await apiClient.tasks.create(bagDemoTask);
    const restored = await apiClient.tasks.update(task.recordId, bagDemoTask, task.revision!);
    await useServerTask(restored); serverRecommendation = await apiClient.recommendations.run(restored.recordId, restored.revision!, 'rule'); return save();
  },
  async runRecommendation() {
    if (!serverOwner || !current.task) return save();
    try { serverRecommendation = await apiClient.recommendations.run(current.task.recordId!, current.task.revision!); return save(); }
    catch (error) { await this.connectServer(serverOwner); throw error; }
  },
  async refreshPricingSnapshot() {
    if (!serverOwner || !current.task?.recordId) throw new Error('Pricing snapshot refresh requires the server-backed workspace.');
    const version = current.pricing?.snapshot?.version ?? current.task.pricingSnapshot?.version;
    if (!version) throw new Error('Pricing snapshot is unavailable. Reload the task.');
    const snapshot = await apiClient.tasks.refreshPricingSnapshot(current.task.recordId, version);
    current.task = { ...current.task, pricingSnapshot: snapshot };
    if (current.selectedSku) { await refreshServerFacts(); await refreshWorkflow(); }
    return save();
  },
  recommendationState: () => serverRecommendation ? clone(serverRecommendation) : null,
  recommendations(): Recommendation[] {
    if (serverOwner) return serverRecommendation?.status === 'ready' ? clone(serverRecommendation.recommendations) : [];
    return current.task ? rankProducts(current.catalog.map(productView), current.task) : [];
  },
  exclusionReason(p: Product) {
    if (p.duplicateStatus === 'duplicate') return 'Exact duplicate · excluded from recommendations';
    if (p.duplicateStatus === 'possible_duplicate') return 'Possible duplicate · human verification required';
    if (p.status === 'missing_data') return `Missing ${p.missing.join(', ')} · excluded from recommendations`;
    if (!sameCategory(p.category, demoTask.category)) return 'Category mismatch · outside Home & Kitchen';
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
    // The price belongs to the product, not to the analysis: the facts it needs are already on V1, so
    // offline mode shows it straight away instead of claiming there is no pricing data at all.
    if (!serverOwner) current.pricing = pricingFor(p);
    current.workspace = 'evidence'; return save();
  },
  async openFactReview(sku: string) {
    await delay(180);
    const p = current.catalog.find(p => p.sku === sku);
    if (!p) throw new Error('Unknown SKU');
    if (!current.task) current.task = serverOwner ? await apiClient.tasks.create(newTaskTemplate) : clone(newTaskTemplate);
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
    if (!p) return [];
    const check = current.selectedSku === sku ? imageCheckEvidence(current.v2) : null;
    return [...productEvidence(p), ...(check ? [check] : [])];
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
      // The picture text check runs with the analysis, exactly as it does on the server.
      if (current.v2) current.v2 = annotateFactsWithImageCheck(current.v2, offlineImageCheck(current.v2, p));
      advance('evidence_analyzed');
      current.pricing = pricingFor(p);
      if (current.pricing.status === 'ready') advance('pricing_ready');
    }
    return save();
  },
  /** Re-runs only the picture text check, so a new photo does not force a whole new fact card. */
  async recheckImages() {

    await delay(500);
    const p = selected();
    if (!current.v2 || !current.task) throw new Error('Analyze evidence before rechecking images.');
    if (serverOwner) { applySnapshot(await apiClient.facts.imageCheck(current.task.recordId!, p.recordId!, current.factsRevision!)); return save(); }
    current.v2 = annotateFactsWithImageCheck(current.v2, offlineImageCheck(current.v2, p));
    return save();
  },
  /** Adopt the wording the check read in the picture, exactly as the ImportReview queue would. */
  async adoptPrintedText(factKey: string) { return checkDecision({ action: 'adopt_printed_text', factKey }); },
  /** Correct the value by hand from the check area; the picture verdict is re-read against the new value. */
  async saveImageCheckEdit(factKey: string, value: string) { return checkDecision({ action: 'edited', factKey, value }); },
  /** Drop this picture from the checks: the decision is recorded and honoured on every later run. */
  async discardImageCheck(asset: string) { return checkDecision({ action: 'discard_image', asset }); },
  /** Take that decision back: the picture joins the check again on the next run. */
  async restoreImageCheck(asset: string) { return checkDecision({ action: 'restore_image', asset }); },
  /** Drop a quality report from the checks. A failed report cannot be dropped this way. */
  async discardQualityReport(reportNo: string) { return checkDecision({ action: 'discard_report', reportNo }); },
  setPlatform(platform: Platform) {
    current.platform = platform;
    const review = current.reviews[platform];
    if (current.publications[platform]) advance('published');
    else if (review) advance(serverOwner ? serverWorkflow?.publishAllowed[platform] || (review.status === 'passed' && current.pricing?.status !== 'ready') ? 'review_passed' : review.status === 'blocked' ? 'review_blocked' : 'listing_generated' : review.status === 'passed' ? 'review_passed' : 'review_blocked');
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
  async injectDemoRisk() {
    if (!serverOwner) throw new Error('This action requires Full Demo mode.');
    const l = activeServerListing();
    return serverAction(() => apiClient.listings.injectDemoRisk(l.recordId!, l.revision, current.factsRevision!));
  },
  canPublish() {
    if (serverOwner) return !!serverWorkflow?.publishAllowed[current.platform];
    if (!this.listingReady()) return false;
    const listing = current.listings[current.platform]; const review = current.reviews[current.platform];
    return !!listing && (listing.factRevision ?? 0) === factRevision(current.selectedSku!, COPY_FACTS) && review?.status === 'passed' && review.revision === listing.revision && reviewIssues(listing).length === 0;
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
    return amazonCsv(current.selectedSku!, listing, current.pricing?.suggestedPrice ?? null);
  },
};
