import type { BaseEntity, TableQuery } from './index';

export type WakeupMode = 'warmup' | 'keepalive';
export type WakeupScheduleMode = 'window' | 'always';
export type WakeupAfterSuccessAction = 'none' | 'duration' | 'job';
export type WakeupPromptCategory = 'mixed' | 'code' | 'chat' | 'self_chain';
export type WakeupStatus = 'idle' | 'success' | 'failed' | 'rate_limited' | 'skipped' | 'keeping_alive';

export type WakeupPromptTemplateMap = Record<WakeupPromptCategory, string[]>;

export interface WakeupJob extends BaseEntity {
    name: string;
    vendor_id: number;
    vendor_name: string | null;
    vendor_model_id: number | null;
    vendor_model_name: string | null;
    model_name: string;
    format: 'openai' | 'anthropic' | 'responses';
    auto_convert: boolean;
    mode: WakeupMode;
    enabled: boolean;
    schedule_mode: WakeupScheduleMode;
    start_time: string;
    end_time: string;
    interval_min_seconds: number;
    interval_max_seconds: number;
    max_attempts: number;
    daily_limit: number;
    cooldown_after_429_seconds: number;
    after_success_action: WakeupAfterSuccessAction;
    after_success_keepalive_minutes: number;
    after_success_keepalive_interval_min_seconds: number;
    after_success_keepalive_interval_max_seconds: number;
    after_success_keepalive_job_id: number | null;
    after_success_keepalive_job_name: string | null;
    prompt_category: WakeupPromptCategory;
    custom_prompts: string[];
    next_prompt: string | null;
    system_prompt: string | null;
    max_tokens: number;
    temperature: number;
    run_date: string | null;
    run_count: number;
    consecutive_failures: number;
    last_status: WakeupStatus;
    last_http_status: number | null;
    last_error: string | null;
    last_run_at: string | null;
    last_success_at: string | null;
    next_run_at: string | null;
    keepalive_until_at: string | null;
}

export interface WakeupJobQuery extends TableQuery {
    vendor_id?: number;
    enabled?: string;
    mode?: WakeupMode;
}

export interface WakeupJobPayload {
    id?: number;
    name: string;
    vendor_id: number | null;
    vendor_model_id?: number | null;
    model_name: string;
    format: 'openai' | 'anthropic' | 'responses';
    auto_convert: boolean;
    mode: WakeupMode;
    enabled: boolean;
    schedule_mode?: WakeupScheduleMode;
    start_time: string;
    end_time: string;
    interval_min_seconds: number;
    interval_max_seconds: number;
    max_attempts: number;
    daily_limit: number;
    cooldown_after_429_seconds: number;
    after_success_action?: WakeupAfterSuccessAction;
    after_success_keepalive_minutes: number;
    after_success_keepalive_interval_min_seconds?: number;
    after_success_keepalive_interval_max_seconds?: number;
    after_success_keepalive_job_id?: number | null;
    prompt_category: WakeupPromptCategory;
    custom_prompts?: string[];
    system_prompt?: string | null;
    max_tokens: number;
    temperature: number;
}

export interface WakeupLog extends BaseEntity {
    job_id: number;
    job_name: string | null;
    vendor_id: number;
    vendor_name: string | null;
    vendor_model_id: number | null;
    model_name: string;
    format: string;
    prompt_category: WakeupPromptCategory;
    prompt_text: string;
    success: boolean;
    http_status: number | null;
    duration_ms: number;
    error: string | null;
    error_detail: string | null;
    response_preview: string | null;
}

export interface WakeupLogQuery extends TableQuery {
    job_id?: number;
    success?: string;
}

export interface WakeupRunResponse {
    success: boolean;
    status?: number;
    duration: number;
    error?: string;
    error_detail?: unknown;
    response_preview?: string;
    manual: boolean;
    job: WakeupJob;
    log: WakeupLog;
}

export interface WakeupPromptCategoryOption {
    value: WakeupPromptCategory;
    label: string;
    description: string;
}

export interface WakeupPromptTemplateSettings {
    categories: WakeupPromptCategoryOption[];
    prompts: WakeupPromptTemplateMap;
    defaults: WakeupPromptTemplateMap;
}
