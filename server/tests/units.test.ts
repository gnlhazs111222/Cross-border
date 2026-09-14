import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalFigure, dimensionsFromText, formatCapacity, formatDimensions, formatLength, formatWeight, printedFigure, systemForMarket } from '../../shared/units';

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

test('a figure printed in a picture is shown in the screen unit, with the unit it was written in respected', () => {
  // The comparison is read at a glance because both sides land in one system.
  assert.equal(printedFigure('capacity', '260ml', 'us'), '8.8 fl oz');
  assert.equal(printedFigure('capacity', '800 ML', 'metric'), '800 ml');
  assert.equal(printedFigure('capacity', '25.4 fl oz', 'us'), '25.4 fl oz', 'a label already in ounces is not read as millilitres');
  assert.equal(printedFigure('capacity', '1.2L', 'metric'), '1200 ml', 'litres are read as litres');
  // Weight and length carry their own units on the label.
  assert.equal(printedFigure('packagingWeight', '420 g', 'us'), '0.93 lb');
  assert.equal(printedFigure('packagingWeight', '14.8 oz', 'metric'), '0.42 kg');
  assert.equal(printedFigure('packageHeight', '80 mm', 'us'), '3.15 in');
  assert.equal(printedFigure('packageHeight', '3.15 in', 'metric'), '8 cm');
  // A quote that lists several figures is not one value, and a field without units is left alone.
  assert.equal(printedFigure('capacity', '400ML/600ML/1000ML/1500ML/2000ML', 'us'), undefined);
  assert.equal(printedFigure('material', '钛含量 >99.8%', 'us'), undefined);
  assert.equal(printedFigure('capacity', '750', 'metric'), '750 ml', 'a bare number is read in the field canonical unit');
  // What the same readings mean in the units the database stores, which is what an adoption writes down.
  assert.equal(Math.round(canonicalFigure('capacity', '25.4 fl oz')!), 751, '25.4 fl oz is 751 ml');
  assert.equal(canonicalFigure('capacity', '1.2L'), 1200);
  assert.equal(canonicalFigure('packagingWeight', '420 g'), 0.42);
  assert.equal(canonicalFigure('packageHeight', '3.15 in'), 8.001);
  assert.equal(canonicalFigure('packagingWeight', '0.42 kg'), 0.42);
  assert.equal(canonicalFigure('supplierCost', 'USD 6.30'), undefined, 'a price is not a unit-bearing measure');
  assert.equal(canonicalFigure('packagingWeight', '-1'), undefined, 'the sign is not lost when a figure is read');
});
