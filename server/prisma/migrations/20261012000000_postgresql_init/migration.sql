-- PostgreSQL baseline generated from schema.prisma with Prisma 6.19.3.
-- This creates structure only. It does not import data from the previous database.
BEGIN;
CREATE SCHEMA IF NOT EXISTS "app";
SET LOCAL search_path = "app";

CREATE TYPE "UserRole" AS ENUM ('CUSTOMER', 'STAFF', 'ADMIN');
CREATE TYPE "OptionType" AS ENUM ('COLOR', 'PRINT');
CREATE TYPE "ProductImageType" AS ENUM ('PRIMARY', 'SECONDARY');
CREATE TYPE "OrderStatus" AS ENUM ('NOVO', 'CONFIRMADO', 'CANCELADO', 'CONCLUIDO');
CREATE TYPE "DeliveryMethod" AS ENUM ('CORREIOS', 'EXCURSAO');
CREATE TYPE "InventoryMovementType" AS ENUM ('INITIAL', 'ADJUSTMENT', 'ORDER_RESERVE', 'ORDER_RELEASE', 'ORDER_CONSUME', 'ORDER_RESTORE');

CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "email" VARCHAR(191) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'CUSTOMER',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "auth_sessions" (
    "id" TEXT NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "user_id" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "media_assets" (
    "id" TEXT NOT NULL,
    "url" VARCHAR(2048) NOT NULL,
    "public_id" VARCHAR(255),
    "alt_text" VARCHAR(255),
    "width" INTEGER,
    "height" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "categories" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "slug" VARCHAR(120) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "image_asset_id" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "slug" VARCHAR(180) NOT NULL,
    "description" TEXT,
    "material" VARCHAR(100) NOT NULL,
    "price_cents" INTEGER NOT NULL,
    "weight_grams" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "variant_options" (
    "id" TEXT NOT NULL,
    "type" "OptionType" NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "slug" VARCHAR(120) NOT NULL,
    "swatch_hex" VARCHAR(32),
    "active" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "variant_options_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "product_options" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "variant_option_id" TEXT NOT NULL,
    "image_asset_id" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "product_options_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sizes" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "sizes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "product_variants" (
    "id" TEXT NOT NULL,
    "product_option_id" TEXT NOT NULL,
    "size_id" TEXT NOT NULL,
    "sku" VARCHAR(100) NOT NULL,
    "price_cents" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "inventory_levels" (
    "variant_id" TEXT NOT NULL,
    "on_hand" INTEGER NOT NULL DEFAULT 0,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "inventory_levels_pkey" PRIMARY KEY ("variant_id")
);

CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "public_number" VARCHAR(32) NOT NULL,
    "user_id" TEXT,
    "customer_name" VARCHAR(120) NOT NULL,
    "customer_email" VARCHAR(191),
    "customer_whatsapp" VARCHAR(30) NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'NOVO',
    "delivery_method" "DeliveryMethod" NOT NULL,
    "postal_code" VARCHAR(9),
    "shipping_amount_cents" INTEGER,
    "shipping_detail" VARCHAR(255),
    "subtotal_cents" INTEGER NOT NULL,
    "total_cents" INTEGER NOT NULL,
    "paid_amount_cents" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "archived_at" TIMESTAMPTZ(3),
    "archived_by_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "order_items" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "product_variant_id" TEXT NOT NULL,
    "product_name_snapshot" VARCHAR(160) NOT NULL,
    "option_name_snapshot" VARCHAR(100) NOT NULL,
    "size_snapshot" VARCHAR(20) NOT NULL,
    "image_url_snapshot" VARCHAR(2048),
    "unit_price_cents_snapshot" INTEGER NOT NULL,
    "unit_weight_grams_snapshot" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "line_total_cents_snapshot" INTEGER NOT NULL,
    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "inventory_movements" (
    "id" TEXT NOT NULL,
    "variant_id" TEXT NOT NULL,
    "order_id" TEXT,
    "actor_id" TEXT,
    "type" "InventoryMovementType" NOT NULL,
    "on_hand_delta" INTEGER NOT NULL DEFAULT 0,
    "reserved_delta" INTEGER NOT NULL DEFAULT 0,
    "reason" VARCHAR(255),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "inventory_movements_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "product_images" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "product_option_id" TEXT,
    "asset_id" TEXT NOT NULL,
    "type" "ProductImageType" NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "product_images_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "site_banners" (
    "id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "title" VARCHAR(160),
    "subtitle" VARCHAR(255),
    "link_url" VARCHAR(2048),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "starts_at" TIMESTAMPTZ(3),
    "ends_at" TIMESTAMPTZ(3),
    CONSTRAINT "site_banners_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actor_id" TEXT,
    "order_id" TEXT,
    "entity_type" VARCHAR(80) NOT NULL,
    "entity_id" VARCHAR(191) NOT NULL,
    "action" VARCHAR(80) NOT NULL,
    "before_json" JSONB,
    "after_json" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE UNIQUE INDEX "auth_sessions_token_hash_key" ON "auth_sessions"("token_hash");
CREATE INDEX "auth_sessions_user_id_expires_at_idx" ON "auth_sessions"("user_id", "expires_at");
CREATE UNIQUE INDEX "media_assets_public_id_key" ON "media_assets"("public_id");
CREATE UNIQUE INDEX "categories_slug_key" ON "categories"("slug");
CREATE UNIQUE INDEX "products_slug_key" ON "products"("slug");
CREATE INDEX "products_category_id_active_idx" ON "products"("category_id", "active");
CREATE UNIQUE INDEX "variant_options_slug_key" ON "variant_options"("slug");
CREATE INDEX "product_options_product_id_active_idx" ON "product_options"("product_id", "active");
CREATE UNIQUE INDEX "product_options_product_id_variant_option_id_key" ON "product_options"("product_id", "variant_option_id");
CREATE UNIQUE INDEX "sizes_code_key" ON "sizes"("code");
CREATE UNIQUE INDEX "product_variants_sku_key" ON "product_variants"("sku");
CREATE UNIQUE INDEX "product_variants_product_option_id_size_id_key" ON "product_variants"("product_option_id", "size_id");
CREATE UNIQUE INDEX "orders_public_number_key" ON "orders"("public_number");
CREATE INDEX "orders_status_archived_at_created_at_idx" ON "orders"("status", "archived_at", "created_at");
CREATE INDEX "orders_user_id_created_at_idx" ON "orders"("user_id", "created_at");
CREATE INDEX "order_items_order_id_idx" ON "order_items"("order_id");
CREATE INDEX "inventory_movements_variant_id_created_at_idx" ON "inventory_movements"("variant_id", "created_at");
CREATE INDEX "inventory_movements_order_id_idx" ON "inventory_movements"("order_id");
CREATE INDEX "product_images_product_id_sort_order_idx" ON "product_images"("product_id", "sort_order");
CREATE INDEX "site_banners_active_sort_order_idx" ON "site_banners"("active", "sort_order");
CREATE INDEX "audit_logs_entity_type_entity_id_created_at_idx" ON "audit_logs"("entity_type", "entity_id", "created_at");

ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "categories" ADD CONSTRAINT "categories_image_asset_id_fkey" FOREIGN KEY ("image_asset_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "product_options" ADD CONSTRAINT "product_options_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "product_options" ADD CONSTRAINT "product_options_variant_option_id_fkey" FOREIGN KEY ("variant_option_id") REFERENCES "variant_options"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "product_options" ADD CONSTRAINT "product_options_image_asset_id_fkey" FOREIGN KEY ("image_asset_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_option_id_fkey" FOREIGN KEY ("product_option_id") REFERENCES "product_options"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_size_id_fkey" FOREIGN KEY ("size_id") REFERENCES "sizes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_levels" ADD CONSTRAINT "inventory_levels_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "orders" ADD CONSTRAINT "orders_archived_by_id_fkey" FOREIGN KEY ("archived_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_variant_id_fkey" FOREIGN KEY ("product_variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "inventory_levels"("variant_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_product_option_id_fkey" FOREIGN KEY ("product_option_id") REFERENCES "product_options"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "site_banners" ADD CONSTRAINT "site_banners_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
COMMIT;
