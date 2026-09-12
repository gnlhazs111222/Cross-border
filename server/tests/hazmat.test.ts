import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessHazmat, type TransportAttributes } from '../../shared/hazmat';

const attributes = (overrides: Partial<TransportAttributes> = {}): TransportAttributes => ({
  liquid: false, battery: false, magnetic: false, aerosol: false, flammable: false, fragile: false, ...overrides,
});

test('ordinary goods are clear and never blocked', () => {
  const result = assessHazmat(attributes());
  assert.equal(result.verdict, 'clear');
  assert.equal(result.publishBlocked, false);
  assert.deepEqual(result.triggers, []);
});

test('a fragile item stays clear: breakage is an operational note, not a transport restriction', () => {
  const result = assessHazmat(attributes({ fragile: true }));
  assert.equal(result.verdict, 'clear');
  assert.equal(result.fragile, true);
  assert.equal(result.publishBlocked, false);
});

test('a battery product needs documents and can be released manually', () => {
  const result = assessHazmat(attributes({ battery: true }));
  assert.equal(result.verdict, 'needs_documents');
  assert.equal(result.publishBlocked, true);
  assert.equal(result.manualReleaseAllowed, true);
  assert.ok(result.requirements.includes('UN38.3 test report'));
});

test('magnetic cargo and aerosols each bring their own requirement list', () => {
  assert.deepEqual(assessHazmat(attributes({ magnetic: true })).requirements, ['Magnetic field test report']);
  const aerosol = assessHazmat(attributes({ aerosol: true, liquid: true }));
  assert.ok(aerosol.requirements.includes('MSDS'));
  assert.ok(aerosol.requirements.includes('Pressure vessel declaration'));
});

test('a flammable liquid is forbidden and offers no manual release', () => {
  const result = assessHazmat(attributes({ flammable: true, liquid: true }));
  assert.equal(result.verdict, 'forbidden');
  assert.equal(result.publishBlocked, true);
  assert.equal(result.manualReleaseAllowed, false, 'a factual shipping ban must not be overridable');
});

test('flammable dominates other declarations', () => {
  const result = assessHazmat(attributes({ flammable: true, battery: true, aerosol: true }));
  assert.equal(result.verdict, 'forbidden');
  assert.equal(result.manualReleaseAllowed, false);
  assert.deepEqual(result.triggers, ['flammable', 'aerosol', 'battery']);
});

test('undeclared attributes are reported as undeclared instead of assumed safe', () => {
  const result = assessHazmat(undefined);
  assert.equal(result.declared, false);
  assert.equal(result.verdict, 'clear');
  assert.equal(result.publishBlocked, false);
});
