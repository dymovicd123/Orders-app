-- Dormant admin order deletion saga journal. Code is NOT wired to an HTTP
-- endpoint until every Exchange/Return financial and inventory E2E passes.
-- Applies only to isolated test DB at first; NOT to main/production.
CREATE TABLE IF NOT EXISTS admin_order_delete_sagas (
  request_id TEXT PRIMARY KEY NOT NULL,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  status TEXT NOT NULL DEFAULT 'planned'
    CHECK(status IN ('planned','running','review_required','ready_for_final_delete','cancelled')),
  preview_fingerprint TEXT NOT NULL CHECK(length(preview_fingerprint)=64),
  plan_json TEXT NOT NULL,
  next_step INTEGER NOT NULL DEFAULT 0 CHECK(next_step>=0),
  lease_token TEXT,
  lease_until_ms INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
-- Two concurrent admins cannot launch independent chains on one order.
CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_delete_active_saga_order
 ON admin_order_delete_sagas(order_id)
 WHERE status IN ('planned','running','review_required','ready_for_final_delete');
CREATE TABLE IF NOT EXISTS admin_order_delete_saga_steps (
  saga_request_id TEXT NOT NULL REFERENCES admin_order_delete_sagas(request_id),
  step_index INTEGER NOT NULL CHECK(step_index>=0),
  operation_type TEXT NOT NULL CHECK(operation_type IN ('exchange','return')),
  operation_id INTEGER NOT NULL CHECK(operation_id>0),
  cancel_request_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','started','completed')),
  started_at TEXT,
  completed_at TEXT,
  verified_result_json TEXT,
  PRIMARY KEY(saga_request_id,step_index),
  UNIQUE(saga_request_id,operation_type,operation_id)
);
CREATE INDEX IF NOT EXISTS idx_admin_delete_saga_steps_resume
 ON admin_order_delete_saga_steps(saga_request_id,status,step_index);
