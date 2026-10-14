BEGIN;

-- This is a technical backend group, NOT a customer/STAFF/ADMIN role.
-- Provision a separate login and grant membership after deployment. No password
-- is stored here. Express continues to authorize the application's own sessions.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ferchu_backend') THEN
    CREATE ROLE ferchu_backend NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
      NOREPLICATION NOBYPASSRLS;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'ferchu_backend'
      AND (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole
        OR rolreplication OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'ferchu_backend must be an unprivileged NOLOGIN group';
  END IF;
END $$;

REVOKE ALL ON SCHEMA app FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA app FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA app FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app FROM PUBLIC;

-- These roles exist on Supabase, but not necessarily on local PostgreSQL.
DO $$
DECLARE role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL ON SCHEMA app FROM %I', role_name);
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA app FROM %I', role_name);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA app FROM %I', role_name);
    END IF;
  END LOOP;
END $$;

GRANT USAGE ON SCHEMA app TO ferchu_backend;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA app TO ferchu_backend;

-- Defense in depth if the private schema is accidentally exposed later.
-- Only the trusted backend group may access rows; no browser role has a policy.
DO $$
DECLARE table_name text;
BEGIN
  FOR table_name IN
    SELECT tablename FROM pg_tables WHERE schemaname = 'app'
      AND tablename <> '_prisma_migrations'
  LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY backend_access ON app.%I FOR ALL TO ferchu_backend USING (true) WITH CHECK (true)',
      table_name
    );
  END LOOP;
END $$;

-- Do not give the runtime login access to Prisma's migration history.
DO $$
BEGIN
  IF to_regclass('app._prisma_migrations') IS NOT NULL THEN
    REVOKE ALL ON TABLE app._prisma_migrations FROM ferchu_backend;
  END IF;
END $$;

ALTER TABLE app.inventory_levels
  ADD CONSTRAINT inventory_nonnegative CHECK (on_hand >= 0 AND reserved >= 0),
  ADD CONSTRAINT inventory_reserved_limit CHECK (reserved <= on_hand);
ALTER TABLE app.order_items
  ADD CONSTRAINT order_item_quantity_positive CHECK (quantity > 0),
  ADD CONSTRAINT order_item_amounts_nonnegative CHECK (
    unit_price_cents_snapshot >= 0 AND unit_weight_grams_snapshot >= 0
    AND line_total_cents_snapshot >= 0
  );
ALTER TABLE app.products
  ADD CONSTRAINT product_amounts_nonnegative CHECK (price_cents >= 0 AND weight_grams >= 0);
ALTER TABLE app.product_variants
  ADD CONSTRAINT variant_price_nonnegative CHECK (price_cents IS NULL OR price_cents >= 0);
ALTER TABLE app.orders
  ADD CONSTRAINT order_amounts_nonnegative CHECK (
    subtotal_cents >= 0 AND total_cents >= 0 AND paid_amount_cents >= 0
    AND (shipping_amount_cents IS NULL OR shipping_amount_cents >= 0)
  );
CREATE UNIQUE INDEX users_email_case_insensitive_key ON app.users (lower(email));

COMMIT;
