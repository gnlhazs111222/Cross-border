import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { read, utils } from 'xlsx';
import { SUPPLIER_COLUMNS } from '../src/data/supplierTemplate';
import { compareAll, shortlistRecords, summarizeAlignment, summarizeShortlist, type AlignableRecord, type MatchResult } from '../shared/alignment';

/**
 * Offline alignment report for real supplier files.
 *
 * Usage: npm run align:report -- path/to/a.csv path/to/b.xlsx [--json report.json]
 *
 * It answers the one question that decides whether embeddings are worth wiring in:
 * how often do two records land in the grey zone instead of being clearly the same, clearly
 * conflicting or clearly unrelated? No model, no API, no database.
 */

const args = process.argv.slice(2);
const optionValue = (name: string): string | undefined => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};
const jsonOut = optionValue('json');
const pairsOut = optionValue('pairs');
// Everything that is not an option name or an option value is treated as an input file.
const consumed = new Set<number>();
for (const name of ['json', 'pairs']) {
  const index = args.indexOf(`--${name}`);
  if (index >= 0) { consumed.add(index); consumed.add(index + 1); }
}
const files = args.filter((value, index) => !value.startsWith('--') && !consumed.has(index));

if (!files.length) {
  console.error('Usage: npm run align:report -- <file.csv|file.xlsx> [more files...] [--json report.json] [--pairs pairs.csv]');
  process.exit(2);
}

function rowsFrom(file: string): AlignableRecord[] {
  const extension = file.toLowerCase().split('.').at(-1);
  const buffer = readFileSync(file);
  const workbook = extension === 'csv'
    ? read(new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^\uFEFF/, ''), { type: 'string', raw: true, FS: ',' })
    : read(buffer, { type: 'buffer', cellFormula: false });
  const sheetName = workbook.SheetNames[0];
  const rows = utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[sheetName], { defval: '' });
  const text = (row: Record<string, unknown>, column: typeof SUPPLIER_COLUMNS[number]) => String(row[column] ?? '').trim();
  const number = (row: Record<string, unknown>, column: typeof SUPPLIER_COLUMNS[number]): number | string | undefined => {
    const raw = text(row, column);
    if (raw === '') return undefined;
    const parsed = Number(raw);
    // Capacity may legitimately be written as "16.9 fl oz"; keep the text so the aligner can convert it.
    return Number.isFinite(parsed) ? parsed : raw;
  };
  const name = basename(file);
  return rows.map((row, index) => {
    const dimensions = [number(row, 'packageLengthCm'), number(row, 'packageWidthCm'), number(row, 'packageHeightCm')];
    return {
      sourceId: name, label: `${name} · row ${index + 2}`,
      sku: text(row, 'sku'), name: text(row, 'productName'), category: text(row, 'category'),
      color: text(row, 'color'), capacity: number(row, 'capacityMl'), material: text(row, 'material'),
      straw: text(row, 'hasStraw'), countryOfOrigin: text(row, 'countryOfOrigin'),
      supplierCost: number(row, 'supplierCost'), packagingWeight: number(row, 'packagingWeightKg'),
      ...(dimensions.every(value => typeof value === 'number') ? { dimensions: `${dimensions.join(' × ')} cm` } : {}),
    };
  }).filter(record => record.sku || record.name);
}

const records = files.flatMap(rowsFrom);
const results = compareAll(records);
const summary = summarizeAlignment(records, results);
const shortlist = shortlistRecords(records);
const workload = summarizeShortlist(shortlist, records.length);
const crossFile = results.filter(result => result.a.sourceId !== result.b.sourceId);
const crossFileDuplicates = crossFile.filter(result => result.verdict === 'same');
const crossFileConflicts = crossFile.filter(result => result.verdict === 'conflict');
const crossFileGray = crossFile.filter(result => result.verdict === 'probable');
const rate = (value: number, total: number) => total ? `${(value / total * 100).toFixed(1)}%` : '—';

const line = (label: string, value: string | number) => console.log(`${label.padEnd(26, ' ')} ${value}`);
const describe = (result: MatchResult) => `score ${result.score.toFixed(3)} | ${result.a.label} ↔ ${result.b.label}`;
const describeEvidence = (result: MatchResult) => {
  const agree = result.evidence.filter(item => item.verdict === 'agree').map(item => item.detail);
  const differ = result.differences.map(item => `${item.field}: ${item.a} vs ${item.b}${item.key ? ' (key)' : ''}`);
  return [...agree, ...differ].slice(0, 6).join(' · ');
};

console.log('\nPrismLaunch · supplier alignment report');
console.log('='.repeat(78));
for (const file of files) line(`file: ${basename(file)}`, `${rowsFrom(file).length} records`);
line('records total', summary.records);
line('pairs compared', summary.pairsConsidered);
console.log('-'.repeat(78));
line('confirmed same', `${summary.counts.same} (${rate(summary.counts.same, summary.pairsConsidered)})`);
line('conflicts needing review', `${summary.counts.conflict} (${rate(summary.counts.conflict, summary.pairsConsidered)})`);
line('grey zone (rule unsure)', `${summary.counts.probable} (${rate(summary.counts.probable, summary.pairsConsidered)})`);
line('clearly unrelated', `${summary.counts.distinct} (${rate(summary.counts.distinct, summary.pairsConsidered)})`);
console.log('-'.repeat(78));
line('cross-file same', `${crossFileDuplicates.length}`);
line('cross-file conflicts', `${crossFileConflicts.length}`);
line('cross-file grey zone', `${crossFileGray.length}`);
line('records needing review', `${workload.needingReview} of ${workload.records} (${rate(workload.needingReview, workload.records)})`);
line('  of those: same', `${workload.counts.same}`);
line('  of those: conflicts', `${workload.counts.conflict}`);
line('  of those: grey zone', `${workload.counts.probable}`);
line('ambiguous rows', `${workload.ambiguous} (more than one candidate)`);
line('embedding hint', summary.grayZoneRate > 0.05 ? 'grey zone above 5% — consider an embedding scorer for this zone only' : 'grey zone below 5% — rules plus batch human review should be enough');

if (summary.conflicts.length) {
  console.log('\nConflicts (same identity, disagreeing key attributes)');
  for (const result of summary.conflicts.slice(0, 20)) {
    console.log(`  · ${describe(result)}`);
    for (const difference of result.differences) console.log(`      ${difference.key ? '[key] ' : '      '}${difference.field}: ${difference.a} vs ${difference.b}`);
  }
  if (summary.conflicts.length > 20) console.log(`  … ${summary.conflicts.length - 20} more`);
}

if (summary.grayZone.length) {
  console.log('\nGrey zone pairs (a human decides; this is where embeddings would help)');
  for (const result of summary.grayZone.slice(0, 20)) {
    console.log(`  · ${describe(result)}`);
    console.log(`      ${describeEvidence(result)}`);
  }
  if (summary.grayZone.length > 20) console.log(`  … ${summary.grayZone.length - 20} more`);
}

if (jsonOut) {
  writeFileSync(jsonOut, JSON.stringify({ generatedAt: new Date().toISOString(), files, summary, crossFile: { same: crossFileDuplicates.length, conflicts: crossFileConflicts.length, greyZone: crossFileGray.length }, results }, null, 2));
  console.log(`\nFull report written to ${jsonOut}`);
}

if (pairsOut) {
  // One row per record that needs a decision, with its best candidate and an empty label column.
  const quote = (cell: string) => `"${cell.replace(/"/g, '""')}"`;
  const header = ['verdict', 'score', 'alternatives', 'cross_source', 'record_source', 'record_sku', 'record_name', 'candidate_source', 'candidate_sku', 'candidate_name', 'key_differences', 'other_differences', 'agreements', 'human_label'];
  const rows = shortlist.map(entry => [
    entry.result.verdict, entry.result.score.toFixed(3), String(entry.alternatives), String(entry.record.sourceId !== entry.candidate.sourceId),
    entry.record.sourceId, entry.record.sku ?? '', entry.record.name ?? '', entry.candidate.sourceId, entry.candidate.sku ?? '', entry.candidate.name ?? '',
    entry.result.differences.filter(item => item.key).map(item => `${item.field}: ${item.a} vs ${item.b}`).join(' | '),
    entry.result.differences.filter(item => !item.key).map(item => `${item.field}: ${item.a} vs ${item.b}`).join(' | '),
    entry.result.evidence.filter(item => item.verdict === 'agree').map(item => item.detail).join(' | '), '',
  ]);
  writeFileSync(pairsOut, '\uFEFF' + [header, ...rows].map(row => row.map(quote).join(',')).join('\r\n') + '\r\n');
  console.log(`Pairs to review written to ${pairsOut} — fill human_label with same/different.`);
}
console.log('');
