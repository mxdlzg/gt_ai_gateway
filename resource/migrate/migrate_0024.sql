ALTER TABLE vendor ADD COLUMN header_fingerprint TEXT DEFAULT 'auto' NOT NULL;
ALTER TABLE vendor_model ADD COLUMN header_fingerprint TEXT DEFAULT '' NOT NULL;
