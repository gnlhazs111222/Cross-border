import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeReviewMetrics } from '../../evaluation/review/metrics';
import { reviewCases } from '../../evaluation/review/cases';

test('review confusion counts exclude failures and abstentions from binary denominators', () => {
  const actual = summarizeReviewMetrics([
    { expected: 'blocked', actual: 'blocked' }, { expected: 'blocked', actual: 'passed' },
    { expected: 'passed', actual: 'blocked' }, { expected: 'passed', actual: 'passed' },
    { expected: 'blocked', actual: 'failed' }, { expected: 'passed', actual: 'needs_human_review' },
    { expected: 'needs_human_review', actual: 'passed' },
  ]);
  assert.deepEqual(actual.confusion, { tp: 1, tn: 1, fp: 1, fn: 1 });
  assert.equal(actual.falsePositiveRate, 0.5);
  assert.equal(actual.falseNegativeRate, 0.5);
  assert.equal(actual.failed, 1);
  assert.equal(actual.abstained, 1);
  assert.equal(actual.binaryCoverage, 4 / 6);
  assert.equal(actual.exactStatusAccuracy, 2 / 7);
  assert.equal(actual.ambiguousPassed, 1);
});

test('undefined denominator yields null, never perfect accuracy', () => {
  const actual = summarizeReviewMetrics([{ expected: 'blocked', actual: 'failed' }]);
  assert.equal(actual.precision, null);
  assert.equal(actual.recall, null);
  assert.equal(actual.falseNegativeRate, null);
  assert.equal(actual.binaryCoverage, 0);
});

test('fixed evaluation fixtures stay disjoint, frozen, and keep labels outside model input', () => {
  assert.equal(reviewCases.length, 48);
  assert.equal(new Set(reviewCases.map(c => c.id)).size, 48);
  assert.equal(reviewCases.filter(c => c.split === 'dev').length, 24);
  assert.equal(reviewCases.filter(c => c.split === 'holdout').length, 24);
  for (const c of reviewCases) {
    assert.equal(Object.isFrozen(c), true);
    assert.equal(Object.isFrozen(c.input.facts), true);
    assert.equal('expected' in c.input, false);
    assert.equal('rationale' in c.input, false);
  }
  assert.ok(reviewCases.some(c => c.input.listing.bullets.length));
  assert.ok(reviewCases.some(c => c.input.listing.description));
  assert.ok(reviewCases.some(c => Object.keys(c.input.listing.attributes).length));
});
