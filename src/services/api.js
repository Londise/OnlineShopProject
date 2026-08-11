const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001/api/v1';

export class ApiError extends Error {
  constructor(message, code, status) { super(message); this.code = code; this.status = status; }
}

async function request(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    credentials: 'include',
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
    ...options,
  });
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(data.error?.message ?? 'Não foi possível concluir a operação.', data.error?.code, response.status);
  return data;
}

export const api = {
  auth: {
    me: () => request('/auth/me'),
    login: (body) => request('/auth/login', { method: 'POST', body: JSON.stringify(body) }),
    register: (body) => request('/auth/register', { method: 'POST', body: JSON.stringify(body) }),
    logout: () => request('/auth/logout', { method: 'POST' }),
  },
  catalog: { products: () => request('/products'), banners: () => request('/banners') },
  orders: { create: (body) => request('/orders', { method: 'POST', body: JSON.stringify(body) }), mine: () => request('/orders/me') },
  admin: {
    orders: () => request('/admin/orders'),
    updateOrder: (id, body) => request(`/admin/orders/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    archiveOrder: (id) => request(`/admin/orders/${id}`, { method: 'DELETE' }),
    inventory: () => request('/admin/inventory'),
    adjustInventory: (variantId, body) => request(`/admin/inventory/${variantId}/adjust`, { method: 'POST', body: JSON.stringify(body) }),
    products: () => request('/admin/products'),
    updateProduct: (id, body) => request(`/admin/products/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    banners: () => request('/admin/banners'),
    updateBanner: (id, body) => request(`/admin/banners/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  },
};
