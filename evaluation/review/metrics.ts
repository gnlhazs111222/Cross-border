export type ExpectedStatus = 'passed' | 'blocked' | 'needs_human_review';
export type ActualStatus = ExpectedStatus | 'failed';
export type MetricRow = { expected: ExpectedStatus; actual: ActualStatus };
const ratio = (n: number, d: number) => d ? n / d : null;
export function summarizeReviewMetrics(rows: MetricRow[]) {
  const confusion = { tp: 0, tn: 0, fp: 0, fn: 0 };
  for (const row of rows) {
    if (row.expected === 'needs_human_review' || !['passed', 'blocked'].includes(row.actual)) continue;
    if (row.expected === 'blocked') row.actual === 'blocked' ? confusion.tp++ : confusion.fn++;
    else row.actual === 'blocked' ? confusion.fp++ : confusion.tn++;
  }
  const { tp, tn, fp, fn } = confusion;
  return {
    total: rows.length, confusion, failed: rows.filter(r => r.actual === 'failed').length,
    abstained: rows.filter(r => r.actual === 'needs_human_review').length,
    ambiguousExpected: rows.filter(r => r.expected === 'needs_human_review').length,
    ambiguousPassed: rows.filter(r => r.expected === 'needs_human_review' && r.actual === 'passed').length,
    binaryCoverage: ratio(tp + tn + fp + fn, rows.filter(r => r.expected !== 'needs_human_review').length),
    exactStatusAccuracy: ratio(rows.filter(r => r.actual === r.expected).length, rows.length),
    precision: ratio(tp, tp + fp), recall: ratio(tp, tp + fn),
    falsePositiveRate: ratio(fp, fp + tn), falseNegativeRate: ratio(fn, fn + tp),
  };
}
