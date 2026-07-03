import request from '../utils/request';
import type { ConfigMap, UpdateConfigRequest } from '../types/config';

export async function getConfig(): Promise<ConfigMap> {
    return request.get('/config.json');
}

export async function updateConfig(data: UpdateConfigRequest): Promise<ConfigMap> {
    return request.put('/config.json', data);
}

export interface ProxyTestResponse {
    success: boolean;
    status?: number;
    duration?: number;
    proxy_url?: string | null;
    target_url?: string;
    response_preview?: string;
    error?: string;
    error_detail?: unknown;
}

export async function testProxy(proxyUrl?: string): Promise<ProxyTestResponse> {
    return request.post('/config/proxy/test.json', {
        proxy_url: proxyUrl?.trim() || undefined,
    });
}

export interface NotificationTestResponse {
    success: boolean;
    platform: string;
    error?: string;
}

export async function testNotification(): Promise<NotificationTestResponse> {
    return request.post('/config/notification/test.json');
}
