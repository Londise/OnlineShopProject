import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../services/api";
import { IMAGE_PLACEHOLDER } from "../config/media";

function mapProduct(product) {
  const primaryImage = product.images.find(item => item.type === "PRIMARY") ?? product.images[0];
  const image = primaryImage?.url ?? IMAGE_PLACEHOLDER;
  const hasCategoryImage = Boolean(product.category.imageUrl);
  return {
    id: product.id, slug: product.slug, name: product.name, category: product.category.name,
    categoryImage: product.category.imageUrl ?? image,
    categoryImageWidth: hasCategoryImage ? product.category.imageWidth : primaryImage?.width,
    categoryImageHeight: hasCategoryImage ? product.category.imageHeight : primaryImage?.height,
    material: product.material,
    price: product.priceCents / 100, weight: product.weightGrams / 1000,
    image, imageWidth: primaryImage?.width ?? null, imageHeight: primaryImage?.height ?? null,
    images: product.images.length ? product.images.map(item => item.url) : [IMAGE_PLACEHOLDER],
    options: product.options.map(option => ({
      name: option.name, image: option.imageUrl ?? product.images.find(item => item.productOptionId === option.id)?.url ?? null,
      swatchHex: option.swatchHex,
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
    let active = true;
    setLoading(true);
    setError("");
    api.catalog.sharedProducts().then(({ products }) => {
      if (!Array.isArray(products)) throw new Error('Resposta do catálogo inválida.');
      if (active) setProducts(products.map(mapProduct));
    }).catch(error => {
      if (active) setError(error.message || "Não foi possível carregar o catálogo. Tente novamente.");
    }).finally(() => { if (active) setLoading(false); });
    // Each consumer owns its lifecycle; unmounting one must not abort the
    // request shared with the cart or another screen.
    return () => { active = false; };
  }, [attempt]);
  const categories = useMemo(() => [...new Map(products.map(product => [product.category,
    {
      name: product.category,
      image: product.categoryImage ?? product.image,
      imageWidth: product.categoryImageWidth,
      imageHeight: product.categoryImageHeight,
    }])).values()], [products]);
  return { products, categories, error, loading, reload };
}
