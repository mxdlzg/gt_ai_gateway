export interface WelcomeResponse {
    user_type?: string;
}

export interface SystemStatusInfo {
    environment?: string;
    version?: string;
    apiAddress?: string;
    bindHost?: string;
    bindPort?: string;
    configuredHost?: string;
    configuredPort?: string;
    bindRestartRequired?: boolean;
    bindEnvOverride?: boolean;
    startTime?: string;
    uptime?: string;
}

export interface SystemStatistics {
    users?: number;
    vendors?: number;
    models?: number;
    records?: number;
}

export interface StatusResponse {
    status?: string;
    mode?: string;
    user_type?: string;
    system?: SystemStatusInfo;
    statistics?: SystemStatistics;
    timestamp?: string;
}

export interface UpdateStatusResponse {
    success: boolean;
    has_update: boolean;
    current_version: string;
    latest_version: string;
    release_url?: string;
    release_notes?: string;
    error_message?: string;
}

export interface LogFileInfo {
    name: string;
    path: string;
    size: number;
    modified_at: string;
}

export interface LogStatusResponse {
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

export interface LogCleanupResponse {
    success: boolean;
    deleted: number;
    error?: string;
}

export interface OpenLogDirResponse {
    success: boolean;
    path?: string;
    error?: string;
}

export interface BindConfigResponse {
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
