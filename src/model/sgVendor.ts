import { Model } from "sutando";
import { inspect, InspectOptions } from "util";
import { VendorType, ApiFormat } from "../constants";
import vendorDefaultUrls from "../service/vendorDefaultUrls";
import customError from "../util/customError";
import urlUtil from "../util/urlUtil";

class SgVendor extends Model {
    table = "vendor";

    id!: number;
    type!: VendorType;
    name!: string;
    token!: string;
    urls!: string;  // JSON string
    headers!: string;  // JSON string
    header_fingerprint!: string;
    proxy_url!: string;

    created_at!: Date;
    updated_at!: Date;

    /**
     * Parse URLs JSON string to object
     */
    getUrls(): Record<string, string> {
        try {
            return this.urls ? JSON.parse(this.urls) : {};
        } catch {
            return {};
        }
    }


    /**
     * Parse custom upstream request headers JSON string to object.
     */
    getHeaders(): Record<string, string> {
        try {
            const parsed = this.headers ? JSON.parse(this.headers) : {};
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
                return {};
            }

            return Object.fromEntries(
                Object.entries(parsed)
                    .filter(([key, value]) => key.trim() && value !== null && value !== undefined)
                    .map(([key, value]) => [key.trim(), String(value)]),
            );
        } catch {
            return {};
        }
    }


    getProxyUrl(): string {
        return (this.proxy_url ?? "").trim();
    }


    getHeaderFingerprint(): string {
        return (this.header_fingerprint ?? "auto").trim() || "auto";
    }


    /**
     * Merge preset URLs and DB-stored custom URLs.
     * Custom URLs override presets with the same format key.
     */
    getMergedUrls(): Record<string, string> {
        const presetUrls = vendorDefaultUrls.getAllUrls()[this.type] ?? {};
        const merged = { ...presetUrls, ...this.getUrls() };
        delete merged['label'];
        return merged;
    }

    /**
     * Get URL by API format with default value handling
     * @param format - API format (openai, anthropic, google, etc.)
     * @returns URL string for the specified format
     * @throws Error if URL cannot be found or determined
     */
    /**
     * 根据 API 格式获取对应的 URL
     * @param format - API 格式（openai, anthropic, responses）
     * @returns 完整的 URL 字符串
     */
    getUrlByFormat(format: ApiFormat): string {
        const urls = this.getMergedUrls();
        let url: string | undefined;

        if (format === ApiFormat.RESPONSES) {
            // Responses 格式：优先使用 urls[RESPONSES]
            if (urls[ApiFormat.RESPONSES]) {
                url = urls[ApiFormat.RESPONSES];
                return url.includes("/responses") ? url : url.replace(/\/$/, "") + "/responses";
            }
            // 没有 urls[RESPONSES]，获取 OPENAI URL 并转换为 RESPONSES 格式
            return urlUtil.convertOpenaiToResponses(this.getUrlByFormat(ApiFormat.OPENAI));
        }

        if (format === ApiFormat.ANTHROPIC) {
            // Anthropic 格式：使用 urls[ANTHROPIC]
            url = urls[ApiFormat.ANTHROPIC];
            if (url) {
                return url.includes("/v1/messages") ? url : url.replace(/\/$/, "") + "/v1/messages";
            }
        }

        if (format === ApiFormat.OPENAI) {
            // OpenAI 格式：使用 urls[OPENAI]
            url = urls[ApiFormat.OPENAI];
            if (url) {
                return url.includes("/chat/completions") ? url : url.replace(/\/$/, "") + "/chat/completions";
            }
        }

        throw new customError.AppError(`vendor does not have url for ${format} format`, 400);
    }

    /**
     * 获取当前 vendor 支持的格式列表
     * @returns 支持的格式数组
     */
    getSupportedFormats(): ApiFormat[] {
        const urls = this.getMergedUrls();
        const formats: ApiFormat[] = [];

        if (urls[ApiFormat.OPENAI]) formats.push(ApiFormat.OPENAI);
        if (urls[ApiFormat.ANTHROPIC]) formats.push(ApiFormat.ANTHROPIC);
        if (urls[ApiFormat.RESPONSES]) formats.push(ApiFormat.RESPONSES);

        return formats;
    }

    [inspect.custom](depth: number, options: InspectOptions) {
        return JSON.stringify(this.toData(), null, 2);
    }
}

export { SgVendor };
