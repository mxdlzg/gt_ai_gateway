import axios, { AxiosError } from 'axios';
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import { getAuthToken } from './authSession';
import { notifyRequestError } from './requestFeedback';
import { normalizeAxiosError } from './requestError';

export const DEFAULT_REQUEST_TIMEOUT_MS = 120000;

function normalizeRequestTimeoutMs(value: unknown): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return DEFAULT_REQUEST_TIMEOUT_MS;
    }
    return Math.floor(parsed);
}

const instance: AxiosInstance = axios.create({
    baseURL: import.meta.env.VITE_API_BASE_URL || (import.meta.env.DEV ? '/api' : ''),
    timeout: DEFAULT_REQUEST_TIMEOUT_MS,
    headers: {
        'Content-Type': 'application/json',
    },
});

/**
 * 在 Tauri 环境下，运行时动态更新 baseURL。
 * 由 main.ts 在应用初始化时调用一次。
 */
export function setBaseURL(url: string) {
    instance.defaults.baseURL = url;
}

export function getBaseURL(): string {
    return instance.defaults.baseURL as string || window.location.origin;
}

export function setRequestTimeoutMs(value: unknown): number {
    const timeout = normalizeRequestTimeoutMs(value);
    instance.defaults.timeout = timeout;
    return timeout;
}

export function getRequestTimeoutMs(): number {
    return normalizeRequestTimeoutMs(instance.defaults.timeout);
}

instance.interceptors.request.use(
    (config: InternalAxiosRequestConfig) => {
        const token = getAuthToken();
        if (token && config.headers) {
            config.headers['Authorization'] = `Bearer ${token}`;
        }
        return config;
    },
    (error) => {
        return Promise.reject(error);
    }
);

instance.interceptors.response.use(
    (response) => {
        return response.data;
    },
    (error: AxiosError<unknown>) => {
        const requestError = normalizeAxiosError(error);
        notifyRequestError(requestError);
        return Promise.reject(requestError);
    }
);

export default instance;
