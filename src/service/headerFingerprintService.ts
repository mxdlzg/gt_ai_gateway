import { ApiFormat, HeaderFingerprint } from "../constants";
import { SgVendor } from "../model/sgVendor";
import { SgVendorModel } from "../model/sgVendorModel";
import configService, { ConfigKey } from "./configService";

export interface HeaderFingerprintPreset {
    key: string;
    label: string;
    headers: Record<string, string>;
}

const SENSITIVE_HEADER_KEYS = [
    "authorization",
    "x-api-key",
    "api-key",
    "content-length",
    "host",
];

const CLAUDE_BETA = "claude-code-20250219,context-1m-2025-08-07,interleaved-thinking-2025-05-14,mid-conversation-system-2026-04-07,context-1m-2025-08-07,effort-2025-11-24";
const SESSION_ID_TEMPLATE = "{session_id}";
const PRESET_KEY_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]{1,63}$/;
const RESERVED_PRESET_KEYS = new Set(["inherit", HeaderFingerprint.AUTO, HeaderFingerprint.NONE]);


function normalizeFingerprint(
    value: string | null | undefined,
    fallback: string,
): string {
    if (!value) {
        return fallback;
    }

    const normalized = value.trim();
    if (normalized === "inherit") {
        return "";
    }

    if (Object.values(HeaderFingerprint).includes(normalized as HeaderFingerprint)) {
        return normalized;
    }

    if (isValidPresetKey(normalized)) {
        return normalized;
    }

    return fallback;
}


function normalizeVendorSetting(value: unknown): string {
    const normalized = normalizeFingerprint(typeof value === "string" ? value : null, HeaderFingerprint.AUTO);
    return normalized || HeaderFingerprint.AUTO;
}


function normalizeModelSetting(value: unknown): string {
    return normalizeFingerprint(typeof value === "string" ? value : null, "");
}


function normalizeOptionalSetting(value: unknown): string {
    return normalizeModelSetting(value);
}


function isValidPresetKey(value: string): boolean {
    return PRESET_KEY_PATTERN.test(value) && !RESERVED_PRESET_KEYS.has(value);
}


function sessionId(): string {
    const runtimeGlobal = globalThis as typeof globalThis & {
        crypto?: { randomUUID?: () => string };
    };
    return runtimeGlobal.crypto?.randomUUID?.() ?? "8f1e6ed9-5f0e-429a-a52f-00442bcff83c";
}


function getClaudeCliHeaders(): Record<string, string> {
    return {
        "accept": "application/json",
        "accept-encoding": "gzip, deflate, br, zstd",
        "anthropic-beta": CLAUDE_BETA,
        "anthropic-dangerous-direct-browser-access": "true",
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
        "user-agent": "claude-cli/2.1.198 (external, cli)",
        "x-app": "cli",
        "x-claude-code-session-id": SESSION_ID_TEMPLATE,
        "x-stainless-arch": "x64",
        "x-stainless-lang": "js",
        "x-stainless-os": "Windows",
        "x-stainless-package-version": "0.94.0",
        "x-stainless-retry-count": "0",
        "x-stainless-runtime": "node",
        "x-stainless-runtime-version": "v26.3.0",
        "x-stainless-timeout": "1200",
    };
}


function getCodexCliHeaders(): Record<string, string> {
    return {
        "accept": "application/json",
        "accept-encoding": "gzip, deflate, br, zstd",
        "content-type": "application/json",
        "originator": "codex_cli_rs",
        "user-agent": "codex_cli_rs/0.0.0 (Windows 10.0; x64) WindowsTerminal",
    };
}


function sanitizePresetHeaders(headers: Record<string, string>): Record<string, string> {
    const sanitized: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
        const normalizedKey = key.trim();
        if (!normalizedKey || SENSITIVE_HEADER_KEYS.includes(normalizedKey.toLowerCase())) {
            continue;
        }

        sanitized[normalizedKey] = value;
    }

    return sanitized;
}


function defaultPresets(): HeaderFingerprintPreset[] {
    return [
        {
            key: HeaderFingerprint.CLAUDE_CLI,
            label: "Claude CLI",
            headers: sanitizePresetHeaders(getClaudeCliHeaders()),
        },
        {
            key: HeaderFingerprint.CODEX_CLI,
            label: "Codex CLI",
            headers: sanitizePresetHeaders(getCodexCliHeaders()),
        },
    ];
}


function normalizeHeaders(value: unknown): Record<string, string> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return {};
    }

    const headers: Record<string, string> = {};
    for (const [key, rawValue] of Object.entries(value as Record<string, unknown>)) {
        const normalizedKey = key.trim();
        if (!normalizedKey) continue;
        if (rawValue === undefined || rawValue === null) continue;
        headers[normalizedKey] = String(rawValue);
    }

    return sanitizePresetHeaders(headers);
}


function normalizePreset(value: unknown): HeaderFingerprintPreset | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }

    const source = value as Record<string, unknown>;
    const key = typeof source.key === "string" ? source.key.trim() : "";
    if (!isValidPresetKey(key)) {
        return null;
    }

    const label = typeof source.label === "string" && source.label.trim()
        ? source.label.trim()
        : key;

    return {
        key,
        label,
        headers: normalizeHeaders(source.headers),
    };
}


function normalizePresets(value: unknown): HeaderFingerprintPreset[] {
    const source = Array.isArray(value) ? value : [];
    const seen = new Set<string>();
    const presets: HeaderFingerprintPreset[] = [];

    for (const item of source) {
        const preset = normalizePreset(item);
        if (!preset || seen.has(preset.key)) continue;
        seen.add(preset.key);
        presets.push(preset);
    }

    return presets;
}


function parsePresetConfig(value: string): HeaderFingerprintPreset[] {
    if (!value.trim()) {
        return defaultPresets();
    }

    try {
        const parsed = JSON.parse(value);
        return normalizePresets(parsed);
    } catch {
        return defaultPresets();
    }
}


async function getPresets(): Promise<HeaderFingerprintPreset[]> {
    const config = await configService.getConfig(ConfigKey.HEADER_FINGERPRINT_PRESETS, "");
    return parsePresetConfig(config.getString());
}


async function updatePresets(input: unknown): Promise<{ presets: HeaderFingerprintPreset[] }> {
    const presets = normalizePresets(input);
    await configService.setValue(ConfigKey.HEADER_FINGERPRINT_PRESETS, JSON.stringify(presets));
    return { presets };
}


async function resetPresets(): Promise<{ presets: HeaderFingerprintPreset[] }> {
    const presets = defaultPresets();
    await configService.setValue(ConfigKey.HEADER_FINGERPRINT_PRESETS, "");
    return { presets };
}


function renderHeaderTemplates(headers: Record<string, string>): Record<string, string> {
    const rendered: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
        rendered[key] = value.replaceAll(SESSION_ID_TEMPLATE, sessionId());
    }

    return rendered;
}


async function getPresetHeaders(fingerprint: string): Promise<Record<string, string>> {
    const presets = await getPresets();
    const preset = presets.find(item => item.key === fingerprint);
    if (!preset) {
        return {};
    }

    return renderHeaderTemplates(preset.headers);
}


function resolveFingerprint(
    vendor: SgVendor,
    vendorModel: SgVendorModel | null | undefined,
    upstreamFormat: ApiFormat,
    overrideFingerprint?: string | null,
): string {
    const override = normalizeFingerprint(overrideFingerprint ?? "", "");
    if (override) {
        return override;
    }

    const modelFingerprint = normalizeFingerprint(vendorModel?.getHeaderFingerprint(), "");
    return modelFingerprint || normalizeFingerprint(vendor.getHeaderFingerprint(), HeaderFingerprint.AUTO);
}


async function buildHeaders(
    vendor: SgVendor,
    vendorModel: SgVendorModel | null | undefined,
    upstreamFormat: ApiFormat,
    overrideFingerprint?: string | null,
): Promise<Record<string, string>> {
    const fingerprint = resolveFingerprint(vendor, vendorModel, upstreamFormat, overrideFingerprint);
    return await getPresetHeaders(fingerprint);
}


export default {
    buildHeaders,
    defaultPresets,
    getPresetHeaders,
    getPresets,
    normalizeModelSetting,
    normalizeOptionalSetting,
    normalizePresets,
    normalizeVendorSetting,
    resetPresets,
    resolveFingerprint,
    updatePresets,
};
