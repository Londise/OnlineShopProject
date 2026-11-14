export const customer = { id: 'customer-1', name: 'Ana Silva', email: 'ana@example.test', role: 'CUSTOMER' };
export const admin = { id: 'admin-1', name: 'Gestora', email: 'admin@example.test', role: 'ADMIN' };
export const cartLine = (overrides = {}) => ({
  key: 'variant-1', variantId: 'variant-1', productId: 'product-1',
  name: 'Calça Linho', color: 'Preto', size: 'M', quantity: 15,
  price: 25, weight: 0.4, image: '/pants.jpg', available: 30, ...overrides,
});
export const order = (overrides = {}) => ({
  id: 'order-internal-1', publicNumber: 'FM-20261111-ABC12345', status: 'NOVO',
  totalCents: 40050, subtotalCents: 37500, shippingAmountCents: 2550,
  totalWeightGrams: 6000, paidAmountCents: 0, deliveryMethod: 'CORREIOS',
  createdAt: '2026-11-11T12:00:00.000Z', items: [], ...overrides,
});
export const inventory = (overrides = {}) => ({
  id: 'variant-1', sku: 'LINHO-PRETO-M', product: 'Calça Linho', category: 'Calças',
  option: 'Preto', size: 'M', active: true, onHand: 30, reserved: 5, available: 25, ...overrides,
});
export const logEntry = (id, message, overrides = {}) => ({
  id, ts: '2026-11-11T12:00:00.000Z', level: 30, service: 'api', event: 'order.created',
  message, traceId: null, requestId: null, actorId: null, route: '/api/v1/orders',
  status: 201, durationMs: 10, data: {}, stack: null, ...overrides,
});
export const catalogProduct = (overrides = {}) => ({
  id: 'product-1', slug: 'calca-linho', name: 'Calça Linho', active: true, description: null,
  material: 'Linho', priceCents: 2500, weightGrams: 400,
  category: { id: 'category-1', name: 'Calças', slug: 'calcas', imageUrl: null, imageWidth: null, imageHeight: null },
  images: [{ id: 'image-1', type: 'PRIMARY', url: '/pants.jpg', altText: 'Calça', width: 600, height: 900, sortOrder: 0, productOptionId: null }],
  options: [{ id: 'option-1', name: 'Preto', type: 'COLOR', swatchHex: '#000000', imageUrl: null, imageWidth: null, imageHeight: null, active: true, sortOrder: 0,
    variants: [{ id: 'variant-1', sku: 'LINHO-PRETO-M', size: 'M', priceCents: 2500, active: true, available: 30 }] }],
  ...overrides,
});
