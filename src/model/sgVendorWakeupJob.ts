import { Model } from "sutando";
import { inspect, InspectOptions } from "util";

class SgVendorWakeupJob extends Model {
    table = "vendor_wakeup_job";

    casts = {
        last_run_at: "datetime",
        last_success_at: "datetime",
        next_run_at: "datetime",
        keepalive_until_at: "datetime",
    };

    id!: number;
    name!: string;
    vendor_id!: number;
    vendor_model_id!: number | null;
    model_name!: string;
    format!: string;
    auto_convert!: number | boolean;
    header_fingerprint!: string;
    mode!: string;
    enabled!: number | boolean;
    schedule_mode!: string;
    start_time!: string;
    end_time!: string;
    interval_min_seconds!: number;
    interval_max_seconds!: number;
    max_attempts!: number;
    daily_limit!: number;
    cooldown_after_429_seconds!: number;
    after_success_action!: string;
    after_success_keepalive_minutes!: number;
    after_success_keepalive_interval_min_seconds!: number;
    after_success_keepalive_interval_max_seconds!: number;
    after_success_keepalive_job_id!: number | null;
    prompt_category!: string;
    custom_prompts!: string | null;
    next_prompt!: string | null;
    system_prompt!: string | null;
    max_tokens!: number;
    temperature!: number;
    run_date!: string | null;
    run_count!: number;
    consecutive_failures!: number;
    last_status!: string;
    last_http_status!: number | null;
    last_error!: string | null;
    last_run_at!: Date | string | null;
    last_success_at!: Date | string | null;
    next_run_at!: Date | string | null;
    keepalive_until_at!: Date | string | null;
    created_at!: Date;
    updated_at!: Date;

    getCustomPrompts(): string[] {
        if (!this.custom_prompts) {
            return [];
        }

        try {
            const parsed = JSON.parse(this.custom_prompts);
            if (!Array.isArray(parsed)) {
                return [];
            }

            return parsed
                .map(item => String(item).trim())
                .filter(Boolean);
        } catch {
            return [];
        }
    }


    isEnabled(): boolean {
        return this.enabled === true || Number(this.enabled) === 1;
    }


    isAutoConvertEnabled(): boolean {
        return this.auto_convert === true || Number(this.auto_convert) === 1;
    }


    [inspect.custom](depth: number, options: InspectOptions) {
        return JSON.stringify(this.toData(), null, 2);
    }
}

export default SgVendorWakeupJob;
