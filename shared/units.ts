/**
 * Unit projection for platform-facing values.
 *
 * The database keeps one canonical, metric form (ml, kg, cm) because pricing, alignment and tariff
 * classification all compare numbers. Everything a person or a marketplace reads is derived here,
 * so switching the display locale never rewrites stored data.
 */

export type UnitSystem = 'metric' | 'us' | 'uk';

const ML_PER_US_FLOZ = 29.5735295625;
const ML_PER_UK_FLOZ = 28.4130625;
const KG_PER_LB = 0.45359237;
const CM_PER_INCH = 2.54;

export type UnitOption = { id: string; market: string; system: UnitSystem; label: string };

/** Markets we can be asked to publish to; the label is what the selector shows. */
export const UNIT_OPTIONS: UnitOption[] = [
  { id: 'us', market: 'United States', system: 'us', label: 'United States · fl oz / lb / in' },
  { id: 'uk', market: 'United Kingdom', system: 'uk', label: 'United Kingdom · fl oz (imperial) / lb / in' },
  { id: 'eu', market: 'European Union', system: 'metric', label: 'European Union · ml / kg / cm' },
  { id: 'cn', market: 'China', system: 'metric', label: 'China · ml / kg / cm' },
];

/** The selector offers one entry per system; EU and China share the metric one. */
export const UNIT_CHOICES: { system: UnitSystem; label: string }[] = [
  { system: 'us', label: 'US · fl oz / lb / in' },
  { system: 'uk', label: 'UK · fl oz (imperial) / lb / in' },
  { system: 'metric', label: 'Metric · ml / kg / cm' },
];

/** Defaults the selector from the task market so an Amazon US task opens in US units. */
export function systemForMarket(market: string | undefined): UnitSystem {
  const value = (market ?? '').trim().toLowerCase();
  if (/(united states|usa|^us$|amazon us|shopify us)/.test(value)) return 'us';
  if (/(united kingdom|uk|britain|england)/.test(value)) return 'uk';
  return 'metric';
}

const round = (value: number, digits = 2) => Number(value.toFixed(digits));
const trim = (value: number) => String(Number(value.toFixed(2)));

/** 500 ml -> "16.9 fl oz" (US) or "17.6 fl oz" (imperial UK); metric stays "500 ml". */
export function formatCapacity(ml: number, system: UnitSystem): string {
  if (system === 'metric') return `${trim(ml)} ml`;
  const perOunce = system === 'uk' ? ML_PER_UK_FLOZ : ML_PER_US_FLOZ;
  return `${round(ml / perOunce, 1)} fl oz`;
}

/** 0.38 kg -> "0.84 lb"; metric stays "0.38 kg". Light items read better in ounces. */
export function formatWeight(kg: number, system: UnitSystem): string {
  if (system === 'metric') return `${trim(kg)} kg`;
  const pounds = kg / KG_PER_LB;
  return `${round(pounds, 2)} lb`;
}

/** 8 cm -> "3.15 in"; metric stays "8 cm". */
export function formatLength(cm: number, system: UnitSystem): string {
  if (system === 'metric') return `${trim(cm)} cm`;
  return `${round(cm / CM_PER_INCH, 2)} in`;
}

export function formatDimensions(dimensions: [number, number, number] | undefined, system: UnitSystem): string | undefined {
  if (!dimensions) return undefined;
  const unit = system === 'metric' ? 'cm' : 'in';
  const values = dimensions.map(value => system === 'metric' ? trim(value) : round(value / CM_PER_INCH, 2));
  return `${values.join(' × ')} ${unit}`;
}

/** Parses the "8 × 8 × 25 cm" strings the pool stores, so both forms share one projector. */
export function dimensionsFromText(text: string | undefined): [number, number, number] | undefined {
  if (!text) return undefined;
  const values = (text.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
  if (values.length < 3) return undefined;
  const values3: [number, number, number] = [values[0], values[1], values[2]];
  return values3;
}

/**
 * Projects one stored fact value into the display system. Facts keep their supplier text — often both
 * systems at once ("500ml / 16.9 fl oz") — and every screen shows the single system the person picked,
 * so the unit-bearing keys are always rewritten and anything else is returned untouched.
 */
export function projectFactValue(key: string, value: string, system: UnitSystem): string {
  if (!value) return value;
  const first = (value.match(/\d+(?:\.\d+)?/g) ?? []).map(Number)[0];
  if (first === undefined) return value;
  if (key === 'capacity') return formatCapacity(first, system);
  if (key === 'packagingWeight') return formatWeight(first, system);
  if (key === 'packageLength' || key === 'packageWidth' || key === 'packageHeight') return formatLength(first, system);
  return value;
}
