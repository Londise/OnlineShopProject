import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../services/api";
import { IMAGE_PLACEHOLDER } from "../config/media";

function mapProduct(product) {
  const image = product.images.find(item => item.type === "PRIMARY")?.url ?? product.images[0]?.url ?? IMAGE_PLACEHOLDER;
  return {
    id: product.id, slug: product.slug, name: product.name, category: product.category.name,
    categoryImage: product.category.imageUrl, material: product.material,
    price: product.priceCents / 100, weight: product.weightGrams / 1000,
    image, images: product.images.length ? product.images.map(item => item.url) : [IMAGE_PLACEHOLDER],
    options: product.options.map(option => ({
      name: option.name, image: option.imageUrl ?? product.images.find(item => item.productOptionId === option.id)?.url ?? null,
      variants: option.variants.map(variant => ({ id: variant.id, sku: variant.sku, size: variant.size,
        price: variant.priceCents / 100, available: Math.max(0, variant.available) })),
    })),
  };
}

export default function useCatalog() {
  const [products, setProducts] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const reload = useCallback(() => setAttempt(value => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    api.catalog.products({ signal: controller.signal }).then(({ products }) => {
      if (!Array.isArray(products)) throw new Error('Resposta do catálogo inválida.');
      if (!controller.signal.aborted) setProducts(products.map(mapProduct));
    }).catch(error => {
      if (!controller.signal.aborted) setError(error.message || "Não foi possível carregar o catálogo. Tente novamente.");
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [attempt]);
  const categories = useMemo(() => [...new Map(products.map(product => [product.category,
    { name: product.category, image: product.categoryImage ?? product.image }])).values()], [products]);
  return { products, categories, error, loading, reload, usingApi: true };
}
