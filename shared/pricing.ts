/**
 * The price calculation, the way the plan describes it: what the goods cost, what the freight brings
 * the parcel to (CIF), what the two duty layers and the import charge add, what the platform takes,
 * and what is left over the profit floor.
 *
 * The rates are a demo table with a version and a source, frozen per task by the pricing snapshot.
 * Where a public source is named, the figure came from that source; where it says "lookup pending",
 * it is a placeholder that has to be replaced before anything is quoted to a customer.
 */

export type DutyRule = { rate: number; basis: string };

export type PricingRates = {
  /** Billable weight is the greater of the actual weight and the volume weight: L x W x H / divisor. */
  volumetricDivisor: number;
  logistics: {
    currency: 'USD'; base: number; baseKg: number; step: number; stepKg: number;
    countries: Record<string, number>; version: string; source: string;
  };
  /** Duty charged by the origin country when the goods leave it: "CN|Home & Kitchen". */
  exportDuty: { byOriginCategory: Record<string, DutyRule>; fallback: DutyRule; version: string; source: string };
  /** Duty charged by the destination, on the CIF value: "US|Home & Kitchen". */
  importDuty: { byDestinationCategory: Record<string, DutyRule>; fallback: DutyRule; version: string; source: string };
  /** The second layer at the border: import VAT, or the sales tax a marketplace collects. */
  importTax: { byCountry: Record<string, DutyRule>; fallback: DutyRule; version: string; source: string };
  platform: { commission: number; fixed: number; version: string; source: string };
};

export type PriceBreakdown = {
  actualWeightKg: number;
  volumetricWeightKg: number;
  chargeableWeightKg: number;
  logistics: number;
  /** Cost, insurance and freight: the value the destination charges duty on. */
  cif: number;
  exportDuty: number;
  importDuty: number;
  importTax: number;
  platformFee: number;
  taxTotal: number;
  totalCost: number;
  targetProfit: number;
  suggestedPrice: number;
  unitProfit: number;
  rates: {
    logistics: string; exportDuty: string; importDuty: string; importTax: string; platform: string; divisor: number;
    origin: string; destination: string; countryMultiplier: number; commissionPct: number;
    exportBasis: string; importBasis: string; importTaxBasis: string;
  };
};

const rule = (rate: number, basis: string): DutyRule => ({ rate, basis });
const PENDING = 'lookup pending — replace with the official schedule';

/**
 * The public figures here were read from the sources named beside them; the rest wait for a lookup.
 * - Freight: demo table, first 0.5 kg plus stepped weight, with a per-country multiplier.
 * - US duty on vacuum flasks: HTS 9617.00.10.00 (7.2%, capacity not over 1 litre),
 *   plus the Section 301 List 4A additional 7.5% on Chinese-origin goods.
 * - US second layer: no federal VAT; the combined state and local sales tax ranges about 5.6%-13.5%,
 *   so the demo uses California's combined 8.25%.
 */
export const DEMO_PRICING_RATES: PricingRates = {
  volumetricDivisor: 5000,
  logistics: { currency: 'USD', base: 3.1, baseKg: 0.5, step: 1.2, stepKg: 0.5,
    countries: { US: 1, GB: 1.15, DE: 1.2, JP: 1.1 }, version: 'logistics-demo-v1', source: 'Demo freight table (first 0.5 kg + stepped)' },
  exportDuty: { byOriginCategory: { 'CN|Home & Kitchen': rule(0, 'Consumer goods are not on the export-duty schedule'), 'CN|Bags & Accessories': rule(0, 'Consumer goods are not on the export-duty schedule'), 'CN|Electronics': rule(0, 'Consumer goods are not on the export-duty schedule') },
    fallback: rule(0, PENDING), version: 'export-duty-demo-v1', source: 'China export duty schedule (consumer goods)' },
  importDuty: { byDestinationCategory: {
      'US|Home & Kitchen': rule(0.147, 'HTS 9617.00.10.00 (7.2%) + Section 301 List 4A (7.5%)'),
      'GB|Home & Kitchen': rule(0.12, PENDING), 'DE|Home & Kitchen': rule(0.12, PENDING) },
    fallback: rule(0.08, PENDING), version: 'import-duty-demo-v1', source: 'USITC HTS + USTR Section 301 (US); TARIC to be filled in' },
  importTax: { byCountry: { US: rule(0.0825, 'No federal VAT; combined California state and local sales tax'), GB: rule(0.2, 'UK VAT standard rate'), DE: rule(0.19, 'German VAT standard rate'), JP: rule(0.1, 'Japanese consumption tax') },
    fallback: rule(0.1, PENDING), version: 'import-tax-demo-v1', source: 'VAT and sales-tax reference rates' },
  platform: { commission: 0.15, fixed: 0, version: 'platform-fee-demo-v1', source: 'Demo marketplace fee (Amazon US)' },
};

const round = (value: number) => Math.round(value * 100) / 100;
const up = (value: number) => Math.ceil(value * 100 - 1e-9) / 100;

export const exportDutyRule = (rates: PricingRates, origin: string, category: string) =>
  rates.exportDuty.byOriginCategory[`${origin}|${category}`] ?? rates.exportDuty.fallback;
export const importDutyRule = (rates: PricingRates, destination: string, category: string) =>
  rates.importDuty.byDestinationCategory[`${destination}|${category}`] ?? rates.importDuty.fallback;
export const importTaxRule = (rates: PricingRates, destination: string) =>
  rates.importTax.byCountry[destination] ?? rates.importTax.fallback;
export const countryMultiplier = (rates: PricingRates, country: string) => rates.logistics.countries[country] ?? 1;

/** Billable weight: the plan's "weight and dimensions" input, not a constant. */
export function chargeableWeight(weightKg: number | undefined, dimensionsCm: readonly number[] | undefined, rates: PricingRates) {
  const actual = weightKg && weightKg > 0 ? weightKg : 0;
  const volume = dimensionsCm && dimensionsCm.length === 3 && dimensionsCm.every(side => side > 0)
    ? (dimensionsCm[0] * dimensionsCm[1] * dimensionsCm[2]) / rates.volumetricDivisor : 0;
  return { actualWeightKg: round(actual), volumetricWeightKg: round(volume), chargeableWeightKg: round(Math.max(actual, volume)) };
}

export type PriceInput = {
  supplierCost: number; declaredValue: number; weightKg?: number; dimensionsCm?: readonly number[];
  origin: string; destination: string; category: string; targetProfit: number; rates: PricingRates; floorPrice?: number;
};

/**
 * The freight prices the parcel, the freight goes into the CIF value, and the destination charges duty
 * on that value — which is how the weight reaches the taxes. The platform's share comes out of the
 * price, so the price is divided by (1 - commission) rather than having the fee added to it.
 */
export function priceFromRates(input: PriceInput): PriceBreakdown {
  const { rates } = input;
  const weight = chargeableWeight(input.weightKg, input.dimensionsCm, rates);
  const multiplier = countryMultiplier(rates, input.destination);
  const bands = weight.chargeableWeightKg > rates.logistics.baseKg
    ? Math.ceil((weight.chargeableWeightKg - rates.logistics.baseKg) / rates.logistics.stepKg) : 0;
  const logistics = round((rates.logistics.base + bands * rates.logistics.step) * multiplier);
  const cif = round(input.declaredValue + logistics);
  const exportRule = exportDutyRule(rates, input.origin, input.category);
  const importRule = importDutyRule(rates, input.destination, input.category);
  const taxRule = importTaxRule(rates, input.destination);
  const exportDuty = round(input.declaredValue * exportRule.rate);
  const importDuty = round(cif * importRule.rate);
  const importTax = round((cif + importDuty) * taxRule.rate);
  const taxTotal = round(logistics + exportDuty + importDuty + importTax);
  const commission = Math.min(Math.max(rates.platform.commission, 0), 0.9);
  const price = up((input.supplierCost + taxTotal + rates.platform.fixed + input.targetProfit) / (1 - commission));
  const suggestedPrice = Math.max(price, input.floorPrice ?? 0);
  const platformFee = round(suggestedPrice * commission + rates.platform.fixed);
  const totalCost = round(input.supplierCost + taxTotal);
  return { ...weight, logistics, cif, exportDuty, importDuty, importTax, platformFee, taxTotal, totalCost,
    targetProfit: round(suggestedPrice - totalCost - platformFee), suggestedPrice,
    unitProfit: round(suggestedPrice - totalCost - platformFee),
    rates: { logistics: rates.logistics.version, exportDuty: rates.exportDuty.version, importDuty: rates.importDuty.version,
      importTax: rates.importTax.version, platform: rates.platform.version, divisor: rates.volumetricDivisor,
      origin: input.origin, destination: input.destination, countryMultiplier: multiplier, commissionPct: commission,
      exportBasis: exportRule.basis, importBasis: importRule.basis, importTaxBasis: taxRule.basis } };
}
