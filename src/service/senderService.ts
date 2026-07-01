import { Context } from "hono";
import { SgModel } from "../model/sgModel";
import { StatusCode } from "hono/utils/http-status";
import { streamSSE, SSEStreamingApi } from "hono/streaming";
import { SgUser } from "../model/sgUser";
import { SgVendor } from "../model/sgVendor";
import { SgVendorModel } from "../model/sgVendorModel";
import SgModelProviderRoute from "../model/sgModelProviderRoute";
import recordService from "./recordService";
import ormService from "./ormService";
import { SgRecordStatus, FailedCode, ApiFormat } from "../constants";
import sseAccumulator from "../util/sseAccumulator";
import { SgRecord, SgRecordUsage } from "../model/sgRecord";
import { createWriteStream, WriteStream } from "fs";
import fs from "fs/promises";
import { join } from "path";
import { getLogDir } from "../util/logger";
import userService from "./userService";
import customError from "../util/customError";
import { ConverterFactory } from "../util/protocolConverter/ConverterFactory";
import pluginService from "./pluginService";
import type { BaseConverter } from "../util/protocolConverter/BaseConverter";
import type { ProtocolStreamEvent } from "../util/protocolConverter/protocolTypes";
import sseEvent from "../util/sseEvent";
import configService, { ConfigKey } from "./configService";
import hostService from "./hostService";
import { runInBackground } from "../util/runInBackground";

function calculateCost(
    model: SgModel,
    promptTokens: number,
    outputTokens: number,
    cacheReadTokens: number = 0,
): number {
    const prices = model.prices || {};
    const inputPrice = prices.input ?? 0;
    const cacheReadPrice = prices.cache_read ?? 0;
    const outputPrice = prices.output ?? 0;

    const normalPromptTokens = Math.max(0, promptTokens - cacheReadTokens);
    const promptCost = (normalPromptTokens / 1000) * inputPrice;
    const cacheCost = (cacheReadTokens / 1000) * cacheReadPrice;
    const outputCost = (outputTokens / 1000) * outputPrice;
    return promptCost + cacheCost + outputCost;
}


type Dict = Record<string, unknown>;

const EXCLUDED_FORWARD_HEADERS = [
    "authorization",
    "x-api-key",
    "anthropic-version",
    "content-length",
    "host",
    "origin",
    "referer",
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
];


/**
 * 解析上游支持的格式
 * 根据客户端请求的格式和支持的格式列表，计算最终应该用什么格式
 *
 * @param clientFormat - 客户端请求的格式
 * @param supportedFormats - 支持的格式列表（vendor 或 vendorModel 的）
 * @returns 最终应该使用的格式
 */
function resolveUpstreamFormat(
    clientFormat: ApiFormat,
    supportedFormats: ApiFormat[],
): ApiFormat {
    // 如果支持客户端格式，直接使用
    if (supportedFormats.includes(clientFormat)) {
        return clientFormat;
    }

    // 尝试其他支持的格式（按优先级排序）
    const supportedAlternativeFormats: Partial<Record<ApiFormat, ApiFormat[]>> = {
        [ApiFormat.OPENAI]: [ApiFormat.ANTHROPIC],
        [ApiFormat.ANTHROPIC]: [ApiFormat.OPENAI, ApiFormat.RESPONSES],
        [ApiFormat.RESPONSES]: [ApiFormat.ANTHROPIC],
    };

    for (const fmt of supportedAlternativeFormats[clientFormat] ?? []) {
        if (supportedFormats.includes(fmt)) return fmt;
    }

    // 如果没有找到支持的格式，返回客户端请求的格式
    return clientFormat;
}


function shouldForwardHeader(key: string): boolean {
    const lowerKey = key.toLowerCase();
    return !lowerKey.startsWith("cf-") &&
        !lowerKey.startsWith("sec-") &&
        !EXCLUDED_FORWARD_HEADERS.includes(lowerKey);
}


function applyVendorHeaders(headers: Headers, vendor: SgVendor): void {
    const customHeaders = vendor.getHeaders();
    for (const [key, value] of Object.entries(customHeaders)) {
        headers.set(key, value);
    }
}


function buildUpstreamHeaders(
    requestHeaders: Headers | null,
    vendor: SgVendor,
    upstreamFormat: ApiFormat,
): Headers {
    const finalHeaders = new Headers();

    if (requestHeaders) {
        for (const [key, value] of requestHeaders.entries()) {
            if (shouldForwardHeader(key)) {
                finalHeaders.set(key, value);
            }
        }
    }

    if (upstreamFormat === ApiFormat.ANTHROPIC) {
        finalHeaders.set("x-api-key", vendor.token);
        finalHeaders.set("anthropic-version", "2023-06-01");
    } else {
        finalHeaders.set("Authorization", vendor.token.startsWith("Bearer ") ? vendor.token : `Bearer ${vendor.token}`);
    }

    finalHeaders.set("Content-Type", "application/json");
    applyVendorHeaders(finalHeaders, vendor);

    return finalHeaders;
}


function serializeHeaders(headers: Headers): Record<string, string> {
    return Object.fromEntries(headers.entries());
}


const proxyAgentCache = new Map<string, unknown>();


async function getProxyAgent(proxyUrl: string): Promise<unknown> {
    const cached = proxyAgentCache.get(proxyUrl);
    if (cached) return cached;

    const { ProxyAgent } = await import("undici");
    const agent = new ProxyAgent(proxyUrl);
    proxyAgentCache.set(proxyUrl, agent);
    return agent;
}


async function resolveProxyUrl(vendor?: SgVendor | null): Promise<string> {
    const vendorProxyUrl = vendor?.getProxyUrl() ?? "";
    if (vendorProxyUrl) {
        return vendorProxyUrl;
    }

    return (await configService.getConfig(ConfigKey.UPSTREAM_PROXY_URL, "")).getString().trim();
}


async function buildFetchInitWithProxy(
    init: RequestInit,
    vendor?: SgVendor | null,
): Promise<RequestInit> {
    const proxyUrl = await resolveProxyUrl(vendor);
    if (!proxyUrl || !ormService.isNode) {
        return init;
    }

    return {
        ...init,
        dispatcher: await getProxyAgent(proxyUrl),
    } as RequestInit;
}


async function fetchWithProxy(
    url: string,
    init: RequestInit,
    vendor?: SgVendor | null,
): Promise<Response> {
    return fetch(url, await buildFetchInitWithProxy(init, vendor) as RequestInit);
}


interface SelectedProviderRoute {
    vendor: SgVendor;
    vendorModel: SgVendorModel | null;
    vendorModelName: string | null;
    supportedFormats: ApiFormat[];
}


function chooseWeightedRoute<T extends { weight: number }>(routes: T[]): T {
    const totalWeight = routes.reduce((sum, route) => sum + Math.max(1, route.weight), 0);
    let cursor = Math.random() * totalWeight;

    for (const route of routes) {
        cursor -= Math.max(1, route.weight);
        if (cursor <= 0) return route;
    }

    return routes[routes.length - 1];
}


async function buildLegacyRoute(modelConfig: SgModel): Promise<SgModelProviderRoute | null> {
    if (!modelConfig.vendor_id) return null;

    const route = new SgModelProviderRoute();
    route.model_id = modelConfig.id;
    route.vendor_id = modelConfig.vendor_id;
    route.vendor_model_id = modelConfig.vendor_model_id ?? null;
    route.priority = 100;
    route.weight = 1;
    route.enabled = true;
    return route;
}


async function getCandidateRoutes(modelConfig: SgModel): Promise<SgModelProviderRoute[]> {
    const routes = await SgModelProviderRoute.query()
        .where("model_id", modelConfig.id)
        .where("enabled", 1)
        .orderBy("priority", "asc")
        .orderBy("id", "asc")
        .get();

    const routeList = routes.toArray() as SgModelProviderRoute[];
    if (routeList.length > 0) return routeList;

    const legacyRoute = await buildLegacyRoute(modelConfig);
    return legacyRoute ? [legacyRoute] : [];
}


async function resolveProviderRoute(
    modelConfig: SgModel,
    clientFormat: ApiFormat,
): Promise<SelectedProviderRoute & { upstreamFormat: ApiFormat; url: string }> {
    const routes = await getCandidateRoutes(modelConfig);
    const candidates: Array<SelectedProviderRoute & { priority: number; weight: number; upstreamFormat: ApiFormat; url: string }> = [];

    for (const route of routes) {
        const vendor = await SgVendor.query().find(route.vendor_id);
        if (!vendor) continue;

        let vendorModel: SgVendorModel | null = null;
        let vendorModelName: string | null = modelConfig.name;
        let supportedFormats: ApiFormat[] | null = null;

        if (route.vendor_model_id) {
            vendorModel = await SgVendorModel.query()
                .where("id", route.vendor_model_id)
                .where("vendor_id", route.vendor_id)
                .first();
            if (vendorModel) {
                vendorModelName = vendorModel.model_id;
                supportedFormats = vendorModel.getSupportedFormats();
            }
        }

        const finalSupportedFormats = supportedFormats ?? vendor.getSupportedFormats();
        const upstreamFormat = resolveUpstreamFormat(clientFormat, finalSupportedFormats);

        try {
            const url = vendor.getUrlByFormat(upstreamFormat);
            candidates.push({
                vendor,
                vendorModel,
                vendorModelName,
                supportedFormats: finalSupportedFormats,
                priority: Number(route.priority ?? 100),
                weight: Math.max(1, Number(route.weight ?? 1)),
                upstreamFormat,
                url,
            });
        } catch (e) {
            console.log("[senderService] Skip route without compatible URL:", {
                modelId: modelConfig.id,
                vendorId: route.vendor_id,
                vendorModelId: route.vendor_model_id,
                upstreamFormat,
                error: e instanceof Error ? e.message : String(e),
            });
        }
    }

    if (candidates.length === 0) {
        throw new customError.AppError("No available provider route for model", 400);
    }

    const minPriority = Math.min(...candidates.map(route => route.priority));
    const topRoutes = candidates.filter(route => route.priority === minPriority);
    return chooseWeightedRoute(topRoutes);
}


function normalizeUsage(format: ApiFormat, usage: Dict | null | undefined) {
    if (!usage) return null;

    const recordUsage = new SgRecordUsage();
    let promptTokens = 0;
    let outputTokens = 0;
    let cacheReadTokens = 0;

    if (format === ApiFormat.OPENAI) {
        promptTokens = (usage.prompt_tokens as number | undefined) ?? 0;
        outputTokens = (usage.completion_tokens as number | undefined) ?? 0;
        cacheReadTokens = ((usage.prompt_tokens_details as Dict | undefined)?.cached_tokens as number | undefined)
            ?? (usage.cache_read_tokens as number | undefined)
            ?? 0;
        recordUsage.prompt_tokens = Math.max(0, promptTokens - cacheReadTokens);
    }

    if (format === ApiFormat.ANTHROPIC) {
        promptTokens = ((usage.input_tokens as number | undefined) ?? 0) + ((usage.cache_read_input_tokens as number | undefined) ?? 0);
        outputTokens = (usage.output_tokens as number | undefined) ?? 0;
        cacheReadTokens = (usage.cache_read_input_tokens as number | undefined)
            ?? (usage.cache_read_tokens as number | undefined)
            ?? 0;
        recordUsage.prompt_tokens = (usage.input_tokens as number | undefined) ?? 0;
        recordUsage.cache_creation_tokens = (usage.cache_creation_input_tokens as number | undefined)
            ?? (usage.cache_creation_tokens as number | undefined);
    }

    if (format === ApiFormat.RESPONSES) {
        promptTokens = (usage.input_tokens as number | undefined)
            ?? (usage.prompt_tokens as number | undefined)
            ?? 0;
        outputTokens = (usage.output_tokens as number | undefined)
            ?? (usage.completion_tokens as number | undefined)
            ?? 0;
        cacheReadTokens = ((usage.input_tokens_details as Dict | undefined)?.cached_tokens as number | undefined)
            ?? ((usage.prompt_tokens_details as Dict | undefined)?.cached_tokens as number | undefined)
            ?? (usage.cache_read_input_tokens as number | undefined)
            ?? (usage.cache_read_tokens as number | undefined)
            ?? 0;
        recordUsage.prompt_tokens = Math.max(0, promptTokens - cacheReadTokens);
    }

    recordUsage.completion_tokens = outputTokens;
    recordUsage.cache_read_tokens = cacheReadTokens;
    return { recordUsage, promptTokens, outputTokens, cacheReadTokens };
}


function isResponsesOutputStartedEvent(eventType: string): boolean {
    return [
        "response.output_item.added",
        "response.content_part.added",
        "response.output_text.delta",
        "response.function_call_arguments.delta",
        "response.reasoning_summary_text.delta",
        "response.reasoning_summary_part.added",
    ].includes(eventType);
}


function buildStreamUsageAccounting(format: ApiFormat, usage: Dict | null | undefined, model: SgModel) {
    if (!usage) return { usageJson: null, cost: 0 };

    if (format === ApiFormat.OPENAI) {
        const normalizedUsage = normalizeUsage(ApiFormat.OPENAI, usage);
        const cost = normalizedUsage
            ? calculateCost(model, normalizedUsage.promptTokens, normalizedUsage.outputTokens, normalizedUsage.cacheReadTokens)
            : 0;

        return {
            usageJson: normalizedUsage ? JSON.stringify(normalizedUsage.recordUsage) : null,
            cost,
        };
    }

    const promptTokens = (usage.prompt_tokens as number | undefined) ?? 0;
    const outputTokens = (usage.completion_tokens as number | undefined) ?? 0;
    const cacheReadTokens = (usage.cache_read_tokens as number | undefined) ?? 0;
    const cost = calculateCost(model, promptTokens + cacheReadTokens, outputTokens, cacheReadTokens);

    return {
        usageJson: JSON.stringify(usage),
        cost,
    };
}


async function prepareStreamLog(record: SgRecord): Promise<WriteStream | null> {
    const isStreamLogEnabled = ormService.isNode && process.env.STREAM_LOG_ENABLED === "true";

    if (!isStreamLogEnabled) {
        return null;
    }

    const baseLogDir = getLogDir();
    const logDir = join(baseLogDir, "stream");
    console.log("[senderService] Stream log enabled, dir:", logDir);

    try {
        await fs.mkdir(logDir, { recursive: true });
    } catch (e: any) {
        console.log("[senderService] Failed to create log dir:", e);
        return null;
    }

    const logFilePath = join(logDir, `${record.id}.log`);
    console.log("[senderService] Stream log file path:", logFilePath);

    return createWriteStream(logFilePath, { flags: "a" });
}


async function writeRequestLog(record: SgRecord, body: string): Promise<void> {
    const isStreamLogEnabled = ormService.isNode && process.env.STREAM_LOG_ENABLED === "true";
    if (!isStreamLogEnabled) return;

    const logDir = join(getLogDir(), "stream");
    try {
        await fs.mkdir(logDir, { recursive: true });
    } catch (e: any) {
        console.log("[senderService] Failed to create log dir:", e);
        return;
    }

    const logFilePath = join(logDir, `${record.id}.after_convert_req.log`);
    const ws = createWriteStream(logFilePath);
    ws.end(body);
}


function appendStreamLog(logStream: WriteStream | null, chunk: string): void {
    if (!logStream) {
        return;
    }

    console.log(
        "[senderService] Chunk length:",
        chunk.length,
        "contains \\n:",
        chunk.includes("\n"),
        "contains \\n\\n:",
        chunk.includes("\n\n"),
    );

    logStream.write(chunk);
}


async function handleStreamResponse(
    c: Context,
    upstreamRes: Response,
    record: SgRecord,
    model: SgModel,
    user: SgUser,
    format: ApiFormat,
    upstreamFormat: ApiFormat = format,
    converter: BaseConverter | null = null,
): Promise<Response> {
    const needsConversion = format !== upstreamFormat;
    const accumulator = new sseAccumulator.SSEAccumulator(
        format === ApiFormat.ANTHROPIC ? "anthropic" : "openai",
    );

    let firstTokenTime: number | null = null;

    const logStream = await prepareStreamLog(record);

    return streamSSE(c, async (stream: SSEStreamingApi) => {
        const reader = upstreamRes.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let eventCount = 0;
        let streamCompleted = false;
        let failedCode: string | null = null;

        const abortHandler = () => {
            if (!failedCode) failedCode = FailedCode.CLIENT_DISCONNECTED;
            reader.cancel().catch(() => {});
        };
        c.req.raw.signal.addEventListener("abort", abortHandler);

        try {
            // 逐块读取上游 SSE 字节流
            while (true) {
                let done: boolean;
                let value: Uint8Array | undefined;
                try {
                    const result = await reader.read();
                    done = result.done;
                    value = result.value;
                } catch (e: any) {
                    console.error("[senderService] Upstream read error:", e);
                    if (!failedCode) failedCode = FailedCode.UPSTREAM_DISCONNECTED;
                    break;
                }
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                appendStreamLog(logStream, chunk);
                buffer += chunk;

                const splitResult = sseEvent.splitEvents(buffer);
                const events = splitResult.events;
                buffer = splitResult.remainingBuffer;

                let clientDisconnected = false;
                for (const event of events) {
                    if (!event.trim()) continue;

                    eventCount++;

                    const parsedEvent = sseEvent.parseEvent(event);
                    if (!parsedEvent) continue;

                    const clientEvents = needsConversion && converter
                        ? converter.convertStreamEvent(parsedEvent.data, parsedEvent.event, parsedEvent.id)
                        : [parsedEvent];

                    for (const clientEvent of clientEvents) {
                        if (!clientEvent.data) continue;

                        const isCompleted = sseEvent.isClientStreamCompleted(format, clientEvent);
                        if (firstTokenTime === null && !isCompleted) {
                            firstTokenTime = Date.now();
                        }

                        if (isCompleted) {
                            streamCompleted = true;
                        } else if (sseEvent.isClientStreamError(format, clientEvent)) {
                            failedCode = FailedCode.UPSTREAM_ERROR;
                        }

                        try {
                            await stream.writeSSE({
                                data: clientEvent.data,
                                event: clientEvent.event,
                                id: clientEvent.id,
                            });
                        } catch (e: any) {
                            console.error("[senderService] Client write error (client disconnected):", e);
                            failedCode = FailedCode.CLIENT_DISCONNECTED;
                            clientDisconnected = true;
                            break;
                        }

                        if (isCompleted) continue;

                        try {
                            const parsedData = JSON.parse(clientEvent.data);
                            accumulator.addMessage(parsedData, clientEvent.event);
                        } catch (e) {
                            console.log("Failed to parse SSE data:", clientEvent.data, e);
                        }
                    }

                    if (clientDisconnected) break;
                }

                if (clientDisconnected) break;
            }
        } catch (e: any) {
            console.error("[senderService] Unexpected stream error:", e);
            if (!failedCode) {
                failedCode = FailedCode.UPSTREAM_DISCONNECTED;
            }
        }

        c.req.raw.signal.removeEventListener("abort", abortHandler);

        console.log(`[senderService] Stream ended, events: ${eventCount}, completed: ${streamCompleted}, failedCode: ${failedCode}`);

        runInBackground(c, async () => {
            if (streamCompleted) {
                // 流结束，保存完整响应到数据库
                const fullResponse = accumulator.getResponse();
                const usage = fullResponse.usage;
                const usageAccounting = buildStreamUsageAccounting(format, usage, model);

                await recordService.update(record.id, {
                    response_data: JSON.stringify(fullResponse),
                    status: SgRecordStatus.SUCCESS,
                    usage: usageAccounting.usageJson,
                    first_token_latency: firstTokenTime !== null
                        ? firstTokenTime - record.created_at.getTime()
                        : null,
                    end_at: new Date(),
                    cost: usageAccounting.cost,
                });

                // 扣除用户余额（仅非 Root 用户）
                if (user.type !== "root") {
                    await userService.deductBalance(user.id, usageAccounting.cost);
                }
            } else {
                await recordService.update(record.id, {
                    status: SgRecordStatus.FAILED,
                    failed_code: failedCode ?? FailedCode.STREAM_INCOMPLETE,
                    end_at: new Date(),
                });
            }
        });

        logStream?.end();
    });
}


async function handleNonStreamResponse(
    c: Context,
    upstreamRes: Response,
    record: SgRecord,
    model: SgModel,
    user: SgUser,
    format: ApiFormat,
    upstreamFormat: ApiFormat = format,
    converter: BaseConverter | null = null,
): Promise<Response> {
    const responseText = await upstreamRes.text();
    const statusCode = upstreamRes.status as StatusCode;
    const needsConversion = format !== upstreamFormat;

    if (!upstreamRes.ok) {
        console.error("[senderService] Upstream non-stream error response:", {
            recordId: record.id,
            status: statusCode,
            contentType: upstreamRes.headers.get("content-type"),
            body: responseText,
        });

        await recordService.update(record.id, {
            response_data: responseText,
            status: SgRecordStatus.FAILED,
            usage: null,
            end_at: new Date(),
            cost: 0,
        });

        c.status(statusCode);
        c.res.headers.set("Content-Type", upstreamRes.headers.get("content-type") || "application/json");
        return c.body(responseText);
    }

    let clientResponseText = responseText;
    if (needsConversion && converter) {
        try {
            const responseJson = JSON.parse(responseText);
            const clientRes = converter.convertResponse(responseJson);
            clientResponseText = JSON.stringify(clientRes);
        } catch (e) {
            console.error("[senderService] Failed to convert response format:", e);
            throw new customError.AppError(
                `Failed to convert upstream response format: ${e instanceof Error ? e.message : String(e)}`,
                502,
            );
        }
    }

    let normalizedUsage: ReturnType<typeof normalizeUsage> | null = null;
    try {
        const responseJson = JSON.parse(responseText);
        normalizedUsage = normalizeUsage(upstreamFormat, responseJson.usage);
    } catch (e) {
        console.log("Failed to parse response for token stats:", e);
    }

    const usageJson = normalizedUsage ? JSON.stringify(normalizedUsage.recordUsage) : null;
    const cost = normalizedUsage
        ? calculateCost(model, normalizedUsage.promptTokens, normalizedUsage.outputTokens, normalizedUsage.cacheReadTokens)
        : 0;

    await recordService.update(record.id, {
        response_data: clientResponseText,
        status: statusCode === 200 ? SgRecordStatus.SUCCESS : SgRecordStatus.FAILED,
        usage: usageJson,
        end_at: new Date(),
        cost: cost,
    });

    // 扣除用户余额（仅非 Root 用户且请求成功）
    if (user.type !== "root" && statusCode === 200) {
        await userService.deductBalance(user.id, cost);
    }

    c.status(statusCode);
    c.res.headers.set("Content-Type", "application/json");
    return c.text(clientResponseText);
}


async function handleResponsesStreamResponse(
    c: Context,
    upstreamRes: Response,
    record: SgRecord,
    model: SgModel,
    user: SgUser,
    converter: BaseConverter | null = null,
    upstreamFormat: ApiFormat = ApiFormat.RESPONSES,
): Promise<Response> {
    let firstTokenTime: number | null = null;
    const logStream = await prepareStreamLog(record);
    const needsConversion = converter !== null;

    return streamSSE(c, async (stream: SSEStreamingApi) => {
        const reader = upstreamRes.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let streamCompleted = false;
        let failedCode: string | null = null;

        const abortHandler = () => {
            if (!failedCode) failedCode = FailedCode.CLIENT_DISCONNECTED;
            reader.cancel().catch(() => {});
        };
        c.req.raw.signal.addEventListener("abort", abortHandler);

        try {
            while (true) {
                let done: boolean;
                let value: Uint8Array | undefined;
                try {
                    const result = await reader.read();
                    done = result.done;
                    value = result.value;
                } catch (e: any) {
                    console.error("[senderService] Upstream read error (responses):", e);
                    if (!failedCode) failedCode = FailedCode.UPSTREAM_DISCONNECTED;
                    break;
                }
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                appendStreamLog(logStream, chunk);
                buffer += chunk;

                const splitResult = sseEvent.splitEvents(buffer);
                const events = splitResult.events;
                buffer = splitResult.remainingBuffer;

                let clientDisconnected = false;
                for (const event of events) {
                    if (!event.trim()) continue;

                    const parsedEvent = sseEvent.parseEvent(event);
                    if (!parsedEvent) continue;

                    // Responses API embeds event type in the JSON `type` field (no SSE `event:` line)
                    let parsedData: any = null;
                    try {
                        parsedData = JSON.parse(parsedEvent.data);
                    } catch (e) {
                        // ignore unparseable lines
                    }

                    const eventType = parsedEvent.event ?? "";
                    const responseEventType = parsedData?.type ?? eventType;

                    // 如果需要协议转换，将上游事件转换为 Responses 事件
                    let clientEvents: ProtocolStreamEvent[];
                    if (needsConversion && converter) {
                        clientEvents = converter.convertStreamEvent(parsedEvent.data, parsedEvent.event, parsedEvent.id);
                    } else {
                        clientEvents = [parsedEvent];
                    }

                    for (const clientEvent of clientEvents) {
                        if (!clientEvent.data) continue;

                        let clientParsedData: any = null;
                        try {
                            clientParsedData = JSON.parse(clientEvent.data);
                        } catch {}
                        const clientEventType = clientParsedData?.type ?? "";

                        if (firstTokenTime === null && isResponsesOutputStartedEvent(clientEventType)) {
                            firstTokenTime = Date.now();
                        }

                        // response.completed 表示上游已完成，在转发前标记
                        if (clientEventType === "response.completed" && clientParsedData) {
                            streamCompleted = true;
                        }

                        try {
                            await stream.writeSSE({
                                data: clientEvent.data,
                                event: clientEvent.event,
                                id: clientEvent.id,
                            });
                        } catch (e: any) {
                            console.error("[senderService] Client write error (client disconnected, responses):", e);
                            failedCode = FailedCode.CLIENT_DISCONNECTED;
                            clientDisconnected = true;
                            break;
                        }

                        // response.completed 包含完整 usage，保存记录
                        if (clientEventType === "response.completed" && clientParsedData) {
                            try {
                                const usage = clientParsedData?.response?.usage;
                                const normalizedUsage = normalizeUsage(ApiFormat.RESPONSES, usage);
                                const cost = normalizedUsage
                                    ? calculateCost(model, normalizedUsage.promptTokens, normalizedUsage.outputTokens, normalizedUsage.cacheReadTokens)
                                    : 0;
                                const usageJson = normalizedUsage ? JSON.stringify(normalizedUsage.recordUsage) : null;

                                await recordService.update(record.id, {
                                    response_data: JSON.stringify(clientParsedData.response),
                                    status: SgRecordStatus.SUCCESS,
                                    usage: usageJson,
                                    first_token_latency: firstTokenTime !== null
                                        ? firstTokenTime - record.created_at.getTime()
                                        : null,
                                    end_at: new Date(),
                                    cost,
                                });

                                if (user.type !== "root") {
                                    await userService.deductBalance(user.id, cost);
                                }
                            } catch (e) {
                                console.log("Failed to update record on response.completed:", e);
                            }
                        }
                    }
                }

                if (clientDisconnected) break;
            }
        } catch (e: any) {
            console.error("[senderService] Unexpected stream error (responses):", e);
            if (!failedCode) {
                failedCode = FailedCode.UPSTREAM_DISCONNECTED;
            }
        }

        c.req.raw.signal.removeEventListener("abort", abortHandler);

        if (!streamCompleted) {
            runInBackground(c, async () => {
                await recordService.update(record.id, {
                    status: SgRecordStatus.FAILED,
                    failed_code: failedCode ?? FailedCode.STREAM_INCOMPLETE,
                    end_at: new Date(),
                });
            });
        }

        logStream?.end();
    });
}


async function handleResponsesNonStreamResponse(
    c: Context,
    upstreamRes: Response,
    record: SgRecord,
    model: SgModel,
    user: SgUser,
    converter: BaseConverter | null = null,
    upstreamFormat: ApiFormat = ApiFormat.RESPONSES,
): Promise<Response> {
    const responseText = await upstreamRes.text();
    const statusCode = upstreamRes.status as StatusCode;
    const needsConversion = converter !== null;

    if (!upstreamRes.ok) {
        console.error("[senderService] Upstream responses non-stream error response:", {
            recordId: record.id,
            status: statusCode,
            contentType: upstreamRes.headers.get("content-type"),
            body: responseText,
        });

        await recordService.update(record.id, {
            response_data: responseText,
            status: SgRecordStatus.FAILED,
            usage: null,
            end_at: new Date(),
            cost: 0,
        });

        c.status(statusCode);
        c.res.headers.set("Content-Type", upstreamRes.headers.get("content-type") || "application/json");
        return c.body(responseText);
    }

    let clientResponseText = responseText;
    if (needsConversion && converter) {
        try {
            const responseJson = JSON.parse(responseText);
            const clientRes = converter.convertResponse(responseJson);
            clientResponseText = JSON.stringify(clientRes);
        } catch (e) {
            console.error("[senderService] Failed to convert responses non-stream response:", e);
            throw new customError.AppError(
                `Failed to convert upstream response format: ${e instanceof Error ? e.message : String(e)}`,
                502,
            );
        }
    }

    let normalizedUsage: ReturnType<typeof normalizeUsage> | null = null;
    try {
        const responseJson = JSON.parse(responseText);
        normalizedUsage = normalizeUsage(upstreamFormat, responseJson.usage);
    } catch (e) {
        console.log("Failed to parse responses API response:", e);
    }

    const usageJson = normalizedUsage ? JSON.stringify(normalizedUsage.recordUsage) : null;
    const cost = normalizedUsage
        ? calculateCost(model, normalizedUsage.promptTokens, normalizedUsage.outputTokens, normalizedUsage.cacheReadTokens)
        : 0;

    await recordService.update(record.id, {
        response_data: clientResponseText,
        status: statusCode === 200 ? SgRecordStatus.SUCCESS : SgRecordStatus.FAILED,
        usage: usageJson,
        end_at: new Date(),
        cost,
    });

    if (user.type !== "root" && statusCode === 200) {
        await userService.deductBalance(user.id, cost);
    }

    c.status(statusCode);
    c.res.headers.set("Content-Type", "application/json");
    return c.text(clientResponseText);
}


async function sendRequest(
    c: Context,
    user: SgUser,
    modelConfig: SgModel,
    format: ApiFormat,
    body: string,
): Promise<Response> {
    const selectedRoute = await resolveProviderRoute(modelConfig, format);
    const vendor = selectedRoute.vendor;
    const vendorModelName = selectedRoute.vendorModelName;
    const upstreamFormat = selectedRoute.upstreamFormat;
    const needsConversion = format !== upstreamFormat;
    const url = selectedRoute.url;

    console.log("sendRequest: modelConfig={}, vendor={}, format={}, upstreamFormat={}", modelConfig, vendor.id, format, upstreamFormat);

    // Check user balance (only for non-root users)
    if (user.type !== "root") {
        // Estimate max possible cost based on model pricing
        // We'll allow the request and deduct actual cost after completion
        console.log(`[senderService] Checking balance for user ${user.id}: ${user.balance}`);
    }

    // 1. 创建数据库记录
    const record = await recordService.create(
        user.id,
        modelConfig.id,
        body,
        format,
        upstreamFormat,
        vendor.id,
        vendorModelName
    );
    // 2. 构建上游请求 headers，过滤掉 Cloudflare 注入的 cf- 前缀 header
    // 并且必须排除客户端自带的鉴权 header，避免泄露或导致合并错误
    // 同时排除浏览器相关的元数据 header，避免上游校验失败
    const finalHeaders = buildUpstreamHeaders(c.req.raw.headers, vendor, upstreamFormat);
    await recordService.update(record.id, {
        status: SgRecordStatus.PROCESSING,
        start_at: new Date(),
        request_headers: JSON.stringify(serializeHeaders(finalHeaders)),
    });

    // 3. 替换上游模型名：若路由配置了 vendor_model_id，用对应的 vendor_model.model_id 替换请求体中的 model 字段
    let upstreamBody = body;
    if (selectedRoute.vendorModel) {
        try {
            const bodyJson = JSON.parse(upstreamBody);
            bodyJson.model = selectedRoute.vendorModel.model_id;
            upstreamBody = JSON.stringify(bodyJson);
        } catch (e) {
            console.log("[senderService] Failed to substitute model name:", e);
        }
    }

    // 4. 应用插件 (转换前)
    const hostKey = await hostService.getHostKey();
    upstreamBody = await pluginService.applyRequestPlugins(upstreamBody, format, hostKey, user.name);

    let converter: BaseConverter | null = null;
    if (needsConversion) {
        converter = ConverterFactory.createPair(format, upstreamFormat);
        if (!converter) {
            throw new customError.AppError(
                `Unsupported protocol conversion: ${format} → ${upstreamFormat}`,
                400,
            );
        }
        console.log(`[senderService] Using protocol converter: ${converter.constructor.name}, client=${format}, upstream=${upstreamFormat}`);
        upstreamBody = converter.convertRequestBody(upstreamBody);
    }

    let requestModel = "unknown";
    try {
        const parsedBody = JSON.parse(upstreamBody);
        requestModel = parsedBody.model || "unknown";
    } catch (e) {}
    converter?.updateModel(requestModel);

    // 4. OpenAI 流式请求注入 stream_options，让上游在最后一帧返回 usage
    if (upstreamFormat === ApiFormat.OPENAI) {
        try {
            const bodyJson = JSON.parse(upstreamBody);
            if (bodyJson.stream === true) {
                bodyJson.stream_options = { include_usage: true };
                upstreamBody = JSON.stringify(bodyJson);
            }
        } catch (e) {
            console.log("Failed to inject stream_options:", e);
        }
    }

    // 6. 应用插件 (转换后)
    if (needsConversion) {
        upstreamBody = await pluginService.applyRequestPlugins(upstreamBody, upstreamFormat, hostKey, user.name);
    }

    await writeRequestLog(record, upstreamBody);

    // 4. 发起上游请求，拿到响应头后立即判断响应类型
    let upstreamRes: Response;
    try {
        upstreamRes = await fetchWithProxy(url, { method: "POST", headers: finalHeaders, body: upstreamBody, signal: c.req.raw.signal }, vendor);
    } catch (e: any) {
        console.error("Upstream fetch failed:", e);
        await recordService.update(record.id, {
            status: SgRecordStatus.FAILED,
            response_data: String(e),
            end_at: new Date(),
        });
        throw e;
    }
    console.log("upstream response status:", upstreamRes.status);

    const isStream =
        upstreamRes.ok &&
        upstreamRes.headers.get("content-type")?.startsWith("text/event-stream");

    // 4. 按响应类型分发处理
    if (format === ApiFormat.RESPONSES) {
        if (isStream) {
            return handleResponsesStreamResponse(c, upstreamRes, record, modelConfig, user, converter, upstreamFormat);
        } else {
            return handleResponsesNonStreamResponse(c, upstreamRes, record, modelConfig, user, converter, upstreamFormat);
        }
    }

    if (isStream) {
        return handleStreamResponse(c, upstreamRes, record, modelConfig, user, format, upstreamFormat, converter);
    } else {
        return handleNonStreamResponse(c, upstreamRes, record, modelConfig, user, format, upstreamFormat, converter);
    }
}


export default {
    buildStreamUsageAccounting,
    buildUpstreamHeaders,
    isResponsesOutputStartedEvent,
    normalizeUsage,
    resolveUpstreamFormat,
    resolveProxyUrl,
    serializeHeaders,
    fetchWithProxy,
    sendRequest,
};
