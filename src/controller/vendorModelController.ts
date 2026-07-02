import { Context } from "hono";
import { SgVendor } from "../model/sgVendor";
import { SgVendorModel } from "../model/sgVendorModel";
import customError from "../util/customError";
import { ApiFormat } from "../constants";
import senderService from "../service/senderService";
import headerFingerprintService from "../service/headerFingerprintService";

type FetchModelSource = "auto" | "openai" | "anthropic";

const NON_LLM_PATTERNS = [
    /embedding/i,
    /rerank/i,
    /\btts\b/i,
    /text-to-speech/i,
    /speech-to-text/i,
    /whisper/i,
    /dall-e/i,
    /stable-diffusion/i,
    /image/i,           // 包含 image 关键字（图像生成模型）
    /image2video/i,
    /video-gen/i,
    /video/i,           // 视频生成模型
    /ocr/i,             // OCR 模型
    /livetranslate/i,   // 实时翻译
    /realtime-asr/i,    // 实时语音识别
    /moderation/i,
    /^wanx/i,           // Aliyun wanx 图像/视频生成
    /^wan\d/i,          // Aliyun wan2.7 等系列
    /^cosyvoice/i,      // Aliyun 语音合成
    /^sensevoice/i,     // Aliyun 语音识别
    /^sambert/i,        // Aliyun 语音
    /^paraformer/i,     // Aliyun 语音识别
];

function isLlmModel(modelId: string): boolean {
    return !NON_LLM_PATTERNS.some(pattern => pattern.test(modelId));
}


function serializeVendorModel(m: SgVendorModel) {
    return {
        ...m.toData(),
        allowed_formats: m.getAllowedFormats(),
        header_fingerprint: m.getHeaderFingerprint(),
    };
}


function resolveFetchModelSource(vendor: SgVendor, requestedSource: string | undefined): FetchModelSource {
    const source = requestedSource === "openai" || requestedSource === "anthropic" ? requestedSource : "auto";
    if (source !== "auto") {
        return source;
    }

    const supportedFormats = vendor.getSupportedFormats();
    if (supportedFormats.includes(ApiFormat.OPENAI)) {
        return "openai";
    }
    if (supportedFormats.includes(ApiFormat.ANTHROPIC)) {
        return "anthropic";
    }

    throw new customError.AppError("Vendor does not have a model list compatible URL", 400);
}


function getModelListBaseUrl(vendor: SgVendor, source: FetchModelSource): string {
    const urls = vendor.getMergedUrls();
    const preferredKey = source === "anthropic" ? ApiFormat.ANTHROPIC : ApiFormat.OPENAI;
    const preferredUrl = urls[preferredKey];
    if (preferredUrl) {
        return preferredUrl;
    }

    return urls[ApiFormat.OPENAI] ||
        urls[ApiFormat.ANTHROPIC] ||
        urls[ApiFormat.RESPONSES] ||
        Object.values(urls).find(Boolean) ||
        "";
}


function stripKnownModelEndpoint(url: string): string {
    return url
        .replace(/\/+$/, "")
        .replace(/\/chat\/completions$/i, "")
        .replace(/\/(v\d+(?:beta)?)\/messages$/i, "/$1")
        .replace(/\/messages$/i, "")
        .replace(/\/responses$/i, "")
        .replace(/\/(v\d+(?:beta)?)\/models$/i, "/$1")
        .replace(/\/models$/i, "")
        .replace(/\/+$/, "");
}


function appendModelsPath(baseUrl: string): string {
    const parsed = new URL(baseUrl);
    const path = parsed.pathname.replace(/\/+$/, "");
    const hasVersionSegment = /(^|\/)v\d+(?:beta)?(\/|$)/i.test(path);

    parsed.pathname = `${path || ""}${hasVersionSegment ? "/models" : "/v1/models"}`;
    parsed.search = "";
    parsed.hash = "";

    return parsed.toString();
}


function buildModelsUrl(vendor: SgVendor, source: FetchModelSource): string {
    const baseUrl = getModelListBaseUrl(vendor, source);
    if (!baseUrl) {
        throw new customError.AppError("Vendor does not have a model list compatible URL", 400);
    }

    return appendModelsPath(stripKnownModelEndpoint(baseUrl));
}


function buildModelFetchHeaders(vendor: SgVendor, source: FetchModelSource, requestHeaders: Headers | null): Headers {
    const requestFormat = source === "anthropic" ? ApiFormat.ANTHROPIC : ApiFormat.OPENAI;
    const headers = senderService.buildUpstreamHeaders(requestHeaders, vendor, requestFormat);
    const bearerToken = vendor.token.startsWith("Bearer ") ? vendor.token : `Bearer ${vendor.token}`;

    // Model list endpoints are not as consistently protocol-shaped as chat endpoints.
    // Send both common auth headers and then let provider custom headers override them.
    headers.set("Authorization", bearerToken);
    headers.set("x-api-key", vendor.token);
    for (const [key, value] of Object.entries(vendor.getHeaders())) {
        headers.set(key, value);
    }

    return headers;
}


function extractModelIds(data: any): string[] {
    if (Array.isArray(data?.data)) {
        return data.data
            .map((m: any) => typeof m === "string" ? m : m?.id)
            .filter(Boolean)
            .filter(isLlmModel);
    }

    if (Array.isArray(data?.models)) {
        return data.models
            .map((m: any) => typeof m === "string" ? m : m?.id)
            .filter(Boolean)
            .filter(isLlmModel);
    }

    return [];
}


async function listVendorModels(c: Context) {
    const vendorId = parseInt(c.req.param("id") ?? "", 10);
    if (isNaN(vendorId)) {
        throw new customError.AppError("Invalid ID format");
    }

    const models = await SgVendorModel.query()
        .where("vendor_id", vendorId)
        .orderBy("model_id", "asc")
        .get();

    return c.json(models.map(serializeVendorModel));
}


async function fetchVendorModels(c: Context) {
    const vendorId = parseInt(c.req.param("id") ?? "", 10);
    if (isNaN(vendorId)) {
        throw new customError.AppError("Invalid ID format");
    }

    const vendor = await SgVendor.query().find(vendorId);
    if (!vendor) {
        throw new customError.NotFoundError("Vendor not found");
    }

    const source = resolveFetchModelSource(vendor, c.req.query("source"));
    const modelsUrl = buildModelsUrl(vendor, source);
    const headers = buildModelFetchHeaders(vendor, source, c.req.raw.headers);

    try {
        const response = await senderService.fetchWithProxy(modelsUrl, {
            method: "GET",
            headers,
            signal: c.req.raw.signal,
        }, vendor);

        if (!response.ok) {
            const text = await response.text();
            throw new customError.AppError(
                `Upstream returned ${response.status}: ${text}`,
                502,
            );
        }

        const data: any = await response.json();

        // OpenAI /v1/models and Anthropic /v1/models both return { data: [{ id, ... }, ...] }.
        const models = extractModelIds(data);

        return c.json({ models, source });
    } catch (err: any) {
        if (err.statusCode) throw err;
        throw new customError.AppError(`Failed to fetch models: ${err.message}`, 502);
    }
}


async function syncVendorModels(c: Context) {
    const vendorId = parseInt(c.req.param("id") ?? "", 10);
    if (isNaN(vendorId)) {
        throw new customError.AppError("Invalid ID format");
    }

    const vendor = await SgVendor.query().find(vendorId);
    if (!vendor) {
        throw new customError.NotFoundError("Vendor not found");
    }

    const body = await c.req.json();
    const { model_ids } = body;

    if (!Array.isArray(model_ids)) {
        throw new customError.AppError("model_ids must be an array");
    }

    // 删除该 vendor 下所有旧记录，重新插入选中的
    await SgVendorModel.query().where("vendor_id", vendorId).delete();

    if (model_ids.length > 0) {
        for (const modelId of model_ids) {
            await SgVendorModel.query().create({
                vendor_id: vendorId,
                model_id: modelId,
            });
        }
    }

    const updated = await SgVendorModel.query()
        .where("vendor_id", vendorId)
        .orderBy("model_id", "asc")
        .get();

    return c.json(updated.map(serializeVendorModel));
}


async function addVendorModel(c: Context) {
    const vendorId = parseInt(c.req.param("id") ?? "", 10);
    if (isNaN(vendorId)) {
        throw new customError.AppError("Invalid ID format");
    }

    const vendor = await SgVendor.query().find(vendorId);
    if (!vendor) {
        throw new customError.NotFoundError("Vendor not found");
    }

    const body = await c.req.json();
    const { model_id, allowed_formats, header_fingerprint } = body;

    if (!model_id || typeof model_id !== "string" || !model_id.trim()) {
        throw new customError.AppError("model_id is required");
    }

    const trimmed = model_id.trim();

    const existing = await SgVendorModel.query()
        .where("vendor_id", vendorId)
        .where("model_id", trimmed)
        .first();

    if (existing) {
        throw new customError.AppError("Model already exists", 409);
    }

    let allowedFormatsJson: string | null = null;
    if (Array.isArray(allowed_formats) && allowed_formats.length > 0) {
        const validFormats = Object.values(ApiFormat);
        const filtered = allowed_formats.filter((f: unknown) => validFormats.includes(f as ApiFormat));
        allowedFormatsJson = filtered.length > 0 ? JSON.stringify(filtered) : null;
    }

    const record = await SgVendorModel.query().create({
        vendor_id: vendorId,
        model_id: trimmed,
        allowed_formats: allowedFormatsJson,
        header_fingerprint: headerFingerprintService.normalizeModelSetting(header_fingerprint),
    });

    return c.json(serializeVendorModel(record));
}


async function getVendorModelsByIds(c: Context) {
    const body = await c.req.json();
    const ids = body.ids;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return c.json([]);
    }

    const idList = ids.map((id: unknown) => parseInt(String(id), 10)).filter((id: number) => !isNaN(id));
    if (idList.length === 0) {
        return c.json([]);
    }

    const models = await SgVendorModel.query().whereIn("id", idList).get();
    return c.json(models.map(serializeVendorModel));
}


async function updateVendorModel(c: Context) {
    const vendorId = parseInt(c.req.param("id") ?? "", 10);
    const recordId = parseInt(c.req.param("modelId") ?? "", 10);

    if (isNaN(vendorId) || isNaN(recordId)) {
        throw new customError.AppError("Invalid ID format");
    }

    const record = await SgVendorModel.query()
        .where("id", recordId)
        .where("vendor_id", vendorId)
        .first();

    if (!record) {
        throw new customError.NotFoundError("Vendor model not found");
    }

    const body = await c.req.json();
    const { allowed_formats, header_fingerprint } = body;

    let allowedFormatsJson: string | null = null;
    if (Array.isArray(allowed_formats) && allowed_formats.length > 0) {
        const validFormats = Object.values(ApiFormat);
        const filtered = allowed_formats.filter((f: unknown) => validFormats.includes(f as ApiFormat));
        allowedFormatsJson = filtered.length > 0 ? JSON.stringify(filtered) : null;
    }

    const updateData: Record<string, string | null> = {
        allowed_formats: allowedFormatsJson,
    };
    if (header_fingerprint !== undefined) {
        updateData.header_fingerprint = headerFingerprintService.normalizeModelSetting(header_fingerprint);
    }

    await SgVendorModel.query().where("id", recordId).update(updateData);

    const updated = await SgVendorModel.query().find(recordId);
    return c.json(serializeVendorModel(updated!));
}


async function deleteVendorModel(c: Context) {
    const vendorId = parseInt(c.req.param("id") ?? "", 10);
    const recordId = parseInt(c.req.param("modelId") ?? "", 10);

    if (isNaN(vendorId) || isNaN(recordId)) {
        throw new customError.AppError("Invalid ID format");
    }

    const record = await SgVendorModel.query()
        .where("id", recordId)
        .where("vendor_id", vendorId)
        .first();

    if (!record) {
        throw new customError.NotFoundError("Vendor model not found");
    }

    await SgVendorModel.query().where("id", recordId).delete();

    return c.json({ success: true });
}


export default {
    listVendorModels,
    fetchVendorModels,
    syncVendorModels,
    addVendorModel,
    updateVendorModel,
    deleteVendorModel,
    getVendorModelsByIds,
};
