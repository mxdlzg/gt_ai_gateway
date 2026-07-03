import request from '@/utils/request';
import type { LogCleanupResponse, LogStatusResponse, OpenLogDirResponse, StatusResponse, WelcomeResponse, UpdateStatusResponse } from '@/types/system';

export function welcome(): Promise<WelcomeResponse> {
    return request.get('/welcome');
}

export function status(): Promise<StatusResponse> {
    return request.get('/status.json');
}

export function checkUpdate(force: boolean = false): Promise<UpdateStatusResponse> {
    return request.get(`/update.json${force ? '?force=1' : ''}`);
}

export function getLogStatus(): Promise<LogStatusResponse> {
    return request.get('/system/logs/status.json');
}

export function openLogDir(): Promise<OpenLogDirResponse> {
    return request.post('/system/logs/open.json');
}

export function cleanupLogs(data: { older_than_days?: number; keep_latest?: number; clear_all?: boolean } = {}): Promise<LogCleanupResponse> {
    return request.post('/system/logs/cleanup.json', data);
}
