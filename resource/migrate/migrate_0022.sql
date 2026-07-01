CREATE TABLE IF NOT EXISTS model_provider_route (
    id              INTEGER   NOT NULL PRIMARY KEY AUTOINCREMENT,
    model_id        INTEGER   NOT NULL,
    vendor_id       INTEGER   NOT NULL,
    vendor_model_id INTEGER   NULL,
    priority        INTEGER   NOT NULL DEFAULT 100,
    weight          INTEGER   NOT NULL DEFAULT 1,
    enabled         INTEGER   NOT NULL DEFAULT 1,
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_model_provider_route_model_id ON model_provider_route (model_id);
CREATE INDEX IF NOT EXISTS idx_model_provider_route_vendor_id ON model_provider_route (vendor_id);
CREATE INDEX IF NOT EXISTS idx_model_provider_route_priority ON model_provider_route (model_id, enabled, priority);

INSERT INTO model_provider_route (model_id, vendor_id, vendor_model_id, priority, weight, enabled)
SELECT id, vendor_id, vendor_model_id, 100, 1, 1
FROM model
WHERE vendor_id IS NOT NULL
  AND NOT EXISTS (
      SELECT 1
      FROM model_provider_route
      WHERE model_provider_route.model_id = model.id
  );
