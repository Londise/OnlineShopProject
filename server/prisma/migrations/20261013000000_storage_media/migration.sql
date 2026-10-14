BEGIN;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM app.media_assets WHERE public_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Migrate external media identifiers before removing public_id';
  END IF;
END $$;
ALTER TABLE app.media_assets DROP COLUMN public_id;
ALTER TABLE app.media_assets
  ADD COLUMN storage_bucket varchar(100),
  ADD COLUMN storage_path varchar(512),
  ADD COLUMN mime_type varchar(100),
  ADD COLUMN byte_size integer CHECK (byte_size > 0),
  ADD COLUMN checksum_sha256 char(64),
  ADD COLUMN purpose varchar(20) NOT NULL DEFAULT 'library';
CREATE UNIQUE INDEX media_assets_storage_bucket_storage_path_key
  ON app.media_assets (storage_bucket, storage_path);
CREATE UNIQUE INDEX product_images_product_id_asset_id_key ON app.product_images (product_id, asset_id);
CREATE UNIQUE INDEX product_images_one_primary ON app.product_images (product_id) WHERE type = 'PRIMARY';
COMMIT;
