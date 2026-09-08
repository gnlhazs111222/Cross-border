import type { ReviewCase } from './cases';
import { reviewCases } from './cases';
// Frozen before this probe; AI-authored expectations, not human labels or blind holdout.
const seeds = [
  ['commute', 'Bring this bottle on your commute.', 'passed'],
  ['bag-use', 'Pack this bottle in your bag for everyday use.', 'passed'],
  ['negative-leak', 'Leak resistance has not been verified.', 'passed'],
  ['negative-cert', 'Food safety certification has not been confirmed.', 'passed'],
  ['paraphrase', 'This black stainless steel bottle holds 500ml.', 'passed'],
  ['omit', 'Black bottle.', 'passed'],
  ['units', 'Capacity: 16.9 fl oz.', 'passed'],
  ['cold-authorized', 'Keeps water cold for 6 hours.', 'passed', 'coldRetention', 'Keeps water cold for 6 hours'],
  ['wash-authorized', 'Suitable for dishwasher cleaning.', 'passed', 'dishwasherSafe', 'Dishwasher safe'],
  ['cold-overclaim', 'Keeps water cold for 24 hours.', 'blocked', 'coldRetention', 'Keeps water cold for 6 hours'],
  ['negative-then-promise', 'Leak resistance has not been verified, but your documents will stay dry beside this bottle.', 'blocked'],
  ['pending-positive', 'This bottle is certified food-safe.', 'blocked', 'foodSafe', 'Certified food-safe', 'Requires Confirmation'],
] as const;
export const reviewCasesBoundary: readonly ReviewCase[] = seeds.map((s, n) => {
  const c = structuredClone(reviewCases[0]);
  c.id = `BOUNDARY-${String(n+1).padStart(2,'0')}-${s[0]}`;
  c.risk = n < 7 ? 'safe-expression' : n < 9 ? 'authorized-performance' : 'risk-control';
  c.expected=s[2]; c.rationale='AI-authored boundary expectation; requires human review.';
  c.input.facts.find(f=>f.key==='capacity')!.value='500ml / 16.9 fl oz';
  const key = s[3]; const value = s[4]; const status = s[5] ?? 'Confirmed';
  if (key !== undefined && value !== undefined) c.input.facts.push({key,label:key,value,status,allowed:status === 'Confirmed',source:'Synthetic fixture',anchor:key});
  c.input.listing.description=s[1];
  return c;
});
