import type { Fact } from '../types';
import { canonicalFigure } from '../../shared/units';

export const PRICING_FACTS = ['packagingWeight', 'packageLength', 'packageWidth', 'packageHeight', 'supplierCost', 'declaredValue'];
export const COPY_FACTS = ['color', 'capacity', 'material', 'straw', 'countryOfOrigin', 'packageIncludes', 'finish', 'lidType', 'bagType', 'closureType', 'strapType'];
export const REQUIRED_COPY_FACTS = ['color', 'capacity', 'material'];
export function requiredCopyFactsFor(visual: 'bottle' | 'bag' | 'lamp') { return visual === 'bag' ? ['color', 'material', 'bagType'] : REQUIRED_COPY_FACTS; }
const TEXT_FACTS = ['color', 'material', 'countryOfOrigin', 'packageIncludes', 'finish', 'lidType', 'bagType', 'closureType', 'strapType'];
const UNITS: Record<string, string> = { capacity: 'ml', packagingWeight: 'kg', packageLength: 'cm', packageWidth: 'cm', packageHeight: 'cm', supplierCost: 'USD', declaredValue: 'USD' };

export function editableFact(key: string) { return TEXT_FACTS.includes(key) || key === 'straw' || Object.hasOwn(UNITS, key); }
export function factNumber(value: string) { return Number.parseFloat(value.replace(/^USD\s*/, '')); }
export function factEditor(fact: Fact) {
  const numeric = Object.hasOwn(UNITS, fact.key);
  return {
    kind: fact.key === 'straw' ? 'select' as const : numeric ? 'number' as const : 'text' as const,
    unit: UNITS[fact.key] ?? '',
    min: ['supplierCost', 'declaredValue'].includes(fact.key) ? 0 : fact.key === 'capacity' ? 1 : 0.000001,
    step: fact.key === 'capacity' ? '1' : 'any',
    value: fact.status === 'Missing' ? '' : numeric ? String(factNumber(fact.value)) : fact.value,
  };
}
export function normalizeFactValue(key: string, input: string): string {
  if (!editableFact(key)) throw new Error('This claim cannot be edited or confirmed in the demo.');
  const value = input.trim();
  if (!value) throw new Error('A value is required before confirmation.');
  if (value.length > 220 || /^[=+@]/.test(value)) throw new Error('Use a plain value of at most 220 characters.');
  if (Object.hasOwn(UNITS, key)) {
    const allowZero = ['supplierCost', 'declaredValue'].includes(key);
    /**
     * A typed value is a bare number in the field's canonical unit. A value read off a label or a document
     * carries its own unit ("420 g", "25.4 fl oz", "80 mm"), so the unit travels with the number and the
     * stored value is the canonical one — a 420 g reading is 0.42 kg, never 420 kg. Only a converted
     * reading is rounded (capacities to whole millilitres, weights and lengths to four decimals), because
     * those figures came from another system to begin with.
     */
    const bare = /^(?:USD\s*)?\d+(?:\.\d+)?$/.test(value);
    const stated = bare ? Number(value.replace(/^USD\s*/, '')) : canonicalFigure(key, value);
    const number = stated === undefined ? NaN : bare ? stated : key === 'capacity' ? Math.round(stated) : Number(stated.toFixed(4));
    if (!Number.isFinite(number) || number > 1_000_000 || (allowZero ? number < 0 : number <= 0) || (key === 'capacity' && !Number.isInteger(number))) {
      throw new Error(allowZero ? 'Enter a non-negative number up to 1000000.' : key === 'capacity' ? 'Enter a positive whole number up to 1000000.' : 'Enter a number greater than 0 and at most 1000000.');
    }
    if (key === 'capacity') return `${number}ml / ${(number / 29.5735295625).toFixed(1)} fl oz`;
    if (UNITS[key] === 'USD') return `USD ${number.toFixed(2)}`;
    return `${number} ${UNITS[key]}`;
  }
  if (key === 'straw' && !['Included', 'No straw'].includes(value)) throw new Error('Choose Included or No straw.');
  return value;
}
