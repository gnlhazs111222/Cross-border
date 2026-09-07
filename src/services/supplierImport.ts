import { read, utils, type WorkBook } from 'xlsx';
import { MAX_IMPORT_BYTES, MAX_IMPORT_ROWS, SUPPLIER_COLUMNS } from '../data/supplierTemplate';
import type { ImportIssue, ImportMode, ImportPreview, Product } from '../types';

type Column = typeof SUPPLIER_COLUMNS[number];
const blank = (value: unknown) => value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
const text = (value: unknown) => blank(value) ? '' : String(value).trim();

/** Parses fixed-template, local user files. Never evaluates formulas or sends file data anywhere. */
export async function parseSupplierFile(file: File, mode: ImportMode, existing: Product[]): Promise<ImportPreview> {
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
  if (range.e.c !== SUPPLIER_COLUMNS.length - 1 || range.s.r !== 0 || range.s.c !== 0) throw new Error('Unsupported supplier template. Use the exact sample column names.');
  const headers = SUPPLIER_COLUMNS.map((_, col) => sheet[utils.encode_cell({ r: 0, c: col })]);
  if (headers.some(cell => !cell || cell.f || typeof cell.v !== 'string')
    || new Set(headers.map(cell => cell.v)).size !== SUPPLIER_COLUMNS.length
    || !SUPPLIER_COLUMNS.every(column => headers.some(cell => cell.v === column))) {
    throw new Error('Unsupported supplier template. Use the exact sample column names.');
  }
  const columns = Object.fromEntries(headers.map((cell, i) => [cell.v, i])) as Record<Column, number>;
  const seen = new Set(mode === 'append' ? existing.map(p => p.sku) : []);
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
    for (const column of ['sku', 'productName', 'category', 'color', 'material', 'countryOfOrigin'] as const) {
      if (blank(values[column])) issue('required', column);
      else if (typeof values[column] !== 'string' || /^-/.test(text(values[column]))) issue('formula', column);
    }
    const numeric = (column: Column, optional = false, allowZero = false, integer = false) => {
      if (blank(values[column])) { if (!optional) issue('required', column); return undefined; }
      const raw = values[column];
      const number = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d+(?:\.\d+)?$/.test(raw.trim()) ? Number(raw) : NaN;
      if (!Number.isFinite(number) || (allowZero ? number < 0 : number <= 0) || (integer && !Number.isInteger(number))) { issue('number', column); return undefined; }
      return number;
    };
    const capacity = numeric('capacityMl', false, false, true);
    const supplierCost = numeric('supplierCost', false, true);
    const declaredValue = numeric('declaredValue', false, true);
    const packagingWeight = numeric('packagingWeightKg', true);
    const length = numeric('packageLengthCm', true); const width = numeric('packageWidthCm', true); const height = numeric('packageHeightCm', true);
    const strawValue = text(values.hasStraw).toLowerCase();
    if (!['true', 'false', '1', '0'].includes(strawValue)) issue('boolean', 'hasStraw');
    const sku = text(values.sku);
    if (issues.length) { preview.invalid++; preview.rows.push({ row: row + 1, sku, status: 'invalid', issues }); continue; }
    if (seen.has(sku)) {
      preview.duplicates++; preview.rows.push({ row: row + 1, sku, status: 'duplicate', issues: [{ code: 'duplicate', field: 'sku' }] }); continue;
    }
    seen.add(sku);
    const missing = [...(packagingWeight === undefined ? ['Packaging Weight'] : []), ...([length, width, height].some(n => n === undefined) ? ['Packaging Dimensions'] : [])];
    const category = text(values.category);
    const product: Product = {
      sku, name: text(values.productName), category, color: text(values.color), capacity: capacity!,
      localizedCapacity: `${(capacity! / 29.5735295625).toFixed(1)} fl oz`, material: text(values.material),
      straw: strawValue === 'true' || strawValue === '1', countryOfOrigin: text(values.countryOfOrigin),
      supplierCost: supplierCost!, declaredValue: declaredValue!, packagingWeight,
      packagingDimensions: [length, width, height].every(n => n !== undefined) ? `${length} × ${width} × ${height} cm` : undefined,
      status: missing.length ? 'missing_data' : 'search_ready', duplicateStatus: 'unique', missing,
      visual: category === 'Bags & Accessories' ? 'bag' : category === 'Electronics' ? 'lamp' : 'bottle',
      importSource: { fileName: file.name, sheetName, row: row + 1 },
    };
    preview.products.push(product);
    if (missing.length) preview.missing++; else preview.ready++;
    preview.rows.push({ row: row + 1, sku, status: missing.length ? 'missing_data' : 'ready', issues: missing.map(field => ({ code: 'missing', field })) });
  }
  if (!preview.processed) throw new Error('No data rows found. Add products below the template header.');
  return preview;
}
