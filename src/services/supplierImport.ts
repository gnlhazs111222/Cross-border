import { read, utils, type WorkBook } from 'xlsx';
import { MAX_IMPORT_BYTES, MAX_IMPORT_COLUMNS, MAX_IMPORT_ROWS, OPTIONAL_COLUMNS, SUPPLIER_COLUMNS } from '../data/supplierTemplate';
import type { ImportIssue, ImportMode, ImportPreview, Product } from '../types';

type Column = typeof SUPPLIER_COLUMNS[number];
/** Short names our own exports use, mapped onto the template names. */
const COLUMN_ALIASES: Record<string, string> = { straw: 'hasStraw' };
const blank = (value: unknown) => value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
const text = (value: unknown) => blank(value) ? '' : String(value).trim();

/** Parses fixed-template, local user files. Never evaluates formulas or sends file data anywhere. */
export async function parseSupplierFile(file: File, mode: ImportMode, _existing: Product[]): Promise<ImportPreview> {
  const extension = file.name.toLowerCase().split('.').at(-1);
  if (extension !== 'xlsx' && extension !== 'csv') throw new Error('Only .xlsx and .csv supplier files are supported.');
  if (file.size > MAX_IMPORT_BYTES) throw new Error('File too large. The demo supports files up to 2 MB.');
  if (!file.size) throw new Error('The supplier file is empty.');
  const buffer = await file.arrayBuffer();
  let workbook: WorkBook;
  try {
    if (extension === 'xlsx') {
      const bytes = new Uint8Array(buffer);
      if (bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 3 || bytes[3] !== 4) throw new Error('Not an XLSX workbook');
      workbook = read(buffer, { type: 'array', cellFormula: true, sheetRows: MAX_IMPORT_ROWS + 2 });
    } else {
      const csv = new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^\uFEFF/, '');
      workbook = read(csv, { type: 'string', raw: true, FS: ',', sheetRows: MAX_IMPORT_ROWS + 2 });
    }
  } catch { throw new Error('Could not read supplier file. Use a valid .xlsx workbook or UTF-8 CSV.'); }
  if (workbook.SheetNames.length !== 1) throw new Error('Unsupported supplier template. Use exactly one worksheet.');
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet['!ref']) throw new Error('The supplier file is empty.');
  const range = utils.decode_range(sheet['!fullref'] ?? sheet['!ref']);
  if (range.e.r > MAX_IMPORT_ROWS) throw new Error('Too many rows. The demo supports at most 500 data rows.');
  if (range.e.c < SUPPLIER_COLUMNS.length - 1 || range.e.c > MAX_IMPORT_COLUMNS - 1 || range.s.r !== 0 || range.s.c !== 0) throw new Error('Unsupported supplier template. Use the exact sample column names.');
  const headers = Array.from({ length: range.e.c + 1 }, (_, col) => sheet[utils.encode_cell({ r: 0, c: col })]);
  if (headers.some(cell => !cell || cell.f || typeof cell.v !== 'string')) throw new Error('Unsupported supplier template. The header row must be plain text.');
  if (new Set(headers.map(cell => cell.v)).size !== headers.length) throw new Error('Unsupported supplier template. Two columns share the same name.');
  const columns = Object.fromEntries(headers.map((cell, i) => [cell.v, i]));
  // A few short names appear in sheets we export ourselves ("straw" for "hasStraw"); accept them so
  // an enriched sheet is not rejected over a naming difference nobody intended.
  for (const [alias, canonical] of Object.entries(COLUMN_ALIASES)) if (columns[alias] !== undefined && columns[canonical] === undefined) columns[canonical] = columns[alias];
  const missingColumns = SUPPLIER_COLUMNS.filter(column => columns[column] === undefined);
  if (missingColumns.length) throw new Error(`Unsupported supplier template. Missing required column(s): ${missingColumns.join(', ')}.`);
  // Rows are never pre-filtered by what the pool already has: the server aligns them instead of
  // skipping them, so an existing SKU can still surface as a conflict or a duplicate reference.
  const seen = new Set<string>();
  const preview: ImportPreview = { fileName: file.name, mode, processed: 0, ready: 0, missing: 0, duplicates: 0, invalid: 0, rows: [], products: [] };
  for (let row = 1; row <= range.e.r; row++) {
    const cells = Object.fromEntries(SUPPLIER_COLUMNS.map(column => [column, sheet[utils.encode_cell({ r: row, c: columns[column] })]]));
    if (SUPPLIER_COLUMNS.every(column => blank(cells[column]?.v) && !cells[column]?.f)) continue;
    preview.processed++;
    const issues: ImportIssue[] = [];
    const issue = (code: ImportIssue['code'], field: string) => issues.push({ code, field });
    const values = Object.fromEntries(SUPPLIER_COLUMNS.map(column => [column, cells[column]?.v])) as Record<Column, unknown>;
    for (const column of SUPPLIER_COLUMNS) {
      if (cells[column]?.f || cells[column]?.t === 'e' || /^[=+@]/.test(text(values[column]))) issue('formula', column);
      if (text(values[column]).length > 220) issue('long', column);
    }
    // A missing value is a data gap to fill later, not a broken row: only wrong formats stay fatal.
    const pendingFields: string[] = [];
    for (const column of ['sku', 'productName', 'category', 'color', 'material', 'countryOfOrigin'] as const) {
      if (blank(values[column])) pendingFields.push(column);
      else if (typeof values[column] !== 'string' || /^-/.test(text(values[column]))) issue('formula', column);
    }
    const numeric = (column: Column, optional = false, allowZero = false, integer = false) => {
      if (blank(values[column])) { if (!optional) issue('required', column); return undefined; }
      const raw = values[column];
      const number = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d+(?:\.\d+)?$/.test(raw.trim()) ? Number(raw) : NaN;
      if (!Number.isFinite(number) || (allowZero ? number < 0 : number <= 0) || (integer && !Number.isInteger(number))) { issue('number', column); return undefined; }
      return number;
    };
    const capacity = numeric('capacityMl', true, true, true);
    const supplierCost = numeric('supplierCost', true, true);
    const declaredValue = numeric('declaredValue', true, true);
    const packagingWeight = numeric('packagingWeightKg', true);
    const length = numeric('packageLengthCm', true); const width = numeric('packageWidthCm', true); const height = numeric('packageHeightCm', true);
    const strawValue = text(values.hasStraw).toLowerCase();
    if (strawValue !== '' && !['true', 'false', '1', '0'].includes(strawValue)) issue('boolean', 'hasStraw');
    const sku = text(values.sku) || `IMPORT-${row + 1}`;
    const columnIndex = columns as unknown as Record<string, number | undefined>;
    const optionalValues = (OPTIONAL_COLUMNS as readonly string[]).flatMap(column => {
      const index = columnIndex[column];
      if (index === undefined) return [];
      return text(sheet[utils.encode_cell({ r: row, c: index })]?.v).split(/[;,\n]/).map(entry => entry.trim()).filter(Boolean);
    }).slice(0, 20);
    // Anything that looks like a link goes to the download channel; the rest is a local file name.
    const references = optionalValues.filter(entry => !/^https?:\/\//i.test(entry));
    const urls = optionalValues.filter(entry => /^https?:\/\//i.test(entry)).slice(0, 20);
    // Type and name must agree; the category is authoritative. Bags and lamps carry no capacity,
    // bottles must have one, which matches the server-side rule that guards the database.
    const rawCategory = text(values.category);
    const categoryVisual = rawCategory === 'Bags & Accessories' ? 'bag' : rawCategory === 'Electronics' ? 'lamp' : 'bottle';
    const keywordVisual = /包|bag|tote|backpack/i.test(text(values.productName)) ? 'bag' : /灯|lamp|light/i.test(text(values.productName)) ? 'lamp' : 'bottle';
    if (keywordVisual !== categoryVisual) issue('category', 'category');
    if (categoryVisual === 'bottle' && !(capacity && capacity > 0)) issue('number', 'capacityMl');    if (issues.length) { preview.invalid++; preview.rows.push({ row: row + 1, sku, status: 'invalid', issues }); continue; }
    if (seen.has(sku)) {
      preview.duplicates++; preview.rows.push({ row: row + 1, sku, status: 'duplicate', issues: [{ code: 'duplicate', field: 'sku' }] }); continue;
    }
    seen.add(sku);
    const PENDING_LABELS: Record<string, string> = { sku: 'SKU', productName: 'Product name', category: 'Category', color: 'Color', material: 'Material', countryOfOrigin: 'Country of origin' };
    const missing = [...pendingFields.map(field => PENDING_LABELS[field]), ...(capacity === undefined ? ['Capacity'] : []), ...(supplierCost === undefined ? ['Supplier cost'] : []), ...(declaredValue === undefined ? ['Declared value'] : []), ...(strawValue === '' ? ['Straw'] : []), ...(packagingWeight === undefined ? ['Packaging Weight'] : []), ...([length, width, height].some(n => n === undefined) ? ['Packaging Dimensions'] : [])];
    const category = text(values.category);
    const product: Product = {
      sku, name: text(values.productName), category, color: text(values.color), capacity: capacity ?? 0,
      localizedCapacity: capacity ? `${(capacity / 29.5735295625).toFixed(1)} fl oz` : '—', material: text(values.material),
      straw: strawValue === 'true' || strawValue === '1', countryOfOrigin: text(values.countryOfOrigin),
      supplierCost: supplierCost ?? 0, declaredValue: declaredValue ?? 0, packagingWeight,
      packageLength: length, packageWidth: width, packageHeight: height,
      packagingDimensions: [length, width, height].every(n => n !== undefined) ? `${length} × ${width} × ${height} cm` : undefined,
      status: missing.length ? 'missing_data' : 'search_ready', duplicateStatus: 'unique', missing,
      visual: category === 'Bags & Accessories' ? 'bag' : category === 'Electronics' ? 'lamp' : 'bottle',
      importSource: { fileName: file.name, sheetName, row: row + 1 },
      ...(references.length ? { assetReferences: references } : {}),
      ...(urls.length ? { assetUrls: urls } : {}),
    };
    preview.products.push(product);
    if (missing.length) preview.missing++; else preview.ready++;
    preview.rows.push({ row: row + 1, sku, status: missing.length ? 'missing_data' : 'ready', issues: missing.map(field => ({ code: 'missing', field })) });
  }
  if (!preview.processed) throw new Error('No data rows found. Add products below the template header.');
  return preview;
}
