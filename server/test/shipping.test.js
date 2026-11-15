import test from 'node:test';
import assert from 'node:assert/strict';
import {
  estimateVolume,
  splitVolumes,
  planVolumes,
  combineVolumeQuotes,
  normalizeQuote,
  selectShippingOptions,
  volumeLabel,
} from '../src/services/shipping.service.js';

test('E1: the three store references are reproduced exactly', () => {
  assert.deepEqual(estimateVolume(10), { width: 30, height: 30, length: 30, weightKg: 2 });
  assert.deepEqual(estimateVolume(20), { width: 35, height: 35, length: 35, weightKg: 3 });
  assert.deepEqual(estimateVolume(120), { width: 50, height: 45, length: 45, weightKg: 35 });
});

test('E1: counts between references interpolate each dimension and round up', () => {
  assert.deepEqual(estimateVolume(15), { width: 33, height: 33, length: 33, weightKg: 2.5 });
  assert.deepEqual(estimateVolume(60), { width: 41, height: 39, length: 39, weightKg: 15.8 });
});

test('E1: counts above the last reference extend the 20→120 trend', () => {
  assert.deepEqual(estimateVolume(200), { width: 62, height: 53, length: 53, weightKg: 60.6 });
});

test('E1: counts below the first reference scale down proportionally with floors', () => {
  assert.deepEqual(estimateVolume(5), { width: 15, height: 15, length: 15, weightKg: 1 });
  assert.deepEqual(estimateVolume(1), { width: 3, height: 3, length: 3, weightKg: 0.2 });
});

test('E1: invalid counts are rejected', () => {
  for (const pieces of [0, -1, 1.5, '10']) {
    assert.throws(() => estimateVolume(pieces), { code: 'INVALID_QUANTITY' });
  }
});

test('E2: splitting restarts the estimate per package instead of dividing one big box', () => {
  const volumes = splitVolumes(120, 30); // 35 kg em um volume exige divisão
  assert.equal(volumes.length, 2);
  // Cada embalagem de 60 peças é reestimada a partir das referências.
  assert.deepEqual(volumes, [estimateVolume(60), estimateVolume(60)]);
  assert.deepEqual(estimateVolume(60), { width: 41, height: 39, length: 39, weightKg: 15.8 });
});

test('E2: a single package inside the weight cap is returned unchanged', () => {
  assert.deepEqual(splitVolumes(15, 30), [estimateVolume(15)]);
  assert.deepEqual(splitVolumes(120, 50), [estimateVolume(120)]); // 35 kg cabe no teto de 50
});

test('E2: heavy orders split into the fewest evenly distributed packages below each cap', () => {
  const jadlog = splitVolumes(400, 50);
  assert.deepEqual(jadlog, [estimateVolume(134), estimateVolume(133), estimateVolume(133)]);
  assert.ok(jadlog.every((volume) => volume.weightKg <= 50));
  const others = splitVolumes(400, 30);
  assert.deepEqual(others, [estimateVolume(100), estimateVolume(100), estimateVolume(100), estimateVolume(100)]);
  assert.ok(others.every((volume) => volume.weightKg <= 30));
});

test('E3: plans use one volume up to 30 kg', () => {
  assert.deepEqual(planVolumes(15), [{ kind: 'SINGLE', volumes: [estimateVolume(15)] }]);
  assert.deepEqual(planVolumes(60)[0], { kind: 'SINGLE', volumes: [estimateVolume(60)] });
});

test('E3: above 30 kg plans quote Jadlog in one volume and others separately', () => {
  const plans = planVolumes(60 + 60); // 120 peças → 35 kg
  assert.deepEqual(plans.map((plan) => plan.kind), ['JADLOG', 'OTHER']);
  assert.deepEqual(plans[0].volumes, [estimateVolume(120)]); // 35 kg ≤ 50 kg: 1 volume
  assert.equal(plans[1].volumes.length, 2);
  assert.ok(plans[1].volumes.every((volume) => volume.weightKg <= 30));
});

test('E3: above 50 kg even Jadlog is split into multiple packages', () => {
  const plans = planVolumes(200); // ≈ 60,6 kg
  assert.deepEqual(plans.map((plan) => plan.kind), ['JADLOG', 'OTHER']);
  assert.equal(plans[0].volumes.length, 2);
  assert.ok(plans[0].volumes.every((volume) => volume.weightKg <= 50));
  assert.ok(plans[1].volumes.every((volume) => volume.weightKg <= 30));
});

const raw = (company, name, price, days = 4) => ({ company: { name: company }, name, price: String(price), custom_price: String(price), delivery_time: days, custom_delivery_time: days });

test('E4: combining volume quotes sums shared services and drops ones missing from any volume', () => {
  const combined = combineVolumeQuotes([
    [raw('Correios', 'PAC', 20), raw('Correios', 'SEDEX', 30), raw('Jadlog', '.Package', 18)],
    [raw('Correios', 'PAC', 21), raw('Jadlog', '.Package', 18)],
  ].map((quotes) => quotes.map(normalizeQuote)));
  assert.deepEqual(combined.map((option) => [option.company, option.service, option.price, option.volumes]), [
    ['Correios', 'PAC', 41, 2],
    ['Jadlog', '.Package', 36, 2],
  ]);
});

test('E4: LATAM Cargo is always discarded and kind filters restrict carriers', () => {
  const quotes = [
    { company: 'Correios', service: 'PAC', price: 20, days: 5 },
    { company: 'Jadlog', service: '.Package', price: 18, days: 3 },
    { company: 'LATAM Cargo', service: 'X', price: 1, days: 2 },
  ];
  assert.deepEqual(combineVolumeQuotes([quotes]).map((option) => option.company), ['Correios', 'Jadlog']);
  assert.deepEqual(combineVolumeQuotes([quotes], { jadlogOnly: true }).map((option) => option.company), ['Jadlog']);
  assert.deepEqual(combineVolumeQuotes([quotes], { otherCarriersOnly: true }).map((option) => option.company), ['Correios']);
});

test('E4: carrier error entries without a price never become options', () => {
  const quotes = [
    { company: 'Correios', service: 'PAC', price: NaN, days: NaN }, // erro da transportadora, sem preço
    { company: 'Jadlog', service: '.Package', price: 18, days: 3 },
  ];
  const combined = combineVolumeQuotes([quotes]);
  assert.deepEqual(combined.map((option) => [option.company, option.price]), [['Jadlog', 18]]);
  assert.deepEqual(selectShippingOptions([quotes[0], quotes[1]]).map((option) => option.company), ['Jadlog']);
});

test('E4: summed package prices outside the order amount range are discarded', () => {
  const expensive = { company: 'Correios', service: 'PAC', price: 15_000_000, days: 5 };
  const combined = combineVolumeQuotes([[expensive], [expensive]]);
  assert.deepEqual(selectShippingOptions(combined), []);
});

test('E5: selection dedupes identical services keeping the cheapest and sorts ascending', () => {
  const selected = selectShippingOptions([
    { company: 'Jadlog', service: '.Package', price: 18, days: 3, volumes: 1, key: 'Jadlog|.Package|1' },
    { company: 'Correios', service: 'PAC', price: 21.9, days: 5, volumes: 1, key: 'Correios|PAC|1' },
    { company: 'Jadlog', service: '.Package', price: 17.5, days: 3, volumes: 1, key: 'Jadlog|.Package|1' },
    { company: 'Correios', service: 'SEDEX', price: 30.1, days: 2, volumes: 1, key: 'Correios|SEDEX|1' },
  ]);
  assert.deepEqual(selected.map((option) => option.price), [17.5, 21.9, 30.1]);
  assert.equal(selected.filter((option) => option.company === 'Jadlog').length, 1);
});

test('E5: volume labels describe single and split shipments', () => {
  assert.equal(volumeLabel(1), '1 volume');
  assert.equal(volumeLabel(2), '2 volumes (envios separados)');
});
