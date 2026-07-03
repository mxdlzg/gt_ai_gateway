export interface ConfigMap {
    cch_rewrite_enabled: string;
    responses_prompt_cache_key_enabled: string;
    claude_code_tracking_rewrite_enabled: string;
    request_record_enabled: string;
    request_record_request_body_enabled: string;
    request_record_response_body_enabled: string;
    request_record_headers_enabled: string;
    request_record_redaction_enabled: string;
    request_record_redaction_keys: string;
    request_record_retention_days: string;
    request_record_max_count: string;
    request_record_auto_cleanup_enabled: string;
    request_record_last_cleanup_at: string;
    routing_fallback_enabled: string;
    routing_max_attempts: string;
    routing_retry_status_codes: string;
    routing_selection_strategy: string;
    host_key: string;
    upstream_proxy_url: string;
    test_request_timeout_ms: string;
    wakeup_notification_enabled: string;
    wakeup_notify_warmup_success: string;
    wakeup_notify_warmup_failure: string;
    wakeup_notify_keepalive_failure: string;
    wakeup_notify_rate_limited: string;
    wakeup_notify_skipped: string;
    [key: string]: string;
}

export interface UpdateConfigRequest {
    cch_rewrite_enabled?: string;
    responses_prompt_cache_key_enabled?: string;
    claude_code_tracking_rewrite_enabled?: string;
    request_record_enabled?: string;
    request_record_request_body_enabled?: string;
    request_record_response_body_enabled?: string;
    request_record_headers_enabled?: string;
    request_record_redaction_enabled?: string;
    request_record_redaction_keys?: string;
    request_record_retention_days?: string;
    request_record_max_count?: string;
    request_record_auto_cleanup_enabled?: string;
    request_record_last_cleanup_at?: string;
    routing_fallback_enabled?: string;
    routing_max_attempts?: string;
    routing_retry_status_codes?: string;
    routing_selection_strategy?: string;
    host_key?: string;
    upstream_proxy_url?: string;
    test_request_timeout_ms?: string;
    wakeup_notification_enabled?: string;
    wakeup_notify_warmup_success?: string;
    wakeup_notify_warmup_failure?: string;
    wakeup_notify_keepalive_failure?: string;
    wakeup_notify_rate_limited?: string;
    wakeup_notify_skipped?: string;
    [key: string]: string | undefined;
}
