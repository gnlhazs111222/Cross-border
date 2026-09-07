import { demoTask, HERO_SKU, products } from '../data/mockData';
import type { DemoState, Evidence, Fact, FactCard, Listing, Platform, Pricing, Product, Recommendation, Stage, Workspace } from '../types';

export const STORAGE_KEY = 'prismlaunch.demo.v1';
const delay = (ms = 420) => new Promise<void>(resolve => setTimeout(resolve, ms));
const clone = <T,>(value: T): T => structuredClone(value);
const initialState = (): DemoState => ({
  schemaVersion: 1, workspace: 'materials', stage: 'initial', history: ['initial'],
  task: null, selectedSku: null, v1: null, v2: null, pricing: null, platform: 'amazon',
  listings: {}, reviews: {}, publications: {},
});
let storageAvailable = true;
function hydrate(): DemoState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return initialState();
    const s = JSON.parse(raw) as DemoState;
    if (s.schemaVersion !== 1 || !['materials', 'tasks', 'evidence', 'studio', 'review'].includes(s.workspace)
      || !['amazon', 'shopify'].includes(s.platform) || !Array.isArray(s.history)
      || !s.listings || !s.reviews || !s.publications
      || (s.selectedSku && !products.some(p => p.sku === s.selectedSku))) return initialState();
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
  const product = products.find(p => p.sku === current.selectedSku);
  if (!product) throw new Error('Select a product first.');
  return product;
}
function eligible(p: Product) {
  return p.status === 'search_ready' && p.duplicateStatus === 'unique' && p.category === demoTask.category;
}
function fact(key: string, label: string, value: string, source: string, anchor: string, allowed = true, confirmed = true): Fact {
  return { key, label, value, source, anchor, allowed, status: confirmed ? 'Confirmed' : 'Requires Confirmation' };
}
function cardV1(p: Product): FactCard {
  return { version: 1, sku: p.sku, facts: [
    fact('color', 'Color', p.color, 'Supplier Spreadsheet', 'Products · column D'),
    fact('capacity', 'Capacity', `${p.capacity}ml / ${p.localizedCapacity}`, 'Specification PDF', 'Page 1 · specifications'),
    fact('material', 'Material', p.material, 'Specification PDF', 'Page 1 · body material'),
    fact('straw', 'Straw', p.straw ? 'Included' : 'No straw', 'Supplier Spreadsheet', 'Products · column F'),
    fact('countryOfOrigin', 'Country of origin', p.countryOfOrigin, 'Supplier Spreadsheet', 'Products · column G'),
    fact('packagingWeight', 'Packaging weight', p.packagingWeight ? `${p.packagingWeight} kg` : 'Missing', 'Supplier Spreadsheet', 'Packaging · column C', false, !!p.packagingWeight),
    fact('supplierCost', 'Supplier cost', `USD ${p.supplierCost.toFixed(2)}`, 'Supplier Spreadsheet', 'Commercial · column B', false),
    fact('declaredValue', 'Declared value', 'USD 8.20', 'Supplier Spreadsheet', 'Commercial · column C', false),
  ] };
}
function pricingFor(p: Product): Pricing {
  const missing = [...(!p.packagingWeight ? ['Packaging Weight'] : []), ...(!p.packagingDimensions ? ['Packaging Dimensions'] : [])];
  return { version: 'v1', status: missing.length ? 'blocked' : 'ready', supplierCost: p.supplierCost,
    shipping: 3.1, duty: 0.7, platformCost: 2.2, targetProfit: 5,
    suggestedPrice: missing.length ? null : p.sku === HERO_SKU ? 19.99 : Math.ceil((p.supplierCost + 3.1 + 0.7 + 2.2 + 5) * 100) / 100,
    missing };
}
function safeListing(platform: Platform, revision = 1): Listing {
  if (!current.v2 || current.pricing?.status !== 'ready') throw new Error('Analyze evidence and resolve pricing before generating a listing.');
  const sources = current.v2.facts.filter(f => f.allowed && f.status === 'Confirmed');
  const value = (key: string) => sources.find(f => f.key === key)?.value;
  const color = value('color'); const capacity = value('capacity'); const material = value('material');
  if (!color || !capacity || !material) throw new Error('Required confirmed facts are missing.');
  const lid = value('lidType'); const includes = value('packageIncludes');
  return {
    platform, revision, riskDemoInjected: false,
    title: `${color} ${material} Travel Bottle, ${capacity}${lid ? ', Screw-top Lid' : ''}`,
    bullets: [
      `${capacity} capacity for your everyday routine.`,
      `${material} body${value('finish') ? ` with a ${value('finish')!.toLowerCase()} finish` : ''}.`,
      ...(lid ? ['Secure screw-top lid designed for everyday carrying.'] : []),
      ...(value('straw') === 'No straw' ? ['A simple, straw-free design.'] : ['Includes a straw.']),
      ...(includes ? [`In the box: ${includes}.`] : []),
    ],
    description: `Meet your everyday travel bottle. A ${color.toLowerCase()} ${material.toLowerCase()} body holds ${capacity}.${lid ? ' Finished with a screw-top lid.' : ''}${includes ? ` Includes ${includes.toLowerCase()}.` : ''}`,
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
  async getCatalog() { await delay(180); return clone(products); },
  getTaskTemplate: () => clone(demoTask),
  async ready() { if (current.stage === 'initial') advance('materials_ready'); return save(); },
  navigate(workspace: Workspace) { current.workspace = workspace; return save(); },
  async reset() { await delay(180); current = initialState(); return save(); },
  async createTask() {
    await delay();
    if (current.stage === 'initial') advance('materials_ready');
    if (!current.task) { current.task = clone(demoTask); advance('task_created'); }
    current.workspace = 'tasks'; return save();
  },
  recommendations(): Recommendation[] {
    if (!current.task) return [];
    return products.filter(eligible).map(p => {
      const reasons: string[] = []; const deductions: string[] = []; let score = 94;
      if (p.color === 'Black') reasons.push('Black matches requested color');
      else { score -= 23; deductions.push('Color does not match requested black'); }
      if (p.capacity === 500) reasons.push('500ml / 16.9 fl oz closely matches target capacity');
      else { score -= 16; deductions.push('Capacity too large: 750ml / 25.4 fl oz'); }
      if (!p.straw) reasons.push('No straw');
      else { score -= 12; deductions.push('Includes straw: does not meet the no-straw preference'); }
      reasons.push('Packaging information is complete');
      return { sku: p.sku, score, reasons, deductions };
    }).sort((a, b) => b.score - a.score).slice(0, 3);
  },
  exclusionReason(p: Product) {
    if (p.duplicateStatus === 'duplicate') return 'Exact duplicate · excluded from recommendations';
    if (p.duplicateStatus === 'possible_duplicate') return 'Possible duplicate · human verification required';
    if (p.status === 'missing_data') return `Missing ${p.missing.join(', ')} · excluded from recommendations`;
    if (p.category !== demoTask.category) return 'Category mismatch · outside Home & Kitchen';
    return 'Eligible for the candidate pool';
  },
  isEligible: eligible,
  previewPricing: (sku: string) => { const p = products.find(p => p.sku === sku); if (!p) throw new Error('Unknown SKU'); return pricingFor(p); },
  getFacts: (sku: string) => { const p = products.find(p => p.sku === sku); if (!p) throw new Error('Unknown SKU'); return cardV1(p); },
  async selectSku(sku: string) {
    await delay();
    if (!current.task) throw new Error('Create a launch task first.');
    const p = products.find(p => p.sku === sku);
    if (!p || !eligible(p)) throw new Error('This product is not eligible for recommendation. Inspect missing data in Materials.');
    if (current.selectedSku !== sku) {
      current.selectedSku = sku; current.v1 = cardV1(p); current.v2 = null; current.pricing = null;
      current.listings = {}; current.reviews = {}; current.publications = {}; advance('sku_selected');
    }
    current.workspace = 'evidence'; return save();
  },
  evidence(sku: string): Evidence[] {
    const p = products.find(p => p.sku === sku);
    if (!p) return [];
    return [
      { id: 'EV-001', type: 'sheet', name: 'Supplier Spreadsheet', file: 'supplier_catalog.xlsx', anchor: `${sku} · Products & Packaging`, extracted: [`Color: ${p.color}`, `Straw: ${p.straw ? 'Included' : 'No straw'}`, `Packaging weight: ${p.packagingWeight ? `${p.packagingWeight} kg` : 'Missing'}`] },
      { id: 'EV-002', type: 'pdf', name: 'Specification PDF', file: 'bottle_specification.pdf', anchor: 'Page 1 · specifications', extracted: [`Capacity: ${p.capacity}ml / ${p.localizedCapacity}`, `Body: ${p.material}`, 'Lid: Screw-top lid'] },
      { id: 'EV-003', type: 'image', name: 'Product / Packaging Images', file: 'product_front.jpg + package_contents.jpg', anchor: 'Image 1 · exterior; image 2 · contents', extracted: [`Finish: Matte ${p.color.toLowerCase()}`, 'Package: Bottle, Lid, Instruction card', 'Leakproof performance: Not verified'] },
    ];
  },
  async analyzeEvidence() {
    await delay(700);
    const p = selected();
    if (!current.v1 || !current.task) throw new Error('Select a product and task first.');
    if (!current.v2) {
      current.v2 = { version: 2, sku: p.sku, taskId: current.task.id, facts: [...clone(current.v1.facts),
        fact('packageIncludes', 'Package includes', 'Bottle, Lid, Instruction card', 'Packaging Image', 'Image 2 · contents'),
        fact('finish', 'Finish', `Matte ${p.color.toLowerCase()}`, 'Product Image', 'Image 1 · exterior'),
        fact('lidType', 'Lid type', 'Screw-top lid', 'Specification PDF', 'Page 1 · closure'),
        fact('leakproof', 'Leakproof performance', '100% leakproof', 'Supplier claim', 'Unverified · no supporting test report', false, false),
      ] };
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
    const listing = current.listings[current.platform]; const review = current.reviews[current.platform];
    return !!listing && review?.status === 'passed' && review.revision === listing.revision && current.pricing?.status === 'ready' && reviewIssues(listing).length === 0;
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
