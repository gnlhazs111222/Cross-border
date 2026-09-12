// Exact header names; their order may vary. No semantic column guessing.
export const SUPPLIER_COLUMNS = [
  'sku', 'productName', 'category', 'color', 'capacityMl', 'material', 'hasStraw',
  'countryOfOrigin', 'supplierCost', 'declaredValue', 'packagingWeightKg',
  'packageLengthCm', 'packageWidthCm', 'packageHeightCm',
] as const;
export const MAX_IMPORT_ROWS = 500;
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
/**
 * Quality report columns. They carry the report's own statements, not ours: the number, the result,
 * the validity window and the values it certified. When the columns are present the report is on
 * file; when `reportNo` is blank the SKU simply has none, which stays quiet instead of alarming.
 */
export const QUALITY_REPORT_COLUMNS = ['reportNo', 'reportResult', 'reportValidUntil', 'reportCapacityMl', 'reportMaterial'] as const;
/**
 * Optional columns. `images`/`specs`/`assetUrls`/`imageUrls` carry file references or links; the rest
 * are analysis columns our own exports add (model, brand, variant, source row…). Recognised optional
 * columns are read, everything else is ignored rather than rejected, so an enriched sheet still
 * imports as long as the required columns are there.
 */
/**
 * Columns that name a file or a link. They are the only optional columns read as evidence references:
 * the analysis and declaration columns next to them (transport flags, a quality report) are data, not
 * file names, and reading them as references used to send "false" and "Stainless Steel" to the check
 * as if they were missing pictures.
 */
export const ASSET_REFERENCE_COLUMNS = ['images', 'specs', 'assetUrls', 'imageUrls'] as const;
export const OPTIONAL_COLUMNS = ['images', 'specs', 'assetUrls', 'imageUrls', 'model', 'brand', 'productType', 'variant', 'sourceRow', 'estimatedFields', 'liquid', 'battery', 'magnetic', 'aerosol', 'flammable', 'fragile', ...QUALITY_REPORT_COLUMNS] as const;
/** Hard ceiling so a stray spreadsheet with hundreds of columns is still refused. */
export const MAX_IMPORT_COLUMNS = 48;
/** Transport attributes: they decide the hazmat verdict, and the verdict decides whether a listing may publish. */
export const TRANSPORT_COLUMNS = ['liquid', 'battery', 'magnetic', 'aerosol', 'flammable', 'fragile'] as const;
