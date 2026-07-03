CREATE TABLE vendor_wakeup_job
(
    id                          INTEGER                             not null constraint vendor_wakeup_job_pk primary key autoincrement,
    name                        TEXT                                not null,
    vendor_id                   INTEGER                             not null,
    vendor_model_id             INTEGER                             default null,
    model_name                  TEXT                                not null,
    format                      TEXT                                default 'openai' not null,
    auto_convert                INTEGER                             default 0 not null,
    mode                        TEXT                                default 'keepalive' not null,
    enabled                     INTEGER                             default 1 not null,
    start_time                  TEXT                                default '08:30' not null,
    end_time                    TEXT                                default '18:30' not null,
    interval_min_seconds        INTEGER                             default 240 not null,
    interval_max_seconds        INTEGER                             default 420 not null,
    max_attempts                INTEGER                             default 8 not null,
    daily_limit                 INTEGER                             default 120 not null,
    cooldown_after_429_seconds  INTEGER                             default 900 not null,
    prompt_category             TEXT                                default 'mixed' not null,
    custom_prompts              TEXT                                default null,
    next_prompt                 TEXT                                default null,
    system_prompt               TEXT                                default null,
    max_tokens                  INTEGER                             default 64 not null,
    temperature                 REAL                                default 0.7 not null,
    run_date                    TEXT                                default null,
    run_count                   INTEGER                             default 0 not null,
    consecutive_failures        INTEGER                             default 0 not null,
    last_status                 TEXT                                default 'idle' not null,
    last_http_status            INTEGER                             default null,
    last_error                  TEXT                                default null,
    last_run_at                 TIMESTAMP                           default null,
    last_success_at             TIMESTAMP                           default null,
    next_run_at                 TIMESTAMP                           default null,
    created_at                  TIMESTAMP default CURRENT_TIMESTAMP not null,
    updated_at                  TIMESTAMP default CURRENT_TIMESTAMP not null
);

CREATE INDEX vendor_wakeup_job_enabled_next_run_idx
    ON vendor_wakeup_job (enabled, next_run_at);

CREATE INDEX vendor_wakeup_job_vendor_idx
    ON vendor_wakeup_job (vendor_id);

CREATE TABLE vendor_wakeup_log
(
    id               INTEGER                             not null constraint vendor_wakeup_log_pk primary key autoincrement,
    job_id           INTEGER                             not null,
    vendor_id        INTEGER                             not null,
    vendor_model_id  INTEGER                             default null,
    model_name       TEXT                                not null,
    format           TEXT                                not null,
    prompt_category  TEXT                                not null,
    prompt_text      TEXT                                not null,
    success          INTEGER                             default 0 not null,
    http_status      INTEGER                             default null,
    duration_ms      INTEGER                             default 0 not null,
    error            TEXT                                default null,
    error_detail     TEXT                                default null,
    response_preview TEXT                                default null,
    created_at       TIMESTAMP default CURRENT_TIMESTAMP not null,
    updated_at       TIMESTAMP default CURRENT_TIMESTAMP not null
);

CREATE INDEX vendor_wakeup_log_job_idx
    ON vendor_wakeup_log (job_id, id);

CREATE INDEX vendor_wakeup_log_created_idx
    ON vendor_wakeup_log (created_at);
