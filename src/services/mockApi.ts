import { demoTask, HERO_SKU, products as builtInProducts } from '../data/mockData';
import { COPY_FACTS, PRICING_FACTS, REQUIRED_COPY_FACTS, editableFact, factEditor, factNumber, normalizeFactValue } from './factReview';
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
function hydrate(): DemoState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return initialState();
    const s = JSON.parse(raw) as DemoState;
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
let current = hydrate();
let pendingImport: ImportPreview | null = null;
function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(current)); storageAvailable = true; }
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
function fact(key: string, label: string, value: string, source: string, anchor: string, allowed = true, confirmed = true): Fact {
  return { key, label, value, source, anchor, allowed: confirmed && allowed, status: value === 'Missing' ? 'Missing' : confirmed ? 'Confirmed' : 'Requires Confirmation', sourceKind: 'mock' };
}
function cardV1(p: Product): FactCard {
  const dimensions = p.packagingDimensions?.split(' × ').map(Number.parseFloat);
  const facts = [
    fact('color', 'Color', p.color, 'Supplier Spreadsheet', 'Products · column D'),
    fact('capacity', 'Capacity', `${p.capacity}ml / ${p.localizedCapacity}`, 'Specification PDF', 'Page 1 · specifications'),
    fact('material', 'Material', p.material, 'Specification PDF', 'Page 1 · body material'),
    fact('straw', 'Straw', p.straw ? 'Included' : 'No straw', 'Supplier Spreadsheet', 'Products · column F'),
    fact('countryOfOrigin', 'Country of origin', p.countryOfOrigin, 'Supplier Spreadsheet', 'Products · column G'),
    fact('packagingWeight', 'Packaging weight', p.packagingWeight ? `${p.packagingWeight} kg` : 'Missing', 'Supplier Spreadsheet', 'Packaging · column C', false, !!p.packagingWeight),
    ...(['packageLength', 'packageWidth', 'packageHeight'] as const).map((key, i) => {
      const value = p[key] ?? dimensions?.[i];
      return fact(key, ['Package length', 'Package width', 'Package height'][i], value ? `${value} cm` : 'Missing', 'Supplier Spreadsheet', `Packaging · ${key}`, false, !!value);
    }),
    fact('supplierCost', 'Supplier cost', `USD ${p.supplierCost.toFixed(2)}`, 'Supplier Spreadsheet', 'Commercial · column B', false),
    fact('declaredValue', 'Declared value', `USD ${(p.declaredValue ?? 8.2).toFixed(2)}`, 'Supplier Spreadsheet', 'Commercial · column C', false),
  ];
  if (p.importSource) {
    const columns: Record<string, string> = { color: 'color', capacity: 'capacityMl', material: 'material', straw: 'hasStraw', countryOfOrigin: 'countryOfOrigin', packagingWeight: 'packagingWeightKg', packageLength: 'packageLengthCm', packageWidth: 'packageWidthCm', packageHeight: 'packageHeightCm', supplierCost: 'supplierCost', declaredValue: 'declaredValue' };
    for (const f of facts) {
      f.source = 'Imported Supplier File'; f.sourceKind = 'supplier';
      f.anchor = `${p.importSource.fileName} · ${p.importSource.sheetName} · row ${p.importSource.row} · ${columns[f.key]}`;
    }
  }
  return { version: 1, sku: p.sku, facts: facts.map(f => clone(editsFor(p.sku)[f.key] ?? f)) };
}
function editsFor(sku: string): Record<string, Fact> { return Object.hasOwn(current.factEdits, sku) ? current.factEdits[sku] : {}; }
function factRevision(sku: string, keys?: string[]) {
  return Object.values(editsFor(sku)).filter(f => !keys || keys.includes(f.key)).reduce((sum, f) => sum + (f.revision ?? 0), 0);
}
function productView(p: Product): Product {
  if (!Object.keys(editsFor(p.sku)).length) return clone(p);
  const facts = cardV1(p).facts;
  const confirmed = (key: string) => facts.find(f => f.key === key && f.status === 'Confirmed');
  const missing = p.missing.filter(label => !['Packaging Weight', 'Packaging Dimensions'].includes(label) && !(label === 'Accessory Information' && editsFor(p.sku).packageIncludes?.status === 'Confirmed'));
  if (!confirmed('packagingWeight')) missing.push('Packaging Weight');
  if (['packageLength', 'packageWidth', 'packageHeight'].some(key => !confirmed(key))) missing.push('Packaging Dimensions');
  for (const key of ['color', 'capacity', 'material', 'straw', 'countryOfOrigin', 'supplierCost', 'declaredValue']) {
    if (!confirmed(key)) missing.push(facts.find(f => f.key === key)!.label);
  }
  const value = (key: string) => confirmed(key)?.value;
  const dimensions = ['packageLength', 'packageWidth', 'packageHeight'].map(key => value(key) ? factNumber(value(key)!) : undefined);
  return { ...p, color: value('color') ?? p.color, material: value('material') ?? p.material,
    capacity: value('capacity') ? factNumber(value('capacity')!) : p.capacity,
    localizedCapacity: value('capacity')?.split(' / ')[1] ?? p.localizedCapacity,
    countryOfOrigin: value('countryOfOrigin') ?? p.countryOfOrigin,
    straw: value('straw') ? value('straw') === 'Included' : p.straw,
    supplierCost: value('supplierCost') ? factNumber(value('supplierCost')!) : p.supplierCost,
    declaredValue: value('declaredValue') ? factNumber(value('declaredValue')!) : p.declaredValue,
    packagingWeight: value('packagingWeight') ? factNumber(value('packagingWeight')!) : undefined,
    packagingDimensions: dimensions.every(n => n !== undefined) ? `${dimensions.join(' × ')} cm` : undefined,
    missing: [...new Set(missing)], status: missing.length ? 'missing_data' : 'search_ready',
  };
}
function pricingFor(p: Product): Pricing {
  const facts = cardV1(p).facts;
  const confirmed = (key: string) => facts.find(f => f.key === key && f.status === 'Confirmed');
  const missing = [
    ...(!confirmed('packagingWeight') ? ['Packaging Weight'] : []),
    ...(['packageLength', 'packageWidth', 'packageHeight'].some(key => !confirmed(key)) ? ['Packaging Dimensions'] : []),
    ...(!confirmed('supplierCost') ? ['Supplier cost'] : []),
  ];
  const cost = confirmed('supplierCost') ? factNumber(confirmed('supplierCost')!.value) : p.supplierCost;
  const floor = Math.ceil((cost + 3.1 + 0.7 + 2.2 + 5 - 1e-9) * 100) / 100;
  return { version: `v${1 + factRevision(p.sku, PRICING_FACTS)}`, status: missing.length ? 'blocked' : 'ready', supplierCost: cost,
    shipping: 3.1, duty: 0.7, platformCost: 2.2, targetProfit: 5,
    suggestedPrice: missing.length ? null : p.sku === HERO_SKU ? Math.max(19.99, floor) : floor, missing };
}
function synchronizeFacts() {
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
  if (action !== 'reject' && !editableFact(key)) throw new Error('This claim cannot be edited or confirmed in the demo.');
  if (action === 'confirm' && (before.status === 'Missing' || !before.value.trim())) throw new Error('A value is required before confirmation.');
  const value = action === 'edit' ? normalizeFactValue(key, input ?? '') : action === 'confirm' ? normalizeFactValue(key, factEditor(before).value) : before.value;
  const status: Fact['status'] = action === 'edit' ? 'Requires Confirmation' : action === 'confirm' ? 'Confirmed' : 'Rejected';
  const now = new Date().toISOString();
  const updated: Fact = { ...before, value, status, allowed: status === 'Confirmed' && COPY_FACTS.includes(key),
    source: 'Manual confirmation', sourceKind: 'manual', anchor: `Fact Review · ${key}`,
    previousValue: action === 'edit' ? before.value : before.previousValue ?? before.value,
    previousSource: before.sourceKind === 'manual' ? before.previousSource : `${before.source} · ${before.anchor}`,
    updatedAt: now, confirmedAt: action === 'confirm' ? now : undefined, revision: (before.revision ?? 0) + 1,
  };
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
  const sources = current.v2.facts.filter(f => f.allowed && f.status === 'Confirmed');
  const value = (key: string) => sources.find(f => f.key === key)?.value;
  const color = value('color'); const capacity = value('capacity'); const material = value('material');
  if (!color || !capacity || !material) throw new Error('Required confirmed facts are missing.');
  const lid = value('lidType'); const includes = value('packageIncludes');
  return {
    platform, revision, factRevision: factRevision(current.selectedSku!), riskDemoInjected: false,
    title: `${color} ${material} Travel Bottle, ${capacity}${lid ? `, ${lid === 'Screw-top lid' ? 'Screw-top Lid' : lid}` : ''}`,
    bullets: [
      `${capacity} capacity for your everyday routine.`,
      `${material} body${value('finish') ? ` with a ${value('finish')!.toLowerCase()} finish` : ''}.`,
      ...(lid ? [lid === 'Screw-top lid' ? 'Secure screw-top lid designed for everyday carrying.' : `${lid}.`] : []),
      ...(value('straw') ? value('straw') === 'No straw' ? ['A simple, straw-free design.'] : ['Includes a straw.'] : []),
      ...(includes ? [`In the box: ${includes}.`] : []),
    ],
    description: `Meet your everyday travel bottle. A ${color.toLowerCase()} ${material.toLowerCase()} body holds ${capacity}.${lid ? ` Finished with a ${lid.toLowerCase()}.` : ''}${includes ? ` Includes ${includes.toLowerCase()}.` : ''}`,
    attributes: Object.fromEntries(sources.filter(f => ['color', 'capacity', 'material', 'straw', 'countryOfOrigin', 'finish', 'lidType'].includes(f.key)).map(f => [f.label, f.value])),
    sources,
  };
}
function reviewIssues(listing: Listing) {
  const safe = safeListing(listing.platform, listing.revision);
  const fields = [listing.title, ...listing.bullets, listing.description];
  const issues = [];
  if (fields.some(text => /100%\s*leakproof/i.test(text))) issues.push({ id: 'R001', severity: 'HIGH' as const, title: 'Unsupported performance claim', text: '100% leakproof', reason: 'No verified evidence supports an absolute leakproof claim.' });
  const expected = [safe.title, ...safe.bullets, safe.description];
  const hasOtherEdits = fields.some((text, i) => text !== expected[i] && text !== '100% leakproof') || fields.length !== expected.length;
  if (hasOtherEdits) issues.push({ id: 'R002', severity: 'HIGH' as const, title: 'Unverified edited content', text: 'Text differs from the evidence-backed draft.', reason: 'This mock reviewer only approves the confirmed FactCard wording. Apply the suggested fix to restore supported copy.' });
  return issues;
}

export const mockApi = {
  getState: () => clone(current),
  isStorageAvailable: () => storageAvailable,
  catalog: () => current.catalog.map(productView),
  async getCatalog() { await delay(180); return current.catalog.map(productView); },
  factEditor, editableFact,
  listingReady() { return !!current.v2 && !!current.selectedSku && selected().duplicateStatus === 'unique' && selected().category === demoTask.category && current.pricing?.status === 'ready' && REQUIRED_COPY_FACTS.every(key => current.v2!.facts.some(f => f.key === key && f.status === 'Confirmed' && f.allowed)); },
  getTaskTemplate: () => clone(demoTask),
  async ready() { synchronizeFacts(); if (current.pricing && current.selectedSku) current.pricing = pricingFor(selected()); if (current.stage === 'initial') advance('materials_ready'); return save(); },
  navigate(workspace: Workspace) { current.workspace = workspace; return save(); },
  async reset() { await delay(180); pendingImport = null; current = initialState(); return save(); },
  async loadBuiltInDataset() { await delay(180); pendingImport = null; current = initialState(); advance('materials_ready'); return save(); },
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
    if (!current.task) { current.task = clone(demoTask); advance('task_created'); }
    current.workspace = 'tasks'; return save();
  },
  recommendations(): Recommendation[] {
    if (!current.task) return [];
    return current.catalog.map(productView).filter(eligible).map(p => {
      const reasons: string[] = []; const deductions: string[] = []; let score = 94;
      if (p.color === 'Black') reasons.push('Black matches requested color');
      else { score -= 23; deductions.push('Color does not match requested black'); }
      if (p.capacity === 500) reasons.push('500ml / 16.9 fl oz closely matches target capacity');
      else { score -= 16; deductions.push(p.capacity === 750 ? 'Capacity too large: 750ml / 25.4 fl oz' : 'Capacity does not match the 500ml target'); }
      if (!p.straw) reasons.push('No straw');
      else { score -= 12; deductions.push('Includes straw: does not meet the no-straw preference'); }
      reasons.push('Packaging information is complete');
      return { sku: p.sku, score, reasons, deductions };
    }).sort((a, b) => b.score - a.score || Number(b.sku === HERO_SKU) - Number(a.sku === HERO_SKU)).slice(0, 3);
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
    if (current.selectedSku !== sku) {
      current.selectedSku = sku; current.v1 = cardV1(p); current.v2 = null; current.pricing = null;
      current.listings = {}; current.reviews = {}; current.publications = {}; advance('sku_selected');
    }
    current.workspace = 'evidence'; return save();
  },
  async openFactReview(sku: string) {
    await delay(180);
    const p = current.catalog.find(p => p.sku === sku);
    if (!p) throw new Error('Unknown SKU');
    if (!current.task) current.task = clone(demoTask);
    if (current.selectedSku !== sku) {
      current.selectedSku = sku; current.v1 = cardV1(p); current.v2 = null;
      current.listings = {}; current.reviews = {}; current.publications = {};
      advance('sku_selected');
    }
    current.pricing = pricingFor(p); current.workspace = 'evidence';
    return save();
  },
  async editFact(key: string, value: string) { await delay(180); return changeFact(key, 'edit', value); },
  async confirmFact(key: string) { await delay(180); return changeFact(key, 'confirm'); },
  async rejectFact(key: string) { await delay(180); return changeFact(key, 'reject'); },
  evidence(sku: string): Evidence[] {
    const p = current.catalog.find(p => p.sku === sku);
    if (!p) return [];
    return [
      { id: 'EV-001', type: 'sheet', name: p.importSource ? 'Imported Supplier File' : 'Supplier Spreadsheet', file: p.importSource?.fileName ?? 'supplier_catalog.xlsx', anchor: p.importSource ? `${p.importSource.fileName} · ${p.importSource.sheetName} · row ${p.importSource.row}` : `${sku} · Products & Packaging`, extracted: [`Color: ${p.color}`, `Straw: ${p.straw ? 'Included' : 'No straw'}`, `Packaging weight: ${p.packagingWeight ? `${p.packagingWeight} kg` : 'Missing'}`] },
      { id: 'EV-002', type: 'pdf', name: p.importSource ? 'Mock Specification PDF' : 'Specification PDF', file: 'bottle_specification.pdf', anchor: 'Page 1 · specifications', extracted: [`Capacity: ${p.capacity}ml / ${p.localizedCapacity}`, `Body: ${p.material}`, 'Lid: Screw-top lid'] },
      { id: 'EV-003', type: 'image', name: p.importSource ? 'Mock Product / Packaging Images' : 'Product / Packaging Images', file: 'product_front.jpg + package_contents.jpg', anchor: 'Image 1 · exterior; image 2 · contents', extracted: [`Finish: Matte ${p.color.toLowerCase()}`, 'Package: Bottle, Lid, Instruction card', 'Leakproof performance: Not verified'] },
    ];
  },
  async analyzeEvidence() {
    await delay(700);
    const p = selected();
    if (!current.v1 || !current.task) throw new Error('Select a product and task first.');
    if (!current.v2) {
      current.v2 = { version: 2, sku: p.sku, taskId: current.task.id, facts: [...clone(current.v1.facts),
        fact('packageIncludes', 'Package includes', 'Bottle, Lid, Instruction card', p.importSource ? 'Mock Packaging Image' : 'Packaging Image', 'Image 2 · contents', true, p.sku === HERO_SKU),
        fact('finish', 'Finish', `Matte ${p.color.toLowerCase()}`, p.importSource ? 'Mock Product Image' : 'Product Image', 'Image 1 · exterior', true, p.sku === HERO_SKU),
        fact('lidType', 'Lid type', 'Screw-top lid', p.importSource ? 'Mock Specification PDF' : 'Specification PDF', 'Page 1 · closure', true, p.sku === HERO_SKU),
        fact('leakproof', 'Leakproof performance', '100% leakproof', 'Supplier claim', 'Unverified · no supporting test report', false, false),
      ] };
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
    const listing = current.listings[current.platform];
    if (!listing) throw new Error('Generate a listing first.');
    Object.assign(listing, clone(edit)); listing.revision += 1;
    delete current.reviews[current.platform]; delete current.publications[current.platform];
    advance('listing_generated'); return save();
  },
  async runReview() {
    await delay(650);
    const listing = current.listings[current.platform];
    if (!listing) throw new Error('Generate a listing first.');
    const issues = reviewIssues(listing);
    current.reviews[current.platform] = { status: issues.length ? 'blocked' : 'passed', revision: listing.revision, issues };
    delete current.publications[current.platform];
    advance(issues.length ? 'review_blocked' : 'review_passed'); return save();
  },
  async applyFix() {
    await delay(350);
    const listing = current.listings[current.platform];
    if (!listing) throw new Error('Generate a listing first.');
    current.listings[current.platform] = safeListing(current.platform, listing.revision + 1);
    delete current.reviews[current.platform]; delete current.publications[current.platform];
    advance('listing_generated'); return save();
  },
  canPublish() {
    if (!this.listingReady()) return false;
    const listing = current.listings[current.platform]; const review = current.reviews[current.platform];
    return !!listing && (listing.factRevision ?? 0) === factRevision(current.selectedSku!) && review?.status === 'passed' && review.revision === listing.revision && current.pricing?.status === 'ready' && reviewIssues(listing).length === 0;
  },
  async publish() {
    await delay(750);
    if (!this.canPublish()) throw new Error('Publish blocked: the current revision must pass review.');
    const platform = current.platform;
    current.publications[platform] = { platform, productId: platform === 'shopify' ? 'SHOP-DEMO-1042' : 'AMZ-DEMO-1042', status: platform === 'shopify' ? 'Draft' : 'Export ready', revision: current.listings[platform]!.revision };
    advance('published'); return save();
  },
  exportCsv() {
    if (current.platform !== 'amazon' || !current.publications.amazon || !this.canPublish()) throw new Error('Publish the reviewed Amazon draft before exporting.');
    const listing = current.listings.amazon!;
    const rows = [
      ['sku', 'title', 'bullet_point_1', 'bullet_point_2', 'bullet_point_3', 'bullet_point_4', 'bullet_point_5', 'description', 'price', 'currency', 'marketplace', 'status'],
      [current.selectedSku!, listing.title, ...Array.from({ length: 5 }, (_, i) => listing.bullets[i] ?? ''), listing.description, current.pricing!.suggestedPrice!.toFixed(2), 'USD', 'Amazon US', 'Mock export'],
    ];
    const quote = (cell: string) => `"${cell.replace(/"/g, '""')}"`;
    return '\uFEFF' + rows.map(row => row.map(quote).join(',')).join('\r\n') + '\r\n';
  },
};
