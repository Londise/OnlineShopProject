import { useEffect, useMemo, useState } from 'react';
import { products as localProducts, categories as localCategories } from '../data/products';
import { api } from '../services/api';

const localBySlug = new Map(localProducts.map((product) => [product.id, product]));

function mapProduct(product) {
  const fallback = localBySlug.get(product.slug) ?? localProducts.find((candidate) => candidate.name === product.name);
  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    category: product.category.name,
    material: product.material,
    price: product.priceCents / 100,
    weight: product.weightGrams / 1000,
    image: product.images[0]?.url ?? fallback?.image,
    images: product.images.length ? product.images.map((image) => image.url) : fallback?.images ?? [],
    variants: product.options.map((option) => ({ name: option.name, image: product.images.find((image) => image.productOptionId === option.id)?.url ?? null, stockVariants: option.variants })),
  };
}

export default function useCatalog() {
  const [products, setProducts] = useState(localProducts);
  const [usingApi, setUsingApi] = useState(false);
  useEffect(() => {
    api.catalog.products().then(({ products: serverProducts }) => {
      if (serverProducts.length) { setProducts(serverProducts.map(mapProduct)); setUsingApi(true); }
    }).catch(() => setUsingApi(false));
  }, []);
  const categories = useMemo(() => usingApi ? [...new Map(products.map((product) => [product.category, { name: product.category, image: product.image }])).values()] : localCategories, [products, usingApi]);
  return { products, categories, usingApi };
}
