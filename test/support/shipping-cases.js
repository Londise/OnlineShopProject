// Hand-calculated cents, shared data only: neither side calls the other's
// calculator to derive an expectation.
export const shippingCases = [
  { postalCode: '00000000', grams: 15, cents: 2190 },
  { postalCode: '39999999', grams: 500, cents: 2190 },
  { postalCode: '40000000', grams: 500, cents: 2672 },
  { postalCode: '69999999', grams: 501, cents: 3209 },
  { postalCode: '70000000', grams: 501, cents: 3945 },
  { postalCode: '99999999', grams: 500, cents: 3285 },
];
