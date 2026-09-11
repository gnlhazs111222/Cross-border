import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dimensionsFromText, formatCapacity, formatDimensions, formatLength, formatWeight, systemForMarket } from '../../shared/units';

test('the market decides the default unit system', () => {
  assert.equal(systemForMarket('United States'), 'us');
  assert.equal(systemForMarket('Amazon US'), 'us');
  assert.equal(systemForMarket('United Kingdom'), 'uk');
  assert.equal(systemForMarket('European Union'), 'metric');
  assert.equal(systemForMarket(undefined), 'metric');
});

test('capacity renders in US fluid ounces, imperial fluid ounces or millilitres', () => {
  assert.equal(formatCapacity(500, 'us'), '16.9 fl oz');
  assert.equal(formatCapacity(500, 'uk'), '17.6 fl oz');
  assert.equal(formatCapacity(500, 'metric'), '500 ml');
});

test('weight and length render in pounds and inches for US and UK, metric otherwise', () => {
  assert.equal(formatWeight(0.38, 'us'), '0.84 lb');
  assert.equal(formatWeight(0.38, 'metric'), '0.38 kg');
  assert.equal(formatLength(8, 'us'), '3.15 in');
  assert.equal(formatLength(26.4, 'us'), '10.39 in');
  assert.equal(formatLength(8, 'metric'), '8 cm');
});

test('a dimension triple keeps its shape in either system', () => {
  assert.equal(formatDimensions([8, 8, 26.4], 'us'), '3.15 × 3.15 × 10.39 in');
  assert.equal(formatDimensions([8, 8, 26.4], 'metric'), '8 × 8 × 26.4 cm');
  assert.equal(formatDimensions(undefined, 'us'), undefined);
});

test('stored dimension text parses back into numbers so both forms share one projector', () => {
  assert.deepEqual(dimensionsFromText('8 × 8 × 25 cm'), [8, 8, 25]);
  assert.deepEqual(dimensionsFromText('3.15 × 3.15 × 10.39 in'), [3.15, 3.15, 10.39]);
  assert.equal(dimensionsFromText('8 × 8'), undefined);
  assert.equal(dimensionsFromText(undefined), undefined);
});
