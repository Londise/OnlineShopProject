BEGIN;
-- MySQL provided implicit FK indexes. PostgreSQL needs them explicitly.
CREATE INDEX "categories_image_asset_id_idx" ON app.categories (image_asset_id);
CREATE INDEX "product_options_variant_option_id_idx" ON app.product_options (variant_option_id);
CREATE INDEX "product_options_image_asset_id_idx" ON app.product_options (image_asset_id);
CREATE INDEX "product_variants_size_id_idx" ON app.product_variants (size_id);
CREATE INDEX "orders_archived_by_id_idx" ON app.orders (archived_by_id);
CREATE INDEX "order_items_product_variant_id_idx" ON app.order_items (product_variant_id);
CREATE INDEX "inventory_movements_actor_id_idx" ON app.inventory_movements (actor_id);
CREATE INDEX "product_images_product_option_id_idx" ON app.product_images (product_option_id);
CREATE INDEX "product_images_asset_id_idx" ON app.product_images (asset_id);
CREATE INDEX "site_banners_asset_id_idx" ON app.site_banners (asset_id);
CREATE INDEX "audit_logs_actor_id_idx" ON app.audit_logs (actor_id);
CREATE INDEX "audit_logs_order_id_idx" ON app.audit_logs (order_id);
COMMIT;
