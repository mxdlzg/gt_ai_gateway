import customError from "../util/customError";
import { ApiFormat } from "../constants";
import { SgVendor } from "../model/sgVendor";
import { SgVendorModel } from "../model/sgVendorModel";
import SgVendorWakeupJob from "../model/sgVendorWakeupJob";
import SgVendorWakeupLog from "../model/sgVendorWakeupLog";
import configService, { ConfigKey } from "./configService";
import ormService from "./ormService";
import senderService from "./senderService";
import wakeupPromptService, { WakeupPromptCategory } from "./wakeupPromptService";
import desktopNotificationService from "./desktopNotificationService";
import { createListResponse, parsePaginationQuery } from "../util/pagination";

type WakeupMode = "warmup" | "keepalive";
type WakeupStatus = "idle" | "success" | "failed" | "rate_limited" | "skipped" | "keeping_alive";
type WakeupScheduleMode = "window" | "always";
type AfterSuccessAction = "none" | "duration" | "job";

interface WakeupJobInput {
    name?: string;
    vendor_id?: number | string;
    vendor_model_id?: number | string | null;
    model_name?: string;
    format?: string;
    auto_convert?: boolean | number;
    mode?: string;
    enabled?: boolean | number;
    schedule_mode?: string;
    start_time?: string;
    end_time?: string;
    interval_min_seconds?: number | string;
    interval_max_seconds?: number | string;
    max_attempts?: number | string;
    daily_limit?: number | string;
    cooldown_after_429_seconds?: number | string;
    after_success_action?: string;
    after_success_keepalive_minutes?: number | string;
    after_success_keepalive_interval_min_seconds?: number | string;
    after_success_keepalive_interval_max_seconds?: number | string;
    after_success_keepalive_job_id?: number | string | null;
    prompt_category?: string;
    custom_prompts?: string[] | string | null;
    system_prompt?: string | null;
    max_tokens?: number | string;
    temperature?: number | string;
}

interface WakeupJobListQuery {
    page?: string;
    pageSize?: string;
    vendor_id?: string;
    enabled?: string;
    mode?: string;
    keyword?: string;
}

interface WakeupLogListQuery {
    page?: string;
    pageSize?: string;
    job_id?: string;
    success?: string;
}

interface WindowState {
    inWindow: boolean;
    start: Date;
    end: Date;
    nextStart: Date;
}

interface ResolvedWakeupRoute {
    vendor: SgVendor;
    vendorModel: SgVendorModel | null;
    modelName: string;
    requestFormat: ApiFormat;
    upstreamFormat: ApiFormat;
    url: string;
}

interface ExecutionResult {
    success: boolean;
    status?: number;
    duration: number;
    prompt: string;
    promptCategory: WakeupPromptCategory;
    responsePreview?: string;
    error?: string;
    errorDetail?: unknown;
    nextPrompt?: string | null;
}

const SCHEDULER_TICK_MS = 15 * 1000;
const MIN_INTERVAL_SECONDS = 120;
const MIN_429_COOLDOWN_SECONDS = 300;
const DEFAULT_TEST_TIMEOUT_MS = 120000;
const MAX_LOGS_PER_JOB = 2000;

let schedulerTimer: ReturnType<typeof setInterval> | null = null;
let schedulerTickRunning = false;
const runningJobIds = new Set<number>();


function pad(value: number): string {
    return String(value).padStart(2, "0");
}


function formatSqlTimestamp(date: Date): string {
    return [
        date.getFullYear(),
        pad(date.getMonth() + 1),
        pad(date.getDate()),
    ].join("-") + " " + [
        pad(date.getHours()),
        pad(date.getMinutes()),
        pad(date.getSeconds()),
    ].join(":");
}


function todayKey(date: Date = new Date()): string {
    return [
        date.getFullYear(),
        pad(date.getMonth() + 1),
        pad(date.getDate()),
    ].join("-");
}


function addSeconds(date: Date, seconds: number): Date {
    return new Date(date.getTime() + seconds * 1000);
}


function addDays(date: Date, days: number): Date {
    return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}


function getNextDailyStart(now: Date): Date {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
}


function toDate(value: unknown): Date | null {
    if (!value) {
        return null;
    }

    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value;
    }

    const date = new Date(String(value));
    return Number.isNaN(date.getTime()) ? null : date;
}


function toBoolean(value: unknown, defaultValue = false): boolean {
    if (value === undefined || value === null || value === "") {
        return defaultValue;
    }

    if (typeof value === "boolean") {
        return value;
    }

    if (typeof value === "string") {
        return value !== "false" && value !== "0";
    }

    return Number(value) === 1;
}


function toInteger(value: unknown, defaultValue: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return defaultValue;
    }

    return Math.floor(parsed);
}


function toNullableInteger(value: unknown): number | null {
    if (value === undefined || value === null || value === "") {
        return null;
    }

    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return null;
    }

    return Math.floor(parsed);
}


function clampInteger(value: unknown, defaultValue: number, min: number, max: number): number {
    const parsed = toInteger(value, defaultValue);
    return Math.min(max, Math.max(min, parsed));
}


function clampNumber(value: unknown, defaultValue: number, min: number, max: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return defaultValue;
    }

    return Math.min(max, Math.max(min, parsed));
}


function normalizeTime(value: unknown, fallback: string): string {
    if (typeof value !== "string") {
        return fallback;
    }

    const trimmed = value.trim();
    const match = trimmed.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) {
        return fallback;
    }

    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
        return fallback;
    }

    return `${pad(hour)}:${pad(minute)}`;
}


function parseTimeMinutes(value: string): number {
    const [hour, minute] = value.split(":").map(Number);
    return hour * 60 + minute;
}


function localDateAt(base: Date, minutes: number): Date {
    return new Date(base.getFullYear(), base.getMonth(), base.getDate(), Math.floor(minutes / 60), minutes % 60, 0, 0);
}


function getWindowState(job: Pick<SgVendorWakeupJob, "start_time" | "end_time">, now: Date = new Date()): WindowState {
    const startMinutes = parseTimeMinutes(job.start_time || "08:30");
    const endMinutes = parseTimeMinutes(job.end_time || "18:30");
    const startToday = localDateAt(now, startMinutes);
    let endToday = localDateAt(now, endMinutes);

    if (endMinutes <= startMinutes) {
        endToday = addDays(endToday, 1);
        const startYesterday = addDays(startToday, -1);
        const endFromYesterday = localDateAt(now, endMinutes);

        if (now < startToday && now <= endFromYesterday) {
            return {
                inWindow: true,
                start: startYesterday,
                end: endFromYesterday,
                nextStart: startToday,
            };
        }
    }

    if (now < startToday) {
        return {
            inWindow: false,
            start: startToday,
            end: endToday,
            nextStart: startToday,
        };
    }

    if (now <= endToday) {
        return {
            inWindow: true,
            start: startToday,
            end: endToday,
            nextStart: addDays(startToday, 1),
        };
    }

    const tomorrow = addDays(now, 1);
    const nextStart = localDateAt(tomorrow, startMinutes);
    let nextEnd = localDateAt(tomorrow, endMinutes);
    if (endMinutes <= startMinutes) {
        nextEnd = addDays(nextEnd, 1);
    }

    return {
        inWindow: false,
        start: nextStart,
        end: nextEnd,
        nextStart,
    };
}


function getNextWindowStartAfter(job: Pick<SgVendorWakeupJob, "start_time" | "end_time">, date: Date): Date {
    const afterCurrentWindow = addSeconds(getWindowState(job, date).end, 1);
    return getWindowState(job, afterCurrentWindow).nextStart;
}


function isAlwaysSchedule(job: Pick<SgVendorWakeupJob, "mode" | "schedule_mode">): boolean {
    return job.mode === "keepalive" && job.schedule_mode === "always";
}


function getNextScheduleStartAfter(job: Pick<SgVendorWakeupJob, "mode" | "schedule_mode" | "start_time" | "end_time">, date: Date): Date {
    if (isAlwaysSchedule(job)) {
        return getNextDailyStart(date);
    }

    return getNextWindowStartAfter(job, date);
}


function getInitialNextRunAt(job: Pick<SgVendorWakeupJob, "mode" | "schedule_mode" | "start_time" | "end_time">, now: Date = new Date()): Date {
    if (isAlwaysSchedule(job)) {
        return now;
    }

    const windowState = getWindowState(job, now);
    return windowState.inWindow ? now : windowState.nextStart;
}


function randomIntervalSeconds(job: Pick<SgVendorWakeupJob, "interval_min_seconds" | "interval_max_seconds">): number {
    const min = Math.max(MIN_INTERVAL_SECONDS, Number(job.interval_min_seconds || 240));
    const max = Math.max(min, Number(job.interval_max_seconds || min));
    return min + Math.floor(Math.random() * (max - min + 1));
}


function randomAfterSuccessKeepaliveIntervalSeconds(
    job: Pick<SgVendorWakeupJob, "after_success_keepalive_interval_min_seconds" | "after_success_keepalive_interval_max_seconds">,
): number {
    const min = Math.max(MIN_INTERVAL_SECONDS, Number(job.after_success_keepalive_interval_min_seconds || 240));
    const max = Math.max(min, Number(job.after_success_keepalive_interval_max_seconds || min));
    return min + Math.floor(Math.random() * (max - min + 1));
}


function randomCooldownSeconds(job: Pick<SgVendorWakeupJob, "cooldown_after_429_seconds">): number {
    const base = Math.max(MIN_429_COOLDOWN_SECONDS, Number(job.cooldown_after_429_seconds || 900));
    const jitter = Math.floor(base * 0.3 * Math.random());
    return base + jitter;
}


function normalizeMode(value: unknown, fallback: WakeupMode = "keepalive"): WakeupMode {
    return value === "warmup" || value === "keepalive" ? value : fallback;
}


function normalizeScheduleMode(value: unknown, mode: WakeupMode): WakeupScheduleMode {
    if (mode === "keepalive" && value === "always") {
        return "always";
    }

    return "window";
}


function normalizeAfterSuccessAction(value: unknown, minutes: number): AfterSuccessAction {
    if (value === "duration" || value === "job" || value === "none") {
        return value;
    }

    return minutes > 0 ? "duration" : "none";
}


function normalizeFormat(value: unknown, fallback: ApiFormat = ApiFormat.OPENAI): ApiFormat {
    if (value === ApiFormat.ANTHROPIC || value === ApiFormat.RESPONSES || value === ApiFormat.OPENAI) {
        return value;
    }

    return fallback;
}


function normalizeCustomPrompts(value: unknown, existing: string | null = null): string | null {
    if (value === undefined) {
        return existing;
    }

    const rawItems = Array.isArray(value)
        ? value
        : typeof value === "string"
            ? value.split(/\r?\n/)
            : [];
    const prompts = rawItems
        .map(item => String(item).trim())
        .filter(Boolean)
        .slice(0, 100)
        .map(item => item.slice(0, 2000));

    return prompts.length > 0 ? JSON.stringify(prompts) : null;
}


function getExistingValue<T extends keyof SgVendorWakeupJob>(
    existing: SgVendorWakeupJob | null,
    key: T,
    fallback: SgVendorWakeupJob[T],
): SgVendorWakeupJob[T] {
    return existing ? existing[key] : fallback;
}


async function normalizeJobInput(input: WakeupJobInput, existing: SgVendorWakeupJob | null = null): Promise<Partial<SgVendorWakeupJob>> {
    const vendorId = toInteger(input.vendor_id ?? getExistingValue(existing, "vendor_id", 0), 0);
    if (vendorId <= 0) {
        throw new customError.AppError("vendor_id is required", 400);
    }

    const vendor = await SgVendor.query().find(vendorId);
    if (!vendor) {
        throw new customError.AppError("Vendor not found", 404);
    }

    const vendorModelId = toNullableInteger(input.vendor_model_id ?? getExistingValue(existing, "vendor_model_id", null));
    let vendorModel: SgVendorModel | null = null;
    if (vendorModelId) {
        vendorModel = await SgVendorModel.query()
            .where("id", vendorModelId)
            .where("vendor_id", vendorId)
            .first();
        if (!vendorModel) {
            throw new customError.AppError("Vendor model not found", 404);
        }
    }

    const existingName = getExistingValue(existing, "name", "");
    const name = typeof input.name === "string" ? input.name.trim() : String(existingName || "").trim();
    if (!name) {
        throw new customError.AppError("name is required", 400);
    }

    const modelNameInput = typeof input.model_name === "string"
        ? input.model_name.trim()
        : String(getExistingValue(existing, "model_name", "") || "").trim();
    const modelName = modelNameInput || vendorModel?.model_id || "";
    if (!modelName) {
        throw new customError.AppError("model_name is required", 400);
    }

    const existingIntervalMin = Number(getExistingValue(existing, "interval_min_seconds", 240));
    const existingIntervalMax = Number(getExistingValue(existing, "interval_max_seconds", 420));
    const intervalMin = clampInteger(input.interval_min_seconds ?? existingIntervalMin, 240, MIN_INTERVAL_SECONDS, 86400);
    const intervalMax = clampInteger(input.interval_max_seconds ?? existingIntervalMax, Math.max(intervalMin, existingIntervalMax), intervalMin, 86400);
    const enabled = toBoolean(input.enabled ?? getExistingValue(existing, "enabled", 1), true);
    const mode = normalizeMode(input.mode ?? getExistingValue(existing, "mode", "keepalive"));
    const scheduleMode = normalizeScheduleMode(input.schedule_mode ?? getExistingValue(existing, "schedule_mode", "window"), mode);
    const startTime = normalizeTime(input.start_time ?? getExistingValue(existing, "start_time", "08:30"), "08:30");
    const endTime = normalizeTime(input.end_time ?? getExistingValue(existing, "end_time", mode === "warmup" ? "09:30" : "18:30"), mode === "warmup" ? "09:30" : "18:30");
    const afterSuccessMinutes = clampInteger(
        input.after_success_keepalive_minutes ?? getExistingValue(existing, "after_success_keepalive_minutes", 0),
        0,
        0,
        1440,
    );
    const rawAfterSuccessAction = input.after_success_action !== undefined
        ? input.after_success_action
        : input.after_success_keepalive_minutes !== undefined
            ? undefined
            : getExistingValue(existing, "after_success_action", undefined as any);
    const afterSuccessAction = mode === "warmup"
        ? normalizeAfterSuccessAction(rawAfterSuccessAction, afterSuccessMinutes)
        : "none";
    const existingAfterSuccessIntervalMin = Number(getExistingValue(existing, "after_success_keepalive_interval_min_seconds", 240));
    const existingAfterSuccessIntervalMax = Number(getExistingValue(existing, "after_success_keepalive_interval_max_seconds", 420));
    const afterSuccessIntervalMin = clampInteger(
        input.after_success_keepalive_interval_min_seconds ?? existingAfterSuccessIntervalMin,
        240,
        MIN_INTERVAL_SECONDS,
        86400,
    );
    const afterSuccessIntervalMax = clampInteger(
        input.after_success_keepalive_interval_max_seconds ?? existingAfterSuccessIntervalMax,
        Math.max(afterSuccessIntervalMin, existingAfterSuccessIntervalMax),
        afterSuccessIntervalMin,
        86400,
    );
    let afterSuccessKeepaliveJobId = afterSuccessAction === "job"
        ? toNullableInteger(input.after_success_keepalive_job_id ?? getExistingValue(existing, "after_success_keepalive_job_id", null))
        : null;

    if (afterSuccessAction === "job") {
        if (!afterSuccessKeepaliveJobId) {
            throw new customError.AppError("after_success_keepalive_job_id is required", 400);
        }

        if (existing && afterSuccessKeepaliveJobId === Number(existing.id)) {
            throw new customError.AppError("Follow-up keepalive job cannot be itself", 400);
        }

        const followupJob = await SgVendorWakeupJob.query().find(afterSuccessKeepaliveJobId);
        if (!followupJob || followupJob.mode !== "keepalive") {
            throw new customError.AppError("Follow-up job must be a keepalive job", 400);
        }
    } else if (afterSuccessAction === "duration" && afterSuccessMinutes <= 0) {
        throw new customError.AppError("after_success_keepalive_minutes must be greater than 0", 400);
    } else {
        afterSuccessKeepaliveJobId = null;
    }

    const normalized: Partial<SgVendorWakeupJob> = {
        name,
        vendor_id: vendorId,
        vendor_model_id: vendorModelId,
        model_name: modelName,
        format: normalizeFormat(input.format ?? getExistingValue(existing, "format", ApiFormat.OPENAI)),
        auto_convert: toBoolean(input.auto_convert ?? getExistingValue(existing, "auto_convert", 0), false) ? 1 : 0,
        mode,
        enabled: enabled ? 1 : 0,
        schedule_mode: scheduleMode,
        start_time: startTime,
        end_time: endTime,
        interval_min_seconds: intervalMin,
        interval_max_seconds: intervalMax,
        max_attempts: clampInteger(input.max_attempts ?? getExistingValue(existing, "max_attempts", 8), 8, 1, 100),
        daily_limit: clampInteger(input.daily_limit ?? getExistingValue(existing, "daily_limit", 120), 120, 1, 500),
        cooldown_after_429_seconds: clampInteger(input.cooldown_after_429_seconds ?? getExistingValue(existing, "cooldown_after_429_seconds", 900), 900, MIN_429_COOLDOWN_SECONDS, 86400),
        after_success_action: afterSuccessAction,
        after_success_keepalive_minutes: afterSuccessAction === "duration" ? afterSuccessMinutes : 0,
        after_success_keepalive_interval_min_seconds: afterSuccessIntervalMin,
        after_success_keepalive_interval_max_seconds: afterSuccessIntervalMax,
        after_success_keepalive_job_id: afterSuccessKeepaliveJobId,
        prompt_category: wakeupPromptService.normalizeCategory(input.prompt_category ?? getExistingValue(existing, "prompt_category", "mixed")),
        custom_prompts: normalizeCustomPrompts(input.custom_prompts, existing?.custom_prompts ?? null),
        system_prompt: typeof input.system_prompt === "string"
            ? input.system_prompt.trim() || null
            : getExistingValue(existing, "system_prompt", null),
        max_tokens: clampInteger(input.max_tokens ?? getExistingValue(existing, "max_tokens", 64), 64, 1, 1024),
        temperature: clampNumber(input.temperature ?? getExistingValue(existing, "temperature", 0.7), 0.7, 0, 2),
        updated_at: formatSqlTimestamp(new Date()) as any,
    };

    normalized.next_run_at = enabled
        ? formatSqlTimestamp(getInitialNextRunAt(normalized as SgVendorWakeupJob)) as any
        : null;
    normalized.keepalive_until_at = null;

    return normalized;
}


function serializeTimestamp(value: unknown): unknown {
    if (value instanceof Date) {
        return value.toISOString();
    }

    return value ?? null;
}


function formatJob(row: Record<string, any>) {
    return {
        id: Number(row.id),
        name: row.name,
        vendor_id: Number(row.vendor_id),
        vendor_name: row.vendor_name ?? null,
        vendor_model_id: row.vendor_model_id === null || row.vendor_model_id === undefined ? null : Number(row.vendor_model_id),
        vendor_model_name: row.vendor_model_name ?? null,
        model_name: row.model_name,
        format: row.format,
        auto_convert: toBoolean(row.auto_convert),
        mode: row.mode,
        enabled: toBoolean(row.enabled),
        schedule_mode: row.schedule_mode ?? "window",
        start_time: row.start_time,
        end_time: row.end_time,
        interval_min_seconds: Number(row.interval_min_seconds),
        interval_max_seconds: Number(row.interval_max_seconds),
        max_attempts: Number(row.max_attempts),
        daily_limit: Number(row.daily_limit),
        cooldown_after_429_seconds: Number(row.cooldown_after_429_seconds),
        after_success_action: row.after_success_action ?? (Number(row.after_success_keepalive_minutes || 0) > 0 ? "duration" : "none"),
        after_success_keepalive_minutes: Number(row.after_success_keepalive_minutes || 0),
        after_success_keepalive_interval_min_seconds: Number(row.after_success_keepalive_interval_min_seconds || 240),
        after_success_keepalive_interval_max_seconds: Number(row.after_success_keepalive_interval_max_seconds || 420),
        after_success_keepalive_job_id: row.after_success_keepalive_job_id === null || row.after_success_keepalive_job_id === undefined ? null : Number(row.after_success_keepalive_job_id),
        after_success_keepalive_job_name: row.after_success_keepalive_job_name ?? null,
        prompt_category: row.prompt_category,
        custom_prompts: parseCustomPrompts(row.custom_prompts),
        next_prompt: row.next_prompt ?? null,
        system_prompt: row.system_prompt ?? null,
        max_tokens: Number(row.max_tokens),
        temperature: Number(row.temperature),
        run_date: row.run_date ?? null,
        run_count: Number(row.run_count || 0),
        consecutive_failures: Number(row.consecutive_failures || 0),
        last_status: row.last_status,
        last_http_status: row.last_http_status === null || row.last_http_status === undefined ? null : Number(row.last_http_status),
        last_error: row.last_error ?? null,
        last_run_at: serializeTimestamp(row.last_run_at),
        last_success_at: serializeTimestamp(row.last_success_at),
        next_run_at: serializeTimestamp(row.next_run_at),
        keepalive_until_at: serializeTimestamp(row.keepalive_until_at),
        created_at: serializeTimestamp(row.created_at),
        updated_at: serializeTimestamp(row.updated_at),
    };
}


function formatLog(row: Record<string, any>) {
    return {
        id: Number(row.id),
        job_id: Number(row.job_id),
        job_name: row.job_name ?? null,
        vendor_id: Number(row.vendor_id),
        vendor_name: row.vendor_name ?? null,
        vendor_model_id: row.vendor_model_id === null || row.vendor_model_id === undefined ? null : Number(row.vendor_model_id),
        model_name: row.model_name,
        format: row.format,
        prompt_category: row.prompt_category,
        prompt_text: row.prompt_text,
        success: toBoolean(row.success),
        http_status: row.http_status === null || row.http_status === undefined ? null : Number(row.http_status),
        duration_ms: Number(row.duration_ms || 0),
        error: row.error ?? null,
        error_detail: row.error_detail ?? null,
        response_preview: row.response_preview ?? null,
        created_at: serializeTimestamp(row.created_at),
    };
}


function parseCustomPrompts(value: unknown): string[] {
    if (!value || typeof value !== "string") {
        return [];
    }

    try {
        const parsed = JSON.parse(value);
        if (!Array.isArray(parsed)) {
            return [];
        }

        return parsed.map(item => String(item)).filter(Boolean);
    } catch {
        return [];
    }
}


async function getJobRow(id: number): Promise<Record<string, any> | null> {
    const knex = ormService.getKnex();
    const row = await knex("vendor_wakeup_job as j")
        .leftJoin("vendor as v", "v.id", "j.vendor_id")
        .leftJoin("vendor_model as vm", "vm.id", "j.vendor_model_id")
        .leftJoin("vendor_wakeup_job as fj", "fj.id", "j.after_success_keepalive_job_id")
        .select("j.*", "v.name as vendor_name", "vm.model_id as vendor_model_name", "fj.name as after_success_keepalive_job_name")
        .where("j.id", id)
        .first();

    return row ?? null;
}


async function getJob(id: number) {
    const row = await getJobRow(id);
    return row ? formatJob(row) : null;
}


async function listJobs(query: WakeupJobListQuery) {
    const { pageSize, offset } = parsePaginationQuery(query);
    const knex = ormService.getKnex();
    const dbQuery = knex("vendor_wakeup_job as j")
        .leftJoin("vendor as v", "v.id", "j.vendor_id")
        .leftJoin("vendor_model as vm", "vm.id", "j.vendor_model_id")
        .leftJoin("vendor_wakeup_job as fj", "fj.id", "j.after_success_keepalive_job_id");

    if (query.vendor_id) {
        dbQuery.where("j.vendor_id", Number(query.vendor_id));
    }

    if (query.enabled === "true" || query.enabled === "false") {
        dbQuery.where("j.enabled", query.enabled === "true" ? 1 : 0);
    }

    if (query.mode === "warmup" || query.mode === "keepalive") {
        dbQuery.where("j.mode", query.mode);
    }

    if (query.keyword) {
        dbQuery.where((builder: any) => {
            builder
                .where("j.name", "like", `%${query.keyword}%`)
                .orWhere("j.model_name", "like", `%${query.keyword}%`)
                .orWhere("v.name", "like", `%${query.keyword}%`);
        });
    }

    const countRow = await dbQuery.clone().count({ total: "j.id" }).first();
    const total = Number(countRow?.total ?? 0);
    const rows = await dbQuery
        .select("j.*", "v.name as vendor_name", "vm.model_id as vendor_model_name")
        .select("fj.name as after_success_keepalive_job_name")
        .orderBy("j.id", "desc")
        .limit(pageSize)
        .offset(offset);

    return createListResponse(rows.map(formatJob), total);
}


async function createJob(input: WakeupJobInput) {
    const data = await normalizeJobInput(input);
    const created = await SgVendorWakeupJob.query().create(data);
    return await getJob(Number(created.id));
}


async function updateJob(id: number, input: WakeupJobInput) {
    const job = await SgVendorWakeupJob.query().find(id);
    if (!job) {
        throw new customError.AppError("Wakeup job not found", 404);
    }

    const data = await normalizeJobInput(input, job);
    await SgVendorWakeupJob.query().where("id", id).update(data);
    return await getJob(id);
}


async function deleteJob(id: number) {
    const job = await SgVendorWakeupJob.query().find(id);
    if (!job) {
        throw new customError.AppError("Wakeup job not found", 404);
    }

    const knex = ormService.getKnex();
    await knex("vendor_wakeup_log").where("job_id", id).delete();
    await SgVendorWakeupJob.query().where("id", id).delete();
    return { success: true };
}


async function toggleJob(id: number, enabled: boolean) {
    const job = await SgVendorWakeupJob.query().find(id);
    if (!job) {
        throw new customError.AppError("Wakeup job not found", 404);
    }

    await SgVendorWakeupJob.query().where("id", id).update({
        enabled: enabled ? 1 : 0,
        keepalive_until_at: null,
        next_run_at: enabled ? formatSqlTimestamp(getInitialNextRunAt(job)) : null,
        updated_at: formatSqlTimestamp(new Date()),
    });

    return await getJob(id);
}


async function resolveRoute(job: SgVendorWakeupJob): Promise<ResolvedWakeupRoute> {
    const vendor = await SgVendor.query().find(job.vendor_id);
    if (!vendor) {
        throw new customError.AppError("Vendor not found", 404);
    }

    let vendorModel: SgVendorModel | null = null;
    if (job.vendor_model_id) {
        vendorModel = await SgVendorModel.query()
            .where("id", job.vendor_model_id)
            .where("vendor_id", job.vendor_id)
            .first();
        if (!vendorModel) {
            throw new customError.AppError("Vendor model not found", 404);
        }
    }

    const requestFormat = normalizeFormat(job.format);
    const supportedFormats = vendorModel?.getSupportedFormats() ?? vendor.getSupportedFormats();
    const upstreamFormat = job.isAutoConvertEnabled()
        ? senderService.resolveUpstreamFormat(requestFormat, supportedFormats)
        : requestFormat;

    return {
        vendor,
        vendorModel,
        modelName: job.model_name || vendorModel?.model_id || "test-ping",
        requestFormat,
        upstreamFormat,
        url: vendor.getUrlByFormat(upstreamFormat),
    };
}


function buildRequestBody(route: ResolvedWakeupRoute, prompt: string, job: SgVendorWakeupJob): string {
    const systemPrompt = job.system_prompt?.trim();

    if (route.upstreamFormat === ApiFormat.ANTHROPIC) {
        return JSON.stringify({
            model: route.modelName,
            ...(systemPrompt ? { system: systemPrompt } : {}),
            messages: [{ role: "user", content: prompt }],
            max_tokens: Math.max(1, Number(job.max_tokens || 64)),
            temperature: Number(job.temperature ?? 0.7),
            stream: false,
        });
    }

    if (route.upstreamFormat === ApiFormat.RESPONSES) {
        return JSON.stringify({
            model: route.modelName,
            ...(systemPrompt ? { instructions: systemPrompt } : {}),
            input: prompt,
            max_output_tokens: Math.max(1, Number(job.max_tokens || 64)),
            temperature: Number(job.temperature ?? 0.7),
            stream: false,
        });
    }

    return JSON.stringify({
        model: route.modelName,
        messages: [
            ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
            { role: "user", content: prompt },
        ],
        max_tokens: Math.max(1, Number(job.max_tokens || 64)),
        temperature: Number(job.temperature ?? 0.7),
        stream: false,
    });
}


function parseResponseJson(responseText: string): any | null {
    try {
        return JSON.parse(responseText);
    } catch {
        return null;
    }
}


function extractResponsesOutputText(data: any): string {
    if (typeof data?.output_text === "string") {
        return data.output_text;
    }

    if (!Array.isArray(data?.output)) {
        return "";
    }

    return data.output
        .flatMap((item: any) => Array.isArray(item?.content) ? item.content : [])
        .map((content: any) => {
            if (typeof content?.text === "string") return content.text;
            if (typeof content?.output_text === "string") return content.output_text;
            return "";
        })
        .filter(Boolean)
        .join("");
}


function extractAssistantText(format: ApiFormat, responseText: string): string {
    const data = parseResponseJson(responseText);
    if (!data) {
        return responseText;
    }

    if (format === ApiFormat.ANTHROPIC) {
        if (Array.isArray(data.content)) {
            return data.content
                .map((item: any) => typeof item?.text === "string" ? item.text : "")
                .filter(Boolean)
                .join("");
        }

        return "";
    }

    if (format === ApiFormat.RESPONSES) {
        return extractResponsesOutputText(data);
    }

    const content = data.choices?.[0]?.message?.content ?? data.choices?.[0]?.text;
    return typeof content === "string" ? content : "";
}


async function getFetchTimeoutMs(): Promise<number> {
    const configured = (await configService.getConfig(ConfigKey.TEST_REQUEST_TIMEOUT_MS, String(DEFAULT_TEST_TIMEOUT_MS))).getNumber();
    if (!Number.isFinite(configured) || configured <= 0) {
        return DEFAULT_TEST_TIMEOUT_MS;
    }

    return Math.min(600000, Math.max(10000, Math.floor(configured)));
}


async function executeUpstreamRequest(job: SgVendorWakeupJob, route: ResolvedWakeupRoute, prompt: string): Promise<ExecutionResult> {
    const headers = senderService.buildUpstreamHeaders(null, route.vendor, route.upstreamFormat, route.vendorModel);
    const body = buildRequestBody(route, prompt, job);
    const startTime = Date.now();
    const timeoutMs = await getFetchTimeoutMs();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await senderService.fetchWithProxy(route.url, {
            method: "POST",
            headers,
            body,
            signal: controller.signal,
        }, route.vendor);
        const duration = Date.now() - startTime;
        const responseText = await response.text().catch(() => "");
        const assistantText = extractAssistantText(route.upstreamFormat, responseText);
        const responsePreview = responseText.slice(0, 1000);

        return {
            success: response.ok,
            status: response.status,
            duration,
            prompt,
            promptCategory: wakeupPromptService.normalizeCategory(job.prompt_category),
            responsePreview,
            error: response.ok ? undefined : `HTTP ${response.status}`,
            nextPrompt: response.ok && job.prompt_category === "self_chain"
                ? wakeupPromptService.extractNextPrompt(assistantText || responseText)
                : undefined,
        };
    } catch (error) {
        return {
            success: false,
            duration: Date.now() - startTime,
            prompt,
            promptCategory: wakeupPromptService.normalizeCategory(job.prompt_category),
            error: senderService.formatFetchError(error),
            errorDetail: senderService.serializeFetchError(error),
        };
    } finally {
        clearTimeout(timeout);
    }
}


async function trimLogsForJob(jobId: number): Promise<void> {
    const total = Number(await SgVendorWakeupLog.query().where("job_id", jobId).count() || 0);
    const overflow = total - MAX_LOGS_PER_JOB;
    if (overflow <= 0) {
        return;
    }

    const knex = ormService.getKnex();
    const rows = await knex("vendor_wakeup_log")
        .select("id")
        .where("job_id", jobId)
        .orderBy("id", "asc")
        .limit(overflow);
    const ids = rows.map((row: any) => Number(row.id)).filter((id: number) => Number.isFinite(id) && id > 0);
    if (ids.length > 0) {
        await knex("vendor_wakeup_log").whereIn("id", ids).delete();
    }
}


async function createLog(job: SgVendorWakeupJob, route: ResolvedWakeupRoute, result: ExecutionResult) {
    const log = await SgVendorWakeupLog.query().create({
        job_id: job.id,
        vendor_id: job.vendor_id,
        vendor_model_id: job.vendor_model_id ?? null,
        model_name: route.modelName,
        format: route.upstreamFormat,
        prompt_category: result.promptCategory,
        prompt_text: result.prompt,
        success: result.success ? 1 : 0,
        http_status: result.status ?? null,
        duration_ms: result.duration,
        error: result.error ?? null,
        error_detail: result.errorDetail ? JSON.stringify(result.errorDetail) : null,
        response_preview: result.responsePreview ?? null,
    });

    await trimLogsForJob(job.id);
    return log;
}


function buildNotificationBody(job: SgVendorWakeupJob, result: ExecutionResult, route: ResolvedWakeupRoute): string {
    const status = result.status ? `HTTP ${result.status}` : result.error || "请求失败";
    return `${job.name} / ${route.modelName}，${status}，耗时 ${result.duration}ms`;
}


async function notifyExecutionResult(
    job: SgVendorWakeupJob,
    route: ResolvedWakeupRoute,
    result: ExecutionResult,
    activeKeepaliveUntil: Date | null,
    followupError: string | null,
): Promise<void> {
    if (result.status === 429) {
        await desktopNotificationService.send({
            event: "rate_limited",
            title: "唤醒保活遇到 429",
            body: buildNotificationBody(job, result, route),
        });
        return;
    }

    if (followupError) {
        await desktopNotificationService.send({
            event: "warmup_failure",
            title: "唤醒后的保活任务启用失败",
            body: `${job.name}：${followupError}`,
        });
        return;
    }

    if (result.success && job.mode === "warmup" && !activeKeepaliveUntil) {
        await desktopNotificationService.send({
            event: "warmup_success",
            title: "模型唤醒成功",
            body: buildNotificationBody(job, result, route),
        });
        return;
    }

    if (!result.success && (job.mode === "keepalive" || activeKeepaliveUntil)) {
        await desktopNotificationService.send({
            event: "keepalive_failure",
            title: "模型保活失败",
            body: buildNotificationBody(job, result, route),
        });
        return;
    }

    if (!result.success && job.mode === "warmup") {
        await desktopNotificationService.send({
            event: "warmup_failure",
            title: "模型唤醒失败",
            body: buildNotificationBody(job, result, route),
        });
    }
}


function getWarmupKeepaliveUntil(job: SgVendorWakeupJob, now: Date): Date | null {
    if (job.mode !== "warmup") {
        return null;
    }

    const until = toDate(job.keepalive_until_at);
    if (!until || until.getTime() <= now.getTime()) {
        return null;
    }

    return until;
}


function isDurationAfterSuccessAction(job: SgVendorWakeupJob): boolean {
    return job.mode === "warmup" && job.after_success_action === "duration";
}


function isFollowupJobAfterSuccessAction(job: SgVendorWakeupJob): boolean {
    return job.mode === "warmup" && job.after_success_action === "job" && Number(job.after_success_keepalive_job_id || 0) > 0;
}


function isWarmupKeepalivePhase(job: SgVendorWakeupJob, now: Date): boolean {
    return getWarmupKeepaliveUntil(job, now) !== null;
}


function getNextWarmupKeepaliveRun(job: SgVendorWakeupJob, until: Date, now: Date): Date | null {
    const candidate = addSeconds(now, randomAfterSuccessKeepaliveIntervalSeconds(job));
    if (candidate.getTime() <= until.getTime()) {
        return candidate;
    }

    return getNextWindowStartAfter(job, now);
}


function getNextRunAfterExecution(job: SgVendorWakeupJob, result: ExecutionResult, runCount: number, now: Date): Date | null {
    if (!job.isEnabled()) {
        return null;
    }

    if (Number(job.daily_limit || 0) > 0 && runCount >= Number(job.daily_limit)) {
        return getNextScheduleStartAfter(job, now);
    }

    if (result.status === 429) {
        return addSeconds(now, randomCooldownSeconds(job));
    }

    if (job.mode === "warmup") {
        const activeKeepaliveUntil = getWarmupKeepaliveUntil(job, now);
        if (activeKeepaliveUntil) {
            return getNextWarmupKeepaliveRun(job, activeKeepaliveUntil, now);
        }

        if (result.success && isDurationAfterSuccessAction(job) && Number(job.after_success_keepalive_minutes || 0) > 0) {
            const until = addSeconds(now, Number(job.after_success_keepalive_minutes) * 60);
            return getNextWarmupKeepaliveRun(job, until, now);
        }

        if (result.success || runCount >= Number(job.max_attempts || 1)) {
            return getNextScheduleStartAfter(job, now);
        }
    }

    return addSeconds(now, randomIntervalSeconds(job));
}


async function resetDailyCounterIfNeeded(job: SgVendorWakeupJob, now: Date): Promise<SgVendorWakeupJob> {
    const dateKey = todayKey(now);
    if (job.run_date === dateKey) {
        return job;
    }

    await SgVendorWakeupJob.query().where("id", job.id).update({
        run_date: dateKey,
        run_count: 0,
        keepalive_until_at: null,
        updated_at: formatSqlTimestamp(now),
    });
    job.run_date = dateKey;
    job.run_count = 0;
    job.keepalive_until_at = null;
    return job;
}


async function markSkipped(job: SgVendorWakeupJob, nextRunAt: Date, reason: string): Promise<void> {
    await SgVendorWakeupJob.query().where("id", job.id).update({
        last_status: "skipped",
        last_error: reason,
        keepalive_until_at: null,
        next_run_at: formatSqlTimestamp(nextRunAt),
        updated_at: formatSqlTimestamp(new Date()),
    });

    await desktopNotificationService.send({
        event: "skipped",
        title: "唤醒保活任务已跳过",
        body: `${job.name}：${reason}`,
    });
}


async function activateFollowupKeepaliveJob(jobId: number, now: Date): Promise<string | null> {
    const followupJob = await SgVendorWakeupJob.query().find(jobId);
    if (!followupJob) {
        return "Follow-up keepalive job not found";
    }

    if (followupJob.mode !== "keepalive") {
        return "Follow-up job is not a keepalive job";
    }

    const dateKey = todayKey(now);
    await SgVendorWakeupJob.query().where("id", jobId).update({
        enabled: 1,
        run_date: followupJob.run_date === dateKey ? followupJob.run_date : dateKey,
        run_count: followupJob.run_date === dateKey ? followupJob.run_count : 0,
        keepalive_until_at: null,
        last_error: null,
        next_run_at: formatSqlTimestamp(getInitialNextRunAt(followupJob, now)),
        updated_at: formatSqlTimestamp(now),
    });

    return null;
}


async function executeJob(job: SgVendorWakeupJob, manual: boolean = false) {
    const now = new Date();
    await resetDailyCounterIfNeeded(job, now);

    const route = await resolveRoute(job);
    const promptChoice = await wakeupPromptService.buildPrompt(
        job.prompt_category,
        job.getCustomPrompts(),
        job.next_prompt,
    );
    const result = await executeUpstreamRequest(job, route, promptChoice.text);
    const log = await createLog(job, route, result);
    const runCount = Number(job.run_count || 0) + 1;
    const lastStatus: WakeupStatus = result.success
        ? "success"
        : result.status === 429
            ? "rate_limited"
            : "failed";
    const nextRunAt = getNextRunAfterExecution(job, result, runCount, now);
    const activeKeepaliveUntil = getWarmupKeepaliveUntil(job, now);
    let keepaliveUntilAt = activeKeepaliveUntil ?? toDate(job.keepalive_until_at);
    let finalStatus: WakeupStatus = lastStatus;
    let followupError: string | null = null;

    if (job.mode === "warmup") {
        if (!activeKeepaliveUntil && result.success && isDurationAfterSuccessAction(job) && Number(job.after_success_keepalive_minutes || 0) > 0) {
            keepaliveUntilAt = addSeconds(now, Number(job.after_success_keepalive_minutes) * 60);
        }

        if (keepaliveUntilAt) {
            const keepaliveContinues = Boolean(nextRunAt && nextRunAt.getTime() <= keepaliveUntilAt.getTime());
            if (keepaliveContinues && result.success) {
                finalStatus = "keeping_alive";
            } else if (!keepaliveContinues) {
                keepaliveUntilAt = null;
            }
        }

        if (result.success && isFollowupJobAfterSuccessAction(job) && !activeKeepaliveUntil) {
            followupError = await activateFollowupKeepaliveJob(Number(job.after_success_keepalive_job_id), now);
        }
    } else {
        keepaliveUntilAt = null;
    }

    await SgVendorWakeupJob.query().where("id", job.id).update({
        run_date: todayKey(now),
        run_count: runCount,
        consecutive_failures: result.success ? 0 : Number(job.consecutive_failures || 0) + 1,
        last_status: finalStatus,
        last_http_status: result.status ?? null,
        last_error: followupError ?? result.error ?? null,
        last_run_at: formatSqlTimestamp(now),
        last_success_at: result.success ? formatSqlTimestamp(now) : job.last_success_at ?? null,
        next_run_at: nextRunAt ? formatSqlTimestamp(nextRunAt) : null,
        keepalive_until_at: keepaliveUntilAt ? formatSqlTimestamp(keepaliveUntilAt) : null,
        next_prompt: result.nextPrompt !== undefined ? result.nextPrompt : job.next_prompt ?? null,
        updated_at: formatSqlTimestamp(new Date()),
    });

    await notifyExecutionResult(job, route, result, activeKeepaliveUntil, followupError);

    return {
        success: result.success,
        status: result.status,
        duration: result.duration,
        error: result.error,
        error_detail: result.errorDetail,
        response_preview: result.responsePreview,
        manual,
        job: await getJob(job.id),
        log: formatLog({ ...(log.toData() as any), job_name: job.name }),
    };
}


async function runJobNow(id: number) {
    const job = await SgVendorWakeupJob.query().find(id);
    if (!job) {
        throw new customError.AppError("Wakeup job not found", 404);
    }

    if (runningJobIds.has(id)) {
        throw new customError.AppError("Wakeup job is already running", 409);
    }

    runningJobIds.add(id);
    try {
        return await executeJob(job, true);
    } finally {
        runningJobIds.delete(id);
    }
}


async function runScheduledJob(job: SgVendorWakeupJob): Promise<void> {
    const now = new Date();
    await resetDailyCounterIfNeeded(job, now);

    const windowState = isAlwaysSchedule(job) ? null : getWindowState(job, now);
    if (windowState && !windowState.inWindow) {
        await SgVendorWakeupJob.query().where("id", job.id).update({
            keepalive_until_at: null,
            next_run_at: formatSqlTimestamp(windowState.nextStart),
            updated_at: formatSqlTimestamp(now),
        });
        return;
    }

    const rawKeepaliveUntil = toDate(job.keepalive_until_at);
    if (job.mode === "warmup" && rawKeepaliveUntil && rawKeepaliveUntil.getTime() <= now.getTime()) {
        await SgVendorWakeupJob.query().where("id", job.id).update({
            last_status: "success",
            keepalive_until_at: null,
            next_run_at: formatSqlTimestamp(getNextWindowStartAfter(job, now)),
            updated_at: formatSqlTimestamp(now),
        });
        return;
    }

    if (Number(job.daily_limit || 0) > 0 && Number(job.run_count || 0) >= Number(job.daily_limit)) {
        await markSkipped(job, getNextScheduleStartAfter(job, now), "Daily limit reached");
        return;
    }

    if (job.mode === "warmup" && !isWarmupKeepalivePhase(job, now) && Number(job.run_count || 0) >= Number(job.max_attempts || 1)) {
        await markSkipped(job, getNextWindowStartAfter(job, now), "Warmup max attempts reached");
        return;
    }

    await executeJob(job, false);
}


async function schedulerTick(): Promise<void> {
    if (schedulerTickRunning) {
        return;
    }

    schedulerTickRunning = true;
    try {
        const knex = ormService.getKnex();
        const rows = await knex("vendor_wakeup_job")
            .select("id")
            .where("enabled", 1)
            .where((builder: any) => {
                builder.whereNull("next_run_at").orWhere("next_run_at", "<=", formatSqlTimestamp(new Date()));
            })
            .orderBy("next_run_at", "asc")
            .limit(10);

        for (const row of rows) {
            const jobId = Number(row.id);
            if (!Number.isFinite(jobId) || runningJobIds.has(jobId)) {
                continue;
            }

            const job = await SgVendorWakeupJob.query().find(jobId);
            if (!job || !job.isEnabled()) {
                continue;
            }

            runningJobIds.add(jobId);
            try {
                await runScheduledJob(job);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                console.warn(`[WakeupService] Job ${jobId} failed:`, error);
                await SgVendorWakeupJob.query().where("id", jobId).update({
                    last_status: "failed",
                    last_error: message,
                    next_run_at: formatSqlTimestamp(addSeconds(new Date(), randomCooldownSeconds(job))),
                    updated_at: formatSqlTimestamp(new Date()),
                });
                await desktopNotificationService.send({
                    event: job.mode === "keepalive" ? "keepalive_failure" : "warmup_failure",
                    title: job.mode === "keepalive" ? "模型保活异常" : "模型唤醒异常",
                    body: `${job.name}：${message}`,
                });
            } finally {
                runningJobIds.delete(jobId);
            }
        }
    } finally {
        schedulerTickRunning = false;
    }
}


function startScheduler(): void {
    if (!ormService.isNode || schedulerTimer) {
        return;
    }

    schedulerTimer = setInterval(() => {
        void schedulerTick();
    }, SCHEDULER_TICK_MS);

    void schedulerTick();
    console.log("[WakeupService] Scheduler started");
}


function stopScheduler(): void {
    if (!schedulerTimer) {
        return;
    }

    clearInterval(schedulerTimer);
    schedulerTimer = null;
}


async function listLogs(query: WakeupLogListQuery) {
    const { pageSize, offset } = parsePaginationQuery(query);
    const knex = ormService.getKnex();
    const dbQuery = knex("vendor_wakeup_log as l")
        .leftJoin("vendor_wakeup_job as j", "j.id", "l.job_id")
        .leftJoin("vendor as v", "v.id", "l.vendor_id");

    if (query.job_id) {
        dbQuery.where("l.job_id", Number(query.job_id));
    }

    if (query.success === "true" || query.success === "false") {
        dbQuery.where("l.success", query.success === "true" ? 1 : 0);
    }

    const countRow = await dbQuery.clone().count({ total: "l.id" }).first();
    const total = Number(countRow?.total ?? 0);
    const rows = await dbQuery
        .select("l.*", "j.name as job_name", "v.name as vendor_name")
        .orderBy("l.id", "desc")
        .limit(pageSize)
        .offset(offset);

    return createListResponse(rows.map(formatLog), total);
}


async function clearLogs(jobId?: number | null) {
    const knex = ormService.getKnex();
    const query = knex("vendor_wakeup_log");
    if (jobId && jobId > 0) {
        query.where("job_id", jobId);
    }

    const deleted = Number(await query.delete() || 0);
    return {
        success: true,
        deleted,
    };
}


export default {
    clearLogs,
    createJob,
    deleteJob,
    getJob,
    listJobs,
    listLogs,
    runJobNow,
    startScheduler,
    stopScheduler,
    toggleJob,
    updateJob,
};
