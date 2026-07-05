import configService, { ConfigKey } from "./configService";
import fs from "fs/promises";
import path from "path";

const HOST_KEY_LENGTH = 8;
const DEFAULT_LOCAL_HOST = "127.0.0.1";
const DEFAULT_LOCAL_PORT = "8720";

let cachedHostKey: string | null = null;
let loadingHostKey: Promise<string> | null = null;
let runtimeHost = process.env.HOST || DEFAULT_LOCAL_HOST;
let runtimePort = process.env.PORT || DEFAULT_LOCAL_PORT;

interface BindConfig {
    host: string;
    port: string;
    current_host: string;
    current_port: string;
    env_host: string | null;
    env_port: string | null;
    restart_required: boolean;
    env_override: boolean;
    desktop_config_synced: boolean;
}


function generateShortUuid(): string {
    return crypto.randomUUID().replace(/-/g, "").slice(0, HOST_KEY_LENGTH);
}


async function loadHostKey(): Promise<string> {
    const existing = (await configService.getConfig(ConfigKey.HOST_KEY, "")).getString().trim();
    if (existing) {
        cachedHostKey = existing;
        return existing;
    }

    const generated = generateShortUuid();
    await configService.setValue(ConfigKey.HOST_KEY, generated);
    cachedHostKey = generated;
    return generated;
}


async function getHostKey(): Promise<string> {
    if (cachedHostKey) return cachedHostKey;
    if (loadingHostKey) return await loadingHostKey;

    loadingHostKey = loadHostKey().finally(() => {
        loadingHostKey = null;
    });
    return await loadingHostKey;
}


function getLocalPort(): string {
    return runtimePort;
}


function getLocalHost(): string {
    return runtimeHost;
}


function normalizeHost(value: unknown, fallback: string = DEFAULT_LOCAL_HOST): string {
    if (typeof value !== "string") {
        return fallback;
    }

    const normalized = value.trim();
    if (!normalized || normalized.includes("://") || normalized.includes("/") || normalized.includes("\\")) {
        return fallback;
    }

    return normalized;
}


function normalizePort(value: unknown, fallback: string = DEFAULT_LOCAL_PORT): string {
    const parsed = Number(typeof value === "string" ? value.trim() : value);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
        return fallback;
    }

    return String(parsed);
}


async function getConfiguredHost(): Promise<string> {
    if (process.env.HOST?.trim()) {
        return normalizeHost(process.env.HOST, DEFAULT_LOCAL_HOST);
    }

    return normalizeHost(
        (await configService.getConfig(ConfigKey.LOCAL_HOST, DEFAULT_LOCAL_HOST)).getString(),
        DEFAULT_LOCAL_HOST,
    );
}


async function getConfiguredPort(): Promise<string> {
    if (process.env.PORT?.trim()) {
        return normalizePort(process.env.PORT, DEFAULT_LOCAL_PORT);
    }

    return normalizePort(
        (await configService.getConfig(ConfigKey.LOCAL_PORT, DEFAULT_LOCAL_PORT)).getString(),
        DEFAULT_LOCAL_PORT,
    );
}


async function loadBindConfig(): Promise<{ host: string; port: string }> {
    const host = await getConfiguredHost();
    const port = await getConfiguredPort();
    setRuntimeBindConfig(host, port);
    return { host, port };
}


function setRuntimeBindConfig(host: string, port: string): void {
    runtimeHost = normalizeHost(host, DEFAULT_LOCAL_HOST);
    runtimePort = normalizePort(port, DEFAULT_LOCAL_PORT);
}


async function syncDesktopConfig(host: string, port: string): Promise<boolean> {
    const dbPath = process.env.DB_PATH?.trim();
    if (!dbPath || !process.argv.includes("--desktop-mode")) {
        return false;
    }

    const configPath = path.join(path.dirname(dbPath), "config.json");
    let existing: Record<string, unknown> = {};
    try {
        existing = JSON.parse(await fs.readFile(configPath, "utf-8"));
    } catch {
        existing = {};
    }

    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(
        configPath,
        JSON.stringify({
            ...existing,
            host,
            port: Number(port),
        }, null, 2),
        "utf-8",
    );

    return true;
}


async function getBindConfig(): Promise<BindConfig> {
    const configuredHost = normalizeHost(
        (await configService.getConfig(ConfigKey.LOCAL_HOST, DEFAULT_LOCAL_HOST)).getString(),
        DEFAULT_LOCAL_HOST,
    );
    const configuredPort = normalizePort(
        (await configService.getConfig(ConfigKey.LOCAL_PORT, DEFAULT_LOCAL_PORT)).getString(),
        DEFAULT_LOCAL_PORT,
    );

    const envHost = process.env.HOST?.trim() || null;
    const envPort = process.env.PORT?.trim() || null;
    return {
        host: configuredHost,
        port: configuredPort,
        current_host: runtimeHost,
        current_port: runtimePort,
        env_host: envHost,
        env_port: envPort,
        restart_required: runtimeHost !== configuredHost || runtimePort !== configuredPort,
        env_override: Boolean(envHost || envPort),
        desktop_config_synced: false,
    };
}


async function saveBindConfig(input: { host?: unknown; port?: unknown }): Promise<BindConfig> {
    const host = normalizeHost(input.host, DEFAULT_LOCAL_HOST);
    const port = normalizePort(input.port, DEFAULT_LOCAL_PORT);

    await configService.setValue(ConfigKey.LOCAL_HOST, host);
    await configService.setValue(ConfigKey.LOCAL_PORT, port);
    const desktopConfigSynced = await syncDesktopConfig(host, port);
    const config = await getBindConfig();

    return {
        ...config,
        desktop_config_synced: desktopConfigSynced,
    };
}


export default {
    getHostKey,
    getBindConfig,
    loadBindConfig,
    getLocalPort,
    getLocalHost,
    saveBindConfig,
    setRuntimeBindConfig,
};

export {
    generateShortUuid,
    getBindConfig,
    getHostKey,
    loadBindConfig,
    getLocalPort,
    getLocalHost,
    saveBindConfig,
    setRuntimeBindConfig,
};
