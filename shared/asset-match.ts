import { normalizeSku } from './alignment';

export type AssetAssignment = { sku: string; fileName: string };
export type AssetMatchResult = {
  assignments: AssetAssignment[];
  /** References the sheet listed but the chosen folder did not contain. */
  missing: string[];
  /** Files nobody claimed: unreferenced, or their name carries no known SKU. */
  unreferenced: string[];
  /** A row that claimed several files, listed so a human can confirm the group. */
  grouped: string[];
};

/** A normalized SKU shorter than this is too weak to appear inside a file name safely. */
const MIN_SKU_LENGTH = 8;

/**
 * Aligns a folder of images with the products that should own them.
 *
 * Two anchors, in order: the reference the sheet lists for that row (normalized, so full-width
 * text, case and separators do not matter), then the SKU appearing inside the file name. Names
 * only — what a picture actually shows is a question for a later stage.
 */
export function matchAssetFiles(rows: { sku: string; assetReferences?: string[] }[], fileNames: string[]): AssetMatchResult {
  const assignments: AssetAssignment[] = [];
  const used = new Set<string>();
  const missing: string[] = [];
  const grouped: string[] = [];
  const byName = new Map(fileNames.map(name => [normalizeSku(name), name]));

  for (const row of rows) {
    for (const reference of row.assetReferences ?? []) {
      const file = byName.get(normalizeSku(reference));
      if (!file || used.has(file)) { missing.push(reference); continue; }
      used.add(file); assignments.push({ sku: row.sku, fileName: file });
    }
    const sku = normalizeSku(row.sku);
    if (sku.length < MIN_SKU_LENGTH) continue;
    const candidates = fileNames.filter(name => !used.has(name) && normalizeSku(name).includes(sku));
    if (candidates.length > 1) grouped.push(`${row.sku}: ${candidates.length} files`);
    for (const file of candidates) { used.add(file); assignments.push({ sku: row.sku, fileName: file }); }
  }
  return { assignments, missing, unreferenced: fileNames.filter(name => !used.has(name)), grouped };
}
