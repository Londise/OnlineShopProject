import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateShipping } from '../src/services/shipping.service.js';
import { shippingCases } from '../../test/support/shipping-cases.js';

for (const { postalCode, grams, cents } of shippingCases) test(`O5: CEP ${postalCode}, ${grams} g costs ${cents} cents`, () => {
  assert.equal(calculateShipping({ method: 'CORREIOS', postalCode, totalWeightGrams: grams }).amountCents, cents);
});
test('O5: excursion has no agreed shipping amount and Correios rejects malformed CEP', () => {
  assert.equal(calculateShipping({ method: 'EXCURSAO', totalWeightGrams: 500 }).amountCents, null);
  for (const postalCode of [undefined, '', '123']) assert.throws(() => calculateShipping({ method: 'CORREIOS', postalCode, totalWeightGrams: 500 }), { code: 'INVALID_POSTAL_CODE' });
});
