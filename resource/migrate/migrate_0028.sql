ALTER TABLE vendor_wakeup_job ADD COLUMN after_success_action TEXT DEFAULT 'none' NOT NULL;
ALTER TABLE vendor_wakeup_job ADD COLUMN after_success_keepalive_interval_min_seconds INTEGER DEFAULT 240 NOT NULL;
ALTER TABLE vendor_wakeup_job ADD COLUMN after_success_keepalive_interval_max_seconds INTEGER DEFAULT 420 NOT NULL;
ALTER TABLE vendor_wakeup_job ADD COLUMN after_success_keepalive_job_id INTEGER DEFAULT NULL;
ALTER TABLE vendor_wakeup_job ADD COLUMN schedule_mode TEXT DEFAULT 'window' NOT NULL;

UPDATE vendor_wakeup_job
SET after_success_action = 'duration'
WHERE mode = 'warmup' AND after_success_keepalive_minutes > 0;
