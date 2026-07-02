import { ApiFormat, HeaderFingerprint } from "../constants";
import { SgVendor } from "../model/sgVendor";
import { SgVendorModel } from "../model/sgVendorModel";

const SENSITIVE_HEADER_KEYS = [
    "authorization",
    "x-api-key",
    "api-key",
    "content-length",
    "host",
];

const CLAUDE_BETA = "claude-code-20250219,context-1m-2025-08-07,interleaved-thinking-2025-05-14,mid-conversation-system-2026-04-07,context-1m-2025-08-07,effort-2025-11-24";


function normalizeFingerprint(
    value: string | null | undefined,
    fallback: HeaderFingerprint | "",
): HeaderFingerprint | "" {
    if (!value) {
        return fallback;
    }

    const normalized = value.trim();
    if (normalized === "inherit") {
        return "";
    }

    const allowed = Object.values(HeaderFingerprint) as string[];
    if (allowed.includes(normalized)) {
        return normalized as HeaderFingerprint;
    }

    return fallback;
}


function normalizeVendorSetting(value: unknown): HeaderFingerprint {
    const normalized = normalizeFingerprint(typeof value === "string" ? value : null, HeaderFingerprint.AUTO);
    return normalized || HeaderFingerprint.AUTO;
}


function normalizeModelSetting(value: unknown): HeaderFingerprint | "" {
    return normalizeFingerprint(typeof value === "string" ? value : null, "");
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
        "x-claude-code-session-id": sessionId(),
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


function getPresetHeaders(fingerprint: HeaderFingerprint): Record<string, string> {
    if (fingerprint === HeaderFingerprint.CLAUDE_CLI) {
        return sanitizePresetHeaders(getClaudeCliHeaders());
    }

    if (fingerprint === HeaderFingerprint.CODEX_CLI) {
        return sanitizePresetHeaders(getCodexCliHeaders());
    }

    return {};
}


function resolveFingerprint(
    vendor: SgVendor,
    vendorModel: SgVendorModel | null | undefined,
    upstreamFormat: ApiFormat,
): HeaderFingerprint {
    const modelFingerprint = normalizeFingerprint(vendorModel?.getHeaderFingerprint(), "");
    return (modelFingerprint || normalizeFingerprint(vendor.getHeaderFingerprint(), HeaderFingerprint.AUTO)) as HeaderFingerprint;
}


function buildHeaders(
    vendor: SgVendor,
    vendorModel: SgVendorModel | null | undefined,
    upstreamFormat: ApiFormat,
): Record<string, string> {
    const fingerprint = resolveFingerprint(vendor, vendorModel, upstreamFormat);
    return getPresetHeaders(fingerprint);
}


export default {
    buildHeaders,
    getPresetHeaders,
    normalizeModelSetting,
    normalizeVendorSetting,
    resolveFingerprint,
};
