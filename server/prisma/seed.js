import "dotenv/config";
import argon2 from "argon2";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const catalog = [
  {
    slug: "calca-malha-viscolycra",
    name: "Calça de Malha Viscolycra",
    category: "Calças",
    material: "Viscolycra",
    priceCents: 2500,
    weightGrams: 400,
    options: [
      "Preto",
      "Grafite",
      "Cinza claro",
      "Verde militar",
      "Azul marinho",
      "Vinho",
      "Marrom",
      "Marrom claro",
    ],
  },
  {
    slug: "calca-viscolycra-estampada",
    name: "Calça Viscolycra Estampada",
    category: "Calças",
    material: "Viscolycra",
    priceCents: 2700,
    weightGrams: 400,
    options: ["Estampado"],
  },
  {
    slug: "calca-linho",
    name: "Calça Linho",
    category: "Calças",
    material: "Linho",
    priceCents: 3600,
    weightGrams: 500,
    options: [
      "Preto",
      "Creme",
      "Verde escuro",
      "Verde claro",
      "Vinho",
      "Azul escuro",
      "Azul claro",
      "Rose",
    ],
  },
  {
    slug: "pantacourt-linho",
    name: "Pantacourt Linho",
    category: "Pantacourts",
    material: "Linho",
    priceCents: 3500,
    weightGrams: 400,
    options: [
      "Preto",
      "Creme",
      "Verde escuro",
      "Verde claro",
      "Vinho",
      "Azul escuro",
      "Azul claro",
      "Rose",
    ],
  },
  {
    slug: "bermuda-linho",
    name: "Bermuda Linho",
    category: "Bermudas",
    material: "Linho",
    priceCents: 2500,
    weightGrams: 320,
    options: [
      "Preto",
      "Creme",
      "Verde escuro",
      "Verde claro",
      "Vinho",
      "Azul escuro",
      "Azul claro",
      "Rose",
    ],
  },
  {
    slug: "capri-viscolycra-estampada",
    name: "Capri Viscolycra Estampada",
    category: "Capris",
    material: "Viscolycra",
    priceCents: 2000,
    weightGrams: 300,
    options: ["Estampado"],
  },
  {
    slug: "short-viscolycra",
    name: "Short Viscolycra",
    category: "Shorts",
    material: "Viscolycra",
    priceCents: 1500,
    weightGrams: 100,
    options: [
      "Preto",
      "Grafite",
      "Cinza claro",
      "Verde militar",
      "Azul marinho",
      "Vinho",
      "Marrom",
      "Marrom claro",
    ],
  },
  {
    slug: "bermuda-viscolycra-lisa",
    name: "Bermuda Viscolycra Lisa",
    category: "Bermudas",
    material: "Viscolycra",
    priceCents: 1800,
    weightGrams: 100,
    options: [
      "Preto",
      "Grafite",
      "Cinza claro",
      "Verde militar",
      "Azul marinho",
      "Vinho",
      "Marrom",
      "Marrom claro",
    ],
  },
];

const colorHex = {
  Preto: "#171419",
  Grafite: "#4A4A4A",
  "Cinza claro": "#D9D9D9",
  "Verde militar": "#21482C",
  "Azul marinho": "#1D3152",
  Vinho: "#9C1A39",
  Marrom: "#4B3332",
  "Marrom claro": "#BD6D5A",
  Creme: "#EAD7C5",
  "Verde escuro": "#58593A",
  "Verde claro": "#98D3B3",
  "Azul escuro": "#252949",
  "Azul claro": "#538DE4",
  Rose: "#D97E7B",
};
const slugify = (value) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

async function main() {
  const adminEmail = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD || "";
  if (!adminEmail || adminPassword.length < 10)
    throw new Error(
      "Defina ADMIN_EMAIL e ADMIN_PASSWORD (mínimo de 10 caracteres) antes de executar o seed.",
    );
  const passwordHash = await argon2.hash(adminPassword, {
    type: argon2.argon2id,
  });
  await prisma.user.upsert({
    where: { email: adminEmail },
    update: {
      name: process.env.ADMIN_NAME || "Administrador Ferchu",
      role: "ADMIN",
      active: true,
    },
    create: {
      name: process.env.ADMIN_NAME || "Administrador Ferchu",
      email: adminEmail,
      passwordHash,
      role: "ADMIN",
    },
  });

  const categoryNames = [
    "Calças",
    "Pantacourts",
    "Bermudas",
    "Shorts",
    "Capris",
  ];
  const categories = new Map();
  for (const [index, name] of categoryNames.entries()) {
    const category = await prisma.category.upsert({
      where: { slug: slugify(name) },
      update: { name, sortOrder: index },
      create: { name, slug: slugify(name), sortOrder: index },
    });
    categories.set(name, category);
  }
  const sizes = new Map();
  for (const [index, code] of ["P", "M", "G", "GG"].entries())
    sizes.set(
      code,
      await prisma.size.upsert({
        where: { code },
        update: { sortOrder: index, active: true },
        create: { code, sortOrder: index },
      }),
    );
  const optionCache = new Map();
  async function optionByName(name) {
    if (optionCache.has(name)) return optionCache.get(name);
    const type = name === "Estampado" ? "PRINT" : "COLOR";
    const option = await prisma.variantOption.upsert({
      where: { slug: `${type.toLowerCase()}-${slugify(name)}` },
      update: { name, type, swatchHex: colorHex[name] ?? null, active: true },
      create: {
        name,
        type,
        slug: `${type.toLowerCase()}-${slugify(name)}`,
        swatchHex: colorHex[name] ?? null,
      },
    });
    optionCache.set(name, option);
    return option;
  }
  for (const item of catalog) {
    const product = await prisma.product.upsert({
      where: { slug: item.slug },
      update: {
        name: item.name,
        material: item.material,
        priceCents: item.priceCents,
        weightGrams: item.weightGrams,
        categoryId: categories.get(item.category).id,
        active: true,
      },
      create: {
        slug: item.slug,
        name: item.name,
        material: item.material,
        priceCents: item.priceCents,
        weightGrams: item.weightGrams,
        categoryId: categories.get(item.category).id,
      },
    });
    for (const [index, name] of item.options.entries()) {
      const option = await optionByName(name);
      const productOption = await prisma.productOption.upsert({
        where: {
          productId_variantOptionId: {
            productId: product.id,
            variantOptionId: option.id,
          },
        },
        update: { sortOrder: index, active: true },
        create: {
          productId: product.id,
          variantOptionId: option.id,
          sortOrder: index,
        },
      });
      for (const [sizeCode, size] of sizes.entries()) {
        const sku = `${item.slug}-${option.slug}-${sizeCode}`.toUpperCase();
        await prisma.productVariant.upsert({
          where: {
            productOptionId_sizeId: {
              productOptionId: productOption.id,
              sizeId: size.id,
            },
          },
          update: { sku, active: true },
          create: {
            productOptionId: productOption.id,
            sizeId: size.id,
            sku,
            inventory: { create: { onHand: 0, reserved: 0 } },
          },
        });
      }
    }
  }
  console.log(
    "Seed concluído: administrador, categorias, tamanhos e catálogo foram preparados.",
  );
}

main().finally(() => prisma.$disconnect());
