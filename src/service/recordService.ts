import { SgRecord } from "../model/sgRecord";
import { SgRecordStatus } from "../constants";
import configService, { ConfigKey } from "./configService";
import ormService from "./ormService";
import { getLogDir } from "../util/logger";

const DEFAULT_REDACTION_KEYS = [
    "authorization",
    "x-api-key",
    "api_key",
    "apikey",
    "access_token",
    "refresh_token",
    "token",
    "password",
    "secret",
    "cookie",
    "set-cookie",
];

const REDACTED_VALUE = "[REDACTED]";
const AUTO_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

interface RecordPolicy {
    enabled: boolean;
    requestBodyEnabled: boolean;
    responseBodyEnabled: boolean;
    headersEnabled: boolean;
    redactionEnabled: boolean;
    redactionKeys: string[];
    retentionDays: number;
    maxCount: number;
    autoCleanupEnabled: boolean;
}

interface CleanupResult {
    deleted: number;
    stream_logs_deleted: boolean;
    retention_days: number;
    max_count: number;
    last_cleanup_at: string;
}

function isLogEnabled(): boolean {
    return process.env.RECORD_LOG_ENABLED === "true";
}

async function isRequestRecordEnabled(): Promise<boolean> {
    return (await configService.getConfig(ConfigKey.REQUEST_RECORD_ENABLED, "true")).getBoolean();
}


function normalizeCsv(value: string): string[] {
    return value
        .split(",")
        .map(item => item.trim().toLowerCase())
        .filter(Boolean);
}


function normalizePositiveInt(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.floor(value));
}


async function getPolicy(): Promise<RecordPolicy> {
    const redactionKeys = normalizeCsv(
        (await configService.getConfig(
            ConfigKey.REQUEST_RECORD_REDACTION_KEYS,
            DEFAULT_REDACTION_KEYS.join(","),
        )).getString(),
    );

    return {
        enabled: (await configService.getConfig(ConfigKey.REQUEST_RECORD_ENABLED, "true")).getBoolean(),
        requestBodyEnabled: (await configService.getConfig(ConfigKey.REQUEST_RECORD_REQUEST_BODY_ENABLED, "true")).getBoolean(),
        responseBodyEnabled: (await configService.getConfig(ConfigKey.REQUEST_RECORD_RESPONSE_BODY_ENABLED, "true")).getBoolean(),
        headersEnabled: (await configService.getConfig(ConfigKey.REQUEST_RECORD_HEADERS_ENABLED, "true")).getBoolean(),
        redactionEnabled: (await configService.getConfig(ConfigKey.REQUEST_RECORD_REDACTION_ENABLED, "true")).getBoolean(),
        redactionKeys: redactionKeys.length > 0 ? redactionKeys : DEFAULT_REDACTION_KEYS,
        retentionDays: normalizePositiveInt(
            (await configService.getConfig(ConfigKey.REQUEST_RECORD_RETENTION_DAYS, "0")).getNumber(),
        ),
        maxCount: normalizePositiveInt(
            (await configService.getConfig(ConfigKey.REQUEST_RECORD_MAX_COUNT, "0")).getNumber(),
        ),
        autoCleanupEnabled: (await configService.getConfig(ConfigKey.REQUEST_RECORD_AUTO_CLEANUP_ENABLED, "false")).getBoolean(),
    };
}


function shouldRedactKey(key: string, policy: RecordPolicy): boolean {
    const lowerKey = key.toLowerCase();
    return policy.redactionKeys.some(redactionKey => {
        return lowerKey === redactionKey || (redactionKey.length >= 6 && lowerKey.includes(redactionKey));
    });
}


function redactJsonValue(value: unknown, policy: RecordPolicy, key: string | null = null): unknown {
    if (!policy.redactionEnabled) {
        return value;
    }

    if (key && shouldRedactKey(key, policy)) {
        return REDACTED_VALUE;
    }

    if (Array.isArray(value)) {
        return value.map(item => redactJsonValue(item, policy));
    }

    if (value && typeof value === "object") {
        const result: Record<string, unknown> = {};
        for (const [childKey, childValue] of Object.entries(value)) {
            result[childKey] = redactJsonValue(childValue, policy, childKey);
        }
        return result;
    }

    return value;
}


function maybeRedactJsonText(value: string | null | undefined, policy: RecordPolicy): string | null {
    if (value === undefined || value === null) {
        return null;
    }

    if (!policy.redactionEnabled) {
        return value;
    }

    try {
        return JSON.stringify(redactJsonValue(JSON.parse(value), policy));
    } catch {
        return value;
    }
}


function sanitizeCreateRequestData(requestData: string | null, policy: RecordPolicy): string | null {
    if (!policy.requestBodyEnabled) {
        return null;
    }

    return maybeRedactJsonText(requestData, policy);
}


function sanitizeUpdateData(data: Partial<SgRecord>, policy: RecordPolicy): Partial<SgRecord> {
    const sanitized: Partial<SgRecord> = { ...data };

    if ("request_data" in sanitized) {
        sanitized.request_data = policy.requestBodyEnabled
            ? maybeRedactJsonText(sanitized.request_data, policy)
            : null;
    }

    if ("response_data" in sanitized) {
        sanitized.response_data = policy.responseBodyEnabled
            ? maybeRedactJsonText(sanitized.response_data, policy)
            : null;
    }

    if ("request_headers" in sanitized) {
        sanitized.request_headers = policy.headersEnabled
            ? maybeRedactJsonText(sanitized.request_headers, policy)
            : null;
    }

    return sanitized;
}


function formatSqlTimestamp(date: Date): string {
    return date.toISOString().slice(0, 19).replace("T", " ");
}


function hasCleanupPolicy(policy: RecordPolicy): boolean {
    return policy.retentionDays > 0 || policy.maxCount > 0;
}


async function deleteStreamLogsByIds(recordIds: number[]): Promise<boolean> {
    if (!ormService.isNode || recordIds.length === 0) {
        return false;
    }

    try {
        const { rm } = await import("fs/promises");
        const { join } = await import("path");
        const logDir = join(getLogDir(), "stream");

        await Promise.all(recordIds.flatMap(recordId => [
            rm(join(logDir, `${recordId}.log`), { force: true }),
            rm(join(logDir, `${recordId}.after_convert_req.log`), { force: true }),
        ]));
        return true;
    } catch (e) {
        console.warn("[RecordService] Failed to delete selected stream logs:", e);
        return false;
    }
}


async function collectCleanupRecordIds(policy: RecordPolicy): Promise<number[]> {
    const knex = ormService.getKnex();
    const idSet = new Set<number>();

    if (policy.retentionDays > 0) {
        const cutoff = new Date(Date.now() - policy.retentionDays * 24 * 60 * 60 * 1000);
        const rows = await knex("record")
            .select("id")
            .where("created_at", "<", formatSqlTimestamp(cutoff));
        for (const row of rows) {
            idSet.add(Number(row.id));
        }
    }

    if (policy.maxCount > 0) {
        const total = Number(await SgRecord.query().count() || 0);
        const overflow = total - policy.maxCount;
        if (overflow > 0) {
            const rows = await knex("record")
                .select("id")
                .orderBy("id", "asc")
                .limit(overflow);
            for (const row of rows) {
                idSet.add(Number(row.id));
            }
        }
    }

    return [...idSet].filter(id => Number.isFinite(id) && id > 0);
}


async function deleteRecordsByIds(recordIds: number[]): Promise<number> {
    if (recordIds.length === 0) {
        return 0;
    }

    const knex = ormService.getKnex();
    let deleted = 0;

    for (let i = 0; i < recordIds.length; i += 200) {
        const chunk = recordIds.slice(i, i + 200);
        deleted += Number(await knex("record").whereIn("id", chunk).delete() || 0);
    }

    return deleted;
}


async function cleanupByPolicy(policy?: RecordPolicy): Promise<CleanupResult> {
    policy = policy ?? await getPolicy();
    const now = new Date();
    const lastCleanupAt = now.toISOString();

    if (!hasCleanupPolicy(policy)) {
        await configService.setValue(ConfigKey.REQUEST_RECORD_LAST_CLEANUP_AT, lastCleanupAt);
        return {
            deleted: 0,
            stream_logs_deleted: false,
            retention_days: policy.retentionDays,
            max_count: policy.maxCount,
            last_cleanup_at: lastCleanupAt,
        };
    }

    const recordIds = await collectCleanupRecordIds(policy);
    const deleted = await deleteRecordsByIds(recordIds);
    const streamLogsDeleted = await deleteStreamLogsByIds(recordIds);

    await configService.setValue(ConfigKey.REQUEST_RECORD_LAST_CLEANUP_AT, lastCleanupAt);
    return {
        deleted,
        stream_logs_deleted: streamLogsDeleted,
        retention_days: policy.retentionDays,
        max_count: policy.maxCount,
        last_cleanup_at: lastCleanupAt,
    };
}


async function maybeAutoCleanup(policy: RecordPolicy): Promise<void> {
    if (!policy.autoCleanupEnabled || !hasCleanupPolicy(policy)) {
        return;
    }

    const lastCleanup = (await configService.getConfig(ConfigKey.REQUEST_RECORD_LAST_CLEANUP_AT, "")).getString();
    const lastCleanupTime = lastCleanup ? new Date(lastCleanup).getTime() : 0;
    if (Number.isFinite(lastCleanupTime) && lastCleanupTime > 0 && Date.now() - lastCleanupTime < AUTO_CLEANUP_INTERVAL_MS) {
        return;
    }

    try {
        await cleanupByPolicy(policy);
    } catch (e) {
        console.warn("[RecordService] Auto cleanup failed:", e);
    }
}

function createDisabledRecord(
    userId: number,
    modelId: number,
    requestData: string | null,
    clientFormat: string | null,
    upstreamFormat: string | null,
    vendorId: number | null,
    vendorModelName: string | null,
): SgRecord {
    const now = new Date();
    const record = new SgRecord();
    record.id = 0;
    record.user_id = userId;
    record.model_id = modelId;
    record.vendor_id = vendorId;
    record.vendor_model_name = vendorModelName;
    record.request_data = requestData;
    record.response_data = null;
    record.request_headers = null;
    record.status = SgRecordStatus.INIT;
    record.client_format = clientFormat;
    record.upstream_format = upstreamFormat !== clientFormat ? upstreamFormat : null;
    record.failed_code = null;
    record.usage = null;
    record.first_token_latency = null;
    record.start_at = null;
    record.end_at = null;
    record.cost = 0;
    record.created_at = now;
    record.updated_at = now;
    return record;
}

async function create(
    userId: number,
    modelId: number,
    requestData: string | null,
    clientFormat: string | null = null,
    upstreamFormat: string | null = null,
    vendorId: number | null = null,
    vendorModelName: string | null = null,
) {
    const policy = await getPolicy();

    if (!policy.enabled) {
        if (isLogEnabled()) {
            console.log(`[RecordService] Request record disabled: user=${userId}, model=${modelId}`);
        }
        return createDisabledRecord(userId, modelId, requestData, clientFormat, upstreamFormat, vendorId, vendorModelName);
    }

    await maybeAutoCleanup(policy);

    if (isLogEnabled()) {
        console.log(`[RecordService] Creating record: user=${userId}, model=${modelId}`);
        if (requestData) {
            console.log(`[RecordService] Request data: ${requestData}`);
        }
    }

    return SgRecord.query().create({
        user_id: userId,
        model_id: modelId,
        vendor_id: vendorId,
        vendor_model_name: vendorModelName,
        request_data: sanitizeCreateRequestData(requestData, policy),
        response_data: null,
        status: SgRecordStatus.INIT,
        client_format: clientFormat,
        upstream_format: upstreamFormat !== clientFormat ? upstreamFormat : null,
        first_token_latency: null,
        start_at: null,
        end_at: null,
        cost: 0,
    });
}

async function update(recordId: number, data: Partial<SgRecord>) {
    if (recordId <= 0) {
        return 0;
    }

    if (isLogEnabled()) {
        console.log(`[RecordService] Updating record ${recordId}:`, JSON.stringify(data, null, 2));
    }

    return SgRecord.query().where("id", recordId).update(sanitizeUpdateData(data, await getPolicy()));
}

async function latest(limit: number = 10) {
    return SgRecord.query().orderBy("id", "desc").limit(limit).get();
}

async function clearStreamLogs(): Promise<boolean> {
    if (!ormService.isNode) {
        return false;
    }

    try {
        const { rm } = await import("fs/promises");
        const { join } = await import("path");
        await rm(join(getLogDir(), "stream"), { recursive: true, force: true });
        return true;
    } catch (e) {
        console.warn("[RecordService] Failed to clear stream logs:", e);
        return false;
    }
}

async function clearAll() {
    const knex = ormService.getKnex();
    const deleted = Number(await SgRecord.query().count() || 0);
    await knex("record").delete();

    return {
        deleted,
        stream_logs_cleared: await clearStreamLogs(),
    };
}

export default {
    create,
    update,
    latest,
    clearAll,
    cleanupByPolicy,
    getPolicy,
    isRequestRecordEnabled,
};
