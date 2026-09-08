import { z } from 'zod';
import type { Fact, Platform } from '../../src/types';
import { COPY_FACTS } from '../../src/services/factReview';
import { AppError } from '../errors';
export const authorizedCopyFacts = (facts: Fact[]) => facts.filter(f => f.status === 'Confirmed' && f.allowed && COPY_FACTS.includes(f.key));
export function listingOutputSchema(platform: Platform) {
  return z.object({
    title: z.string().trim().min(1).max(200), bullets: z.array(z.string().trim().min(1).max(300)).min(platform === 'amazon' ? 3 : 1).max(5),
    description: z.string().trim().min(1).max(1500), attributes: z.record(z.string().trim().min(1).max(220)),
    usedFacts: z.array(z.object({ field: z.string().min(1).max(40), value: z.string().trim().min(1).max(220) }).strict()).min(1).max(12),
  }).strict();
}
export type GeneratedListing = z.infer<ReturnType<typeof listingOutputSchema>>;
const normalized = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();
function variants(fact: Fact) { return fact.key === 'capacity' ? [fact.value, ...fact.value.split(' / ')] : [fact.value]; }
export function validateGeneratedListingAgainstFacts(output: GeneratedListing, facts: Fact[]) {
  const allowed = authorizedCopyFacts(facts); const byKey = new Map(allowed.map(f => [f.key, f])); const seen = new Set<string>();
  const fail = (code: string): never => { throw new AppError(code, 'Generated copy did not pass fact authorization.', 422); };
  for (const used of output.usedFacts) {
    const f = byKey.get(used.field);
    if (!f || seen.has(used.field) || !variants(f).some(v => normalized(v) === normalized(used.value))) fail('unauthorized_fact');
    seen.add(used.field);
  }
  for (const [key, value] of Object.entries(output.attributes)) {
    const f = allowed.find(f => f.label === key || f.key === key);
    if (!f || !seen.has(f.key) || ['__proto__', 'prototype', 'constructor'].includes(key) || !variants(f).some(v => normalized(v) === normalized(value))) fail('unauthorized_attribute');
  }
  const text = [output.title, ...output.bullets, output.description, ...Object.values(output.attributes)].join(' ');
  if (/<[^>]+>|https?:\/\/|supplier\s*cost|declared\s*value|freight|\bduty\b|wholesale|profit|\bUSD\b|\$|purchase\s*cost/i.test(text)) fail('internal_or_unsafe_content');
  const values = allowed.map(f => normalized(f.value)).join(' ');
  const risky = /100\s*%|leak[- ]?proof|waterproof|guarantee\w*|\balways\b|\bnever\b|certif\w*|\bFDA\b|\bBPA\b|warranty|dishwasher|microwave|insulat\w*|thermal|temperature.retention|keeps?.{0,20}(?:hot|cold)|non.?toxic|food.?safe|antibacterial|durab\w*|unbreakable|eco.?friendly|recycl\w*|sustainab\w*|lightweight|compatible/gi;
  for (const match of text.matchAll(risky)) if (!values.includes(normalized(match[0]))) fail('unsupported_claim');
  const allowedNumbers = new Set(allowed.flatMap(f => [...f.value.matchAll(/\d+(?:\.\d+)?/g)].map(m => m[0])));
  for (const match of text.matchAll(/\d+(?:\.\d+)?/g)) if (!allowedNumbers.has(match[0])) fail('unsupported_quantity');
  // Disallow undeclared or contradictory common spec tokens, including a made-up value hidden outside usedFacts.
  const groups: Record<string, RegExp> = { color: /\b(?:black|white|ivory|navy|blue|green|red|pink|silver|gold)\b/gi,
    material: /\b(?:stainless steel|plastic|glass|aluminum|silicone|ceramic|titanium)\b/gi };
  for (const [key, expression] of Object.entries(groups)) for (const match of text.matchAll(expression)) {
    if (!seen.has(key) || !normalized(byKey.get(key)?.value ?? '').includes(normalized(match[0]))) fail('unsupported_specification');
  }
  if (/\bstraw\b/i.test(text) && !seen.has('straw') && !byKey.get('packageIncludes')?.value.toLowerCase().includes('straw')) fail('unauthorized_fact');
  if (byKey.get('straw')?.value === 'No straw') {
    for (const match of text.matchAll(/\b(?:includes?|with)\s+(?:a\s+)?straw\b/gi)) {
      if (!/\b(?:not|no|without)\s*$/i.test(text.slice(Math.max(0, match.index! - 15), match.index))) fail('unsupported_specification');
    }
  } else if (byKey.get('straw')?.value === 'Included' && /no straw|straw[- ]free|without (?:a )?straw/i.test(text)) fail('unsupported_specification');
  if (/\b(?:ml|fl oz)\b/i.test(text) && !seen.has('capacity')) fail('unauthorized_fact');
  if (/\b(?:in the box|includes?|contents)\b/i.test(text) && !seen.has('packageIncludes') && !seen.has('straw')) fail('unauthorized_fact');
  return output;
}
