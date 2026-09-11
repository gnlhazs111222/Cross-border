import { writeFileSync } from 'node:fs';
import { compareAll, shortlistRecords, summarizeAlignment, summarizeShortlist, type AlignableRecord } from '../shared/alignment';
import { readConfig } from '../server/config';
import { createDb } from '../server/db';
import { alignmentRecordsFromCatalog, imageHashCounts } from '../server/services/alignment';

/**
 * Alignment report against the stored pool, including uploaded image hashes.
 *
 * Usage: npm run align:catalog -- [--user demo@prismlaunch.local] [--pairs .local/catalog-pairs.csv] [--json .local/catalog.json]
 *
 * Read-only: opens the SQLite file directly, never starts the API and never calls a model.
 * Upload images through the Materials page first; every image sha256 becomes alignment evidence.
 */

const args = process.argv.slice(2);
const optionValue = (name: string): string | undefined => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};
const email = optionValue('user') ?? 'demo@prismlaunch.local';
const pairsOut = optionValue('pairs') ?? '.local/catalog-pairs-to-review.csv';
const jsonOut = optionValue('json');

const config = readConfig();
const db = createDb(config.DATABASE_URL);

try {
  const user = await db.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`No user ${email} in ${config.DATABASE_URL}. Start the app once so the demo account exists, or pass --user.`);
    process.exit(2);
  }
  const records: AlignableRecord[] = await alignmentRecordsFromCatalog(db, user.id);
  const hashCounts = await imageHashCounts(db, user.id);
  const results = compareAll(records);
  const summary = summarizeAlignment(records, results);
  const shortlist = shortlistRecords(records);
  const workload = summarizeShortlist(shortlist, records.length);
  const percent = (value: number) => summary.pairsConsidered ? `${(value / summary.pairsConsidered * 100).toFixed(1)}%` : '—';

  console.log('\nPrismLaunch · catalog alignment report');
  console.log('='.repeat(78));
  console.log(`database                  ${config.DATABASE_URL}`);
  console.log(`user                      ${email}`);
  console.log(`products                  ${records.length}`);
  console.log(`products with images      ${hashCounts.filter(entry => entry.images > 0).length}`);
  console.log(`distinct image hashes     ${new Set(hashCounts.flatMap(entry => entry.hashes)).size}`);
  console.log('-'.repeat(78));
  console.log(`pairs compared            ${summary.pairsConsidered}`);
  console.log(`confirmed same            ${summary.counts.same} (${percent(summary.counts.same)})`);
  console.log(`conflicts needing review  ${summary.counts.conflict} (${percent(summary.counts.conflict)})`);
  console.log(`grey zone (rule unsure)   ${summary.counts.probable} (${percent(summary.counts.probable)})`);
  console.log(`clearly unrelated         ${summary.counts.distinct} (${percent(summary.counts.distinct)})`);
  console.log(`records needing review    ${workload.needingReview} of ${workload.records}`);
  console.log(`  same / conflict / grey  ${workload.counts.same} / ${workload.counts.conflict} / ${workload.counts.probable}`);
  console.log(`ambiguous rows            ${workload.ambiguous} (more than one candidate)`);

  if (!hashCounts.length) {
    console.log('\nNo image assets stored yet, so the image-hash signal had nothing to work with.');
    console.log('Upload the same image file to two different SKUs from Materials → product → Source assets,');
    console.log('then run this report again: those two rows should become a confirmed match.');
  }

  const shared = results.filter(result => result.evidence.some(item => item.kind === 'image_hash' && item.verdict === 'agree'));
  if (shared.length) {
    console.log('\nPairs matched through image content');
    for (const result of shared) console.log(`  · ${result.a.label} ↔ ${result.b.label} — ${result.verdict}, score ${result.score.toFixed(3)}`);
  }
  if (summary.conflicts.length) {
    console.log('\nConflicts (same identity, disagreeing key attributes)');
    for (const result of summary.conflicts) {
      console.log(`  · ${result.a.label} ↔ ${result.b.label}`);
      for (const difference of result.differences) console.log(`      ${difference.key ? '[key] ' : '      '}${difference.field}: ${difference.a} vs ${difference.b}`);
    }
  }
  if (summary.grayZone.length) {
    console.log('\nGrey zone pairs');
    for (const result of summary.grayZone) {
      console.log(`  · ${result.a.label} ↔ ${result.b.label} — score ${result.score.toFixed(3)}`);
      console.log(`      ${result.evidence.filter(item => item.verdict === 'agree').map(item => item.detail).join(' · ')}`);
    }
  }

  const quote = (cell: string) => `"${cell.replace(/"/g, '""')}"`;
  const header = ['verdict', 'score', 'alternatives', 'record_label', 'record_sku', 'record_name', 'candidate_label', 'candidate_sku', 'candidate_name', 'key_differences', 'other_differences', 'agreements', 'human_label'];
  const rows = shortlist.map(entry => [
    entry.result.verdict, entry.result.score.toFixed(3), String(entry.alternatives), entry.record.label, entry.record.sku ?? '', entry.record.name ?? '', entry.candidate.label, entry.candidate.sku ?? '', entry.candidate.name ?? '',
    entry.result.differences.filter(item => item.key).map(item => `${item.field}: ${item.a} vs ${item.b}`).join(' | '),
    entry.result.differences.filter(item => !item.key).map(item => `${item.field}: ${item.a} vs ${item.b}`).join(' | '),
    entry.result.evidence.filter(item => item.verdict === 'agree').map(item => item.detail).join(' | '), '',
  ]);
  writeFileSync(pairsOut, '\uFEFF' + [header, ...rows].map(row => row.map(quote).join(',')).join('\r\n') + '\r\n');
  console.log(`\nPairs to review           ${pairsOut}`);
  if (jsonOut) {
    writeFileSync(jsonOut, JSON.stringify({ generatedAt: new Date().toISOString(), database: config.DATABASE_URL, user: email, records, hashCounts, summary }, null, 2));
    console.log(`Full report written to    ${jsonOut}`);
  }
  console.log('');
} finally {
  await db.$disconnect();
}
