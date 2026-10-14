const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001/api/v1";

// Cada chamada carrega um trace-id próprio; a API devolve o mesmo no header
// x-trace-id, permitindo seguir a request inteira no painel de logs.
const newTraceId = () =>
  globalThis.crypto?.randomUUID?.() ??
  "xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx".replace(/x/g, () =>
    Math.floor(Math.random() * 16).toString(16),
  );

export class ApiError extends Error {
  constructor(message, code, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function request(path, options = {}) {
  const { headers, ...rest } = options;
  const response = await fetch(`${API_URL}${path}`, {
    credentials: "include",
    headers: {
      "x-trace-id": newTraceId(),
      ...(options.body && !(options.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    ...rest,
  });
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new ApiError(
      data.error?.message ?? "Não foi possível concluir a operação.",
      data.error?.code,
      response.status,
    );
  return data;
}

export const api = {

  auth: {
    me: () => request("/auth/me"),
    login: (body) =>
      request("/auth/login", { method: "POST", body: JSON.stringify(body) }),
    register: (body) =>
      request("/auth/register", { method: "POST", body: JSON.stringify(body) }),
    logout: () => request("/auth/logout", { method: "POST" }),
  },

  catalog: {
    products: () => request("/products"),
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
