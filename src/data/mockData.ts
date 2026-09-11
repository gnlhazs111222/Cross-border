import type { Product, Task } from '../types';

export const HERO_SKU = 'LM-KT-BTL-001-BLK-500';
const base: Product = {
  sku: HERO_SKU, name: 'Black Stainless Steel Travel Bottle', category: 'Home & Kitchen',
  color: 'Black', capacity: 500, localizedCapacity: '16.9 fl oz', material: 'Stainless Steel',
  straw: false, countryOfOrigin: 'China', status: 'search_ready', duplicateStatus: 'unique',
  packagingWeight: 0.38, packagingDimensions: '8 × 8 × 25 cm', supplierCost: 8.2, declaredValue: 8.2, missing: [], visual: 'bottle',
};
export const products: Product[] = [
  base,
  { ...base, sku: 'LM-KT-BTL-002-BLK-500', name: 'Black Straw Travel Bottle', straw: true, supplierCost: 8.6 },
  { ...base, sku: 'LM-KT-BTL-003-BLK-750', name: 'Black Large Travel Bottle', capacity: 750, localizedCapacity: '25.4 fl oz', packagingWeight: 0.49, supplierCost: 9.4 },
  { ...base, sku: 'LM-KT-BTL-004-WHT-500', name: 'Ivory Stainless Steel Bottle', color: 'Ivory' },
  { ...base, sku: 'LM-KT-BTL-005-BLK-500', name: 'Black Everyday Bottle', status: 'missing_data', packagingWeight: undefined, missing: ['Packaging Weight'] },
  { ...base, sku: 'LM-KT-BTL-006-GRN-500', name: 'Sage Commuter Bottle', color: 'Sage', status: 'missing_data', packagingDimensions: undefined, missing: ['Packaging Dimensions', 'Accessory Information'] },
  { ...base, sku: 'LM-KT-BTL-007-BLK-500', name: 'Black Travel Bottle · duplicate', duplicateStatus: 'duplicate' },
  { ...base, sku: 'LM-KT-BTL-008-BLK-500', name: 'Black Travel Bottle · unverified', duplicateStatus: 'possible_duplicate' },
  { ...base, sku: 'LM-BG-TOT-009-BLK', name: 'Everyday Canvas Tote', category: 'Bags & Accessories', capacity: 0, localizedCapacity: '—', material: 'Canvas', visual: 'bag' },
  { ...base, sku: 'LM-EL-LMP-010-BLK', name: 'Compact Desk Lamp', category: 'Electronics', capacity: 0, localizedCapacity: '—', material: 'Aluminum', visual: 'lamp' },
];
export const demoTask: Task = {
  id: 'PL-DEMO-001', platform: 'Amazon US', market: 'United States', category: 'Home & Kitchen',
  requirements: ['Black', 'Minimal commuter style', 'Around 16 oz', 'No straw', 'Prefer complete packaging and accessory information'], minProfit: 5,
};
export const bagDemoTask: Task = {
  id: 'PL-DEMO-BAG-001', platform: 'Amazon US', market: 'United States', category: 'Bags & Accessories',
  requirements: ['Black canvas tote bag', 'Simple everyday carry', 'Prefer visible shoulder straps and an open top'], minProfit: 5,
};
