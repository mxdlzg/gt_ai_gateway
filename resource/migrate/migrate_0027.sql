ALTER TABLE vendor_wakeup_job ADD COLUMN after_success_keepalive_minutes INTEGER DEFAULT 0 NOT NULL;
ALTER TABLE vendor_wakeup_job ADD COLUMN keepalive_until_at TIMESTAMP DEFAULT NULL;
