BEGIN;

CREATE TABLE app.auth_throttles (
  account_hash char(64) PRIMARY KEY,
  attempts integer NOT NULL CHECK (attempts BETWEEN 1 AND 10),
  window_start timestamptz(3) NOT NULL,
  next_allowed_at timestamptz(3) NOT NULL
);
CREATE INDEX auth_throttles_window_start_idx ON app.auth_throttles(window_start);
CREATE TABLE app.order_submissions (
  key_hash char(64) PRIMARY KEY,
  request_hash char(64) NOT NULL,
  response_json jsonb NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT now()
);
ALTER TABLE app.auth_throttles ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.order_submissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY backend_access ON app.auth_throttles FOR ALL TO ferchu_backend USING (true) WITH CHECK (true);
CREATE POLICY backend_access ON app.order_submissions FOR ALL TO ferchu_backend USING (true) WITH CHECK (true);
REVOKE ALL ON app.auth_throttles, app.order_submissions FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON app.auth_throttles TO ferchu_backend;
GRANT SELECT, INSERT ON app.order_submissions TO ferchu_backend;

-- Deploy with the API stopped: NOVO now means a commercial waiting list, not
-- a reservation. Keep every order/snapshot and record each released reservation.
LOCK TABLE app.orders, app.order_items, app.inventory_levels IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM app.inventory_levels l
    LEFT JOIN (
      SELECT i.product_variant_id, sum(i.quantity) AS quantity
      FROM app.order_items i JOIN app.orders o ON o.id = i.order_id
      WHERE o.status = 'NOVO' AND o.archived_at IS NULL
      GROUP BY i.product_variant_id
    ) pending ON pending.product_variant_id = l.variant_id
    WHERE l.reserved <> coalesce(pending.quantity, 0)
  ) THEN
    RAISE EXCEPTION 'Reservation reconciliation failed; review inventory before commercial-confirmation migration';
  END IF;
END $$;
INSERT INTO app.inventory_movements
  (id, variant_id, order_id, type, on_hand_delta, reserved_delta, reason, created_at)
SELECT 'commercial-release-' || i.id, i.product_variant_id, i.order_id,
  'ORDER_RELEASE', 0, -i.quantity, 'Pedido em espera: reserva legada liberada', now()
FROM app.order_items i JOIN app.orders o ON o.id = i.order_id
WHERE o.status = 'NOVO' AND o.archived_at IS NULL;
UPDATE app.inventory_levels SET reserved = 0, updated_at = now() WHERE reserved <> 0;
INSERT INTO app.audit_logs (id, order_id, entity_type, entity_id, action, after_json, created_at)
SELECT 'commercial-wait-' || id, id, 'ORDER', id, 'COMMERCIAL_WAIT_MIGRATED',
  '{"status":"NOVO","reservesStock":false}'::jsonb, now()
FROM app.orders WHERE status = 'NOVO' AND archived_at IS NULL;
COMMIT;
