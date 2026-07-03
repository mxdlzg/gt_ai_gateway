import { Model } from "sutando";
import { inspect, InspectOptions } from "util";

class SgVendorWakeupLog extends Model {
    table = "vendor_wakeup_log";

    id!: number;
    job_id!: number;
    vendor_id!: number;
    vendor_model_id!: number | null;
    model_name!: string;
    format!: string;
    prompt_category!: string;
    prompt_text!: string;
    success!: number | boolean;
    http_status!: number | null;
    duration_ms!: number;
    error!: string | null;
    error_detail!: string | null;
    response_preview!: string | null;
    created_at!: Date;
    updated_at!: Date;

    [inspect.custom](depth: number, options: InspectOptions) {
        return JSON.stringify(this.toData(), null, 2);
    }
}

export default SgVendorWakeupLog;
