/**
 * A brief may name its category the way the interface writes it ("家居与厨房"), while the pool keeps the
 * canonical English names its rows were imported with. Both sides fold to one canonical value before they
 * are compared, so a Chinese brief still finds the products it describes.
 *
 * The fold is deliberately exact: two spellings of the English name are still two categories, so the pool
 * contract ("Home & Kitchen", never "home & kitchen") keeps rejecting near-misses.
 */
export const CATEGORY_ALIASES: Record<string, string> = {
  '家居与厨房': 'Home & Kitchen',
  '箱包与配饰': 'Bags & Accessories',
  '电子产品': 'Electronics',
};

export function canonicalCategory(value: string | undefined): string {
  const trimmed = (value ?? '').trim();
  return CATEGORY_ALIASES[trimmed] ?? trimmed;
}

/** True when both sides name the same category, whichever language each side was written in. */
export function sameCategory(left: string | undefined, right: string | undefined): boolean {
  const canonical = canonicalCategory(left);
  return !!canonical && canonical === canonicalCategory(right);
}
