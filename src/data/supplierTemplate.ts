// Exact header names; their order may vary. No semantic column guessing.
export const SUPPLIER_COLUMNS = [
  'sku', 'productName', 'category', 'color', 'capacityMl', 'material', 'hasStraw',
  'countryOfOrigin', 'supplierCost', 'declaredValue', 'packagingWeightKg',
  'packageLengthCm', 'packageWidthCm', 'packageHeightCm',
] as const;
export const MAX_IMPORT_ROWS = 500;
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
/**
 * Optional columns. `images`/`specs`/`assetUrls`/`imageUrls` carry file references or links; the rest
 * are analysis columns our own exports add (model, brand, variant, source row…). Recognised optional
 * columns are read, everything else is ignored rather than rejected, so an enriched sheet still
 * imports as long as the required columns are there.
 */
export const OPTIONAL_COLUMNS = ['images', 'specs', 'assetUrls', 'imageUrls', 'model', 'brand', 'productType', 'variant', 'sourceRow', 'estimatedFields'] as const;
/** Hard ceiling so a stray spreadsheet with hundreds of columns is still refused. */
export const MAX_IMPORT_COLUMNS = 40;
