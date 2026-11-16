BEGIN;
ALTER TABLE app.users ADD COLUMN email_verified_at timestamptz(3);
CREATE TABLE app.pending_registrations (
  email varchar(191) PRIMARY KEY,
  nonce uuid NOT NULL UNIQUE,
  token_hash char(64) NOT NULL UNIQUE,
  expires_at timestamptz(3) NOT NULL,
  consumed_at timestamptz(3),
  created_at timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX pending_registrations_expires_at_idx ON app.pending_registrations(expires_at);
ALTER TABLE app.pending_registrations ENABLE ROW LEVEL SECURITY;
CREATE POLICY backend_access ON app.pending_registrations FOR ALL TO ferchu_backend USING (true) WITH CHECK (true);
REVOKE ALL ON app.pending_registrations FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON app.pending_registrations TO ferchu_backend;
-- Public customer identities were never verified. Do not falsely mark them as
-- verified: require mailbox ownership + a new password, preserving IDs/orders.
-- Managed ADMIN/STAFF sessions are unaffected.
UPDATE app.auth_sessions SET revoked_at = now()
WHERE revoked_at IS NULL AND user_id IN (SELECT id FROM app.users WHERE role = 'CUSTOMER');
COMMIT;
