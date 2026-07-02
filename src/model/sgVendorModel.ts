import { Model } from "sutando";
import { inspect, InspectOptions } from "util";
import { ApiFormat } from "../constants";

class SgVendorModel extends Model {
    table = "vendor_model";

    id!: number;
    vendor_id!: number;
    model_id!: string;
    allowed_formats!: string | null;
    header_fingerprint!: string;

    created_at!: Date;
    updated_at!: Date;

    getAllowedFormats(): ApiFormat[] | null {
        if (!this.allowed_formats) return null;
        try { return JSON.parse(this.allowed_formats) as ApiFormat[]; } catch { return null; }
    }

    /**
     * 获取当前 vendorModel 支持的格式列表
     * @returns 支持的格式数组，未配置时返回 null 表示无限制
     */
    getSupportedFormats(): ApiFormat[] | null {
        return this.getAllowedFormats();
    }


    getHeaderFingerprint(): string {
        return (this.header_fingerprint ?? "").trim();
    }


    [inspect.custom](depth: number, options: InspectOptions) {
        return JSON.stringify(this.toData(), null, 2);
    }
}

export { SgVendorModel };
