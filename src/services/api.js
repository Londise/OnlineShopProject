import { createRequestClient, resolveApiUrl } from './http.js';
export { ApiError } from './http.js';

const request = createRequestClient({
  baseUrl: resolveApiUrl(import.meta.env.VITE_API_URL, { production: import.meta.env.PROD }),
});

export const api = {

  auth: {
    me: (options) => request("/auth/me", options),
    login: (body) =>
      request("/auth/login", { method: "POST", body: JSON.stringify(body) }),
    register: (body) =>
      request("/auth/register", { method: "POST", body: JSON.stringify(body) }),
    logout: () => request("/auth/logout", { method: "POST" }),
  },

  catalog: {
    products: (options) => request("/products", options),
    banners: () => request("/banners"),
    siteMedia: () => request("/site-media"),
  },

  orders: {
    create: (body) =>
      request("/orders", { method: "POST", body: JSON.stringify(body) }),
    mine: () => request("/orders/me"),
  },
  
  admin: {
    media: () => request("/admin/media-assets"),
    metadata: () => request("/admin/catalog-metadata"),
    uploadImage: (body) => request("/admin/uploads", { method: "POST", body }),
    updateImage: (id, body) => request(`/admin/product-images/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    orders: () => request("/admin/orders"),
    updateOrder: (id, body) =>
      request(`/admin/orders/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    archiveOrder: (id) => request(`/admin/orders/${id}`, { method: "DELETE" }),
    inventory: () => request("/admin/inventory"),
    adjustInventory: (variantId, body) =>
      request(`/admin/inventory/${variantId}/adjust`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    products: () => request("/admin/products"),
    updateProduct: (id, body) =>
      request(`/admin/products/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    banners: () => request("/admin/banners"),
    updateBanner: (id, body) =>
      request(`/admin/banners/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    logs: (params = {}) => {
      const search = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== "")
          search.set(key, String(value));
      }
      const suffix = search.toString();
      return request(`/admin/logs${suffix ? `?${suffix}` : ""}`);
    },
    logsByTrace: (traceId) => request(`/admin/logs/trace/${traceId}`),
    logsDead: () => request("/admin/logs/dead"),
  },
};
