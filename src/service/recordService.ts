import { SgRecord } from "../model/sgRecord";
import { SgRecordStatus } from "../constants";
import configService, { ConfigKey } from "./configService";
import ormService from "./ormService";
import { getLogDir } from "../util/logger";

function isLogEnabled(): boolean {
    return process.env.RECORD_LOG_ENABLED === "true";
}

async function isRequestRecordEnabled(): Promise<boolean> {
    return (await configService.getConfig(ConfigKey.REQUEST_RECORD_ENABLED, "true")).getBoolean();
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
    if (!(await isRequestRecordEnabled())) {
        if (isLogEnabled()) {
            console.log(`[RecordService] Request record disabled: user=${userId}, model=${modelId}`);
        }
        return createDisabledRecord(userId, modelId, requestData, clientFormat, upstreamFormat, vendorId, vendorModelName);
    }

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
        request_data: requestData,
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

    return SgRecord.query().where("id", recordId).update(data);
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
    isRequestRecordEnabled,
};
