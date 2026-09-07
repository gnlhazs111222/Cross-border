// Exact header names; their order may vary. No semantic column guessing.
export const SUPPLIER_COLUMNS = [
  'sku', 'productName', 'category', 'color', 'capacityMl', 'material', 'hasStraw',
  'countryOfOrigin', 'supplierCost', 'declaredValue', 'packagingWeightKg',
  'packageLengthCm', 'packageWidthCm', 'packageHeightCm',
] as const;
export const MAX_IMPORT_ROWS = 500;
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
