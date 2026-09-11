import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchAssetFiles } from '../../shared/asset-match';

const rows = [
  { sku: 'SAMPLE-BTL-001', assetReferences: ['SAMPLE-BTL-001-front.png', 'missing-photo.png'] },
  { sku: 'SAMPLE-BTL-002' },
];
const files = [
  'sample btl 001-front.PNG',   // the same reference, written differently
  'SAMPLE-BTL-002-front.png',   // no reference column, the SKU is in the name
  'SAMPLE-BTL-002-package.png', // same SKU, second image
  'UNREFERENCED-photo.png',     // nobody claims it
];

test('a reference matches its file even when case and separators differ', () => {
  const match = matchAssetFiles(rows, files);
  assert.equal(match.assignments.find(assignment => assignment.sku === 'SAMPLE-BTL-001')?.fileName, 'sample btl 001-front.PNG');
});

test('a file whose name carries the SKU is claimed even without a reference column', () => {
  const match = matchAssetFiles(rows, files);
  const second = match.assignments.filter(assignment => assignment.sku === 'SAMPLE-BTL-002').map(assignment => assignment.fileName).sort();
  assert.deepEqual(second, ['SAMPLE-BTL-002-front.png', 'SAMPLE-BTL-002-package.png']);
});

test('references without a file and files without an owner are both reported', () => {
  const match = matchAssetFiles(rows, files);
  assert.deepEqual(match.missing, ['missing-photo.png']);
  assert.deepEqual(match.unreferenced, ['UNREFERENCED-photo.png']);
  assert.equal(match.assignments.length, 3, 'one reference match plus two SKU matches');
});

test('a SKU too short to be trusted never claims a file by substring', () => {
  const match = matchAssetFiles([{ sku: 'AB-1' }], ['AB-1-photo.png', 'other.png']);
  assert.deepEqual(match.assignments, []);
  assert.deepEqual(match.unreferenced, ['AB-1-photo.png', 'other.png']);
});

test('several files for one SKU are all attached and flagged as a group for confirmation', () => {
  const match = matchAssetFiles([{ sku: 'SAMPLE-BTL-003' }], ['SAMPLE-BTL-003-a.png', 'SAMPLE-BTL-003-b.png', 'SAMPLE-BTL-003-c.png']);
  assert.equal(match.assignments.length, 3);
  assert.equal(match.grouped.length, 1);
});
