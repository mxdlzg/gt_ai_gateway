import { spawn } from "child_process";
import { existsSync } from "fs";
import fs from "fs/promises";
import { basename, join, resolve } from "path";
import configService, { ConfigKey } from "./configService";
import ormService from "./ormService";
import { getLogDir, getLogger, normalizeLogFileLevel } from "../util/logger";

interface LogFileInfo {
    name: string;
    path: string;
    size: number;
    modified_at: string;
}

interface LogStatus {
    supported: boolean;
    log_dir: string;
    file_enabled: boolean;
    file_level: string;
    retention_days: number;
    max_files: number;
    stream_log_enabled: boolean;
    total_files: number;
    total_size: number;
    files: LogFileInfo[];
}

const APP_LOG_PATTERN = /^app-\d{4}-\d{2}-\d{2}\.log$/;


function readBoolean(value: string | undefined, defaultValue: string): boolean {
    const raw = value === undefined || value === "" ? defaultValue : value;
    return raw !== "false";
}


function readNumber(value: string | undefined, defaultValue: number): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : defaultValue;
}


async function getLogSettings() {
    return {
        fileEnabled: (await configService.getConfig(ConfigKey.LOG_FILE_ENABLED, "true")).getBoolean(),
        fileLevel: normalizeLogFileLevel((await configService.getConfig(ConfigKey.LOG_FILE_LEVEL, "info")).getString()),
        retentionDays: readNumber((await configService.getConfig(ConfigKey.LOG_RETENTION_DAYS, "14")).getString(), 14),
        maxFiles: readNumber((await configService.getConfig(ConfigKey.LOG_MAX_FILES, "30")).getString(), 30),
        streamLogEnabled: (await configService.getConfig(ConfigKey.STREAM_LOG_ENABLED, "false")).getBoolean(),
    };
}


async function applyRuntimeConfig(): Promise<void> {
    const logger = getLogger();
    if (!logger) return;

    const settings = await getLogSettings();
    logger.setEnabled(settings.fileEnabled);
    logger.setFileLevel(settings.fileLevel);
    await cleanup({
        older_than_days: settings.retentionDays,
        keep_latest: settings.maxFiles,
    });
}


async function listLogFiles(): Promise<LogFileInfo[]> {
    const logDir = getLogDir();
    if (!existsSync(logDir)) return [];

    const entries = await fs.readdir(logDir, { withFileTypes: true });
    const files: LogFileInfo[] = [];
    for (const entry of entries) {
        if (!entry.isFile() || !APP_LOG_PATTERN.test(entry.name)) continue;

        const filePath = join(logDir, entry.name);
        const stat = await fs.stat(filePath);
        files.push({
            name: entry.name,
            path: filePath,
            size: stat.size,
            modified_at: stat.mtime.toISOString(),
        });
    }

    files.sort((a, b) => b.modified_at.localeCompare(a.modified_at));
    return files;
}


async function status(): Promise<LogStatus> {
    const settings = await getLogSettings();
    const files = await listLogFiles();
    return {
        supported: ormService.isNode,
        log_dir: getLogDir(),
        file_enabled: settings.fileEnabled,
        file_level: settings.fileLevel,
        retention_days: settings.retentionDays,
        max_files: settings.maxFiles,
        stream_log_enabled: settings.streamLogEnabled,
        total_files: files.length,
        total_size: files.reduce((sum, file) => sum + file.size, 0),
        files: files.slice(0, 20),
    };
}


async function cleanup(options: { older_than_days?: number; keep_latest?: number; clear_all?: boolean } = {}) {
    if (!ormService.isNode) {
        return { success: false, deleted: 0, error: "Log cleanup is only supported in Node mode" };
    }

    const settings = await getLogSettings();
    const olderThanDays = options.older_than_days ?? settings.retentionDays;
    const keepLatest = options.keep_latest ?? settings.maxFiles;
    const clearAll = options.clear_all === true;
    const now = Date.now();
    const files = await listLogFiles();
    const deleteSet = new Set<string>();

    if (clearAll) {
        for (const file of files) deleteSet.add(file.path);
    } else {
        if (olderThanDays > 0) {
            const maxAgeMs = olderThanDays * 24 * 60 * 60 * 1000;
            for (const file of files) {
                const modifiedAt = new Date(file.modified_at).getTime();
                if (Number.isFinite(modifiedAt) && now - modifiedAt > maxAgeMs) {
                    deleteSet.add(file.path);
                }
            }
        }

        if (keepLatest > 0 && files.length > keepLatest) {
            for (const file of files.slice(keepLatest)) {
                deleteSet.add(file.path);
            }
        }
    }

    let deleted = 0;
    for (const filePath of deleteSet) {
        const resolvedLogDir = resolve(getLogDir());
        const resolvedFile = resolve(filePath);
        if (!resolvedFile.startsWith(resolvedLogDir) || basename(resolvedFile) === "") continue;

        await fs.rm(resolvedFile, { force: true });
        deleted++;
    }

    return { success: true, deleted };
}


async function openLogDir() {
    if (!ormService.isNode) {
        return { success: false, error: "Opening the log folder is only supported in Node mode" };
    }

    const logDir = getLogDir();
    await fs.mkdir(logDir, { recursive: true });

    const command = process.platform === "win32"
        ? "explorer.exe"
        : process.platform === "darwin"
            ? "open"
            : "xdg-open";

    spawn(command, [logDir], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
    }).unref();

    return { success: true, path: logDir };
}


async function isStreamLogEnabled(): Promise<boolean> {
    if (!ormService.isNode) return false;
    const configValue = (await configService.getConfig(ConfigKey.STREAM_LOG_ENABLED, process.env.STREAM_LOG_ENABLED === "true" ? "true" : "false")).getString();
    return readBoolean(configValue, "false");
}


export default {
    applyRuntimeConfig,
    cleanup,
    getLogSettings,
    isStreamLogEnabled,
    openLogDir,
    status,
};

export type { LogStatus };
