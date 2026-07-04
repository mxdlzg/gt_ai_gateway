import request from '../utils/request';
import type { ListResult } from '../types';
import type { Vendor, CreateVendorRequest, UpdateVendorRequest } from '../types/vendor';
import type { HeaderFingerprintValue, VendorQuery } from '../types/vendor';

export interface VendorTestResponse {
    success: boolean;
    status?: number;
    duration?: number;
    url?: string;
    converted_from?: string;
    converted_to?: string;
    request_method?: string;
    request_headers?: Record<string, string>;
    request_body?: unknown;
    proxy_url?: string | null;
    skip_tls_verify?: boolean;
    response?: unknown;
    error?: unknown;
    error_detail?: unknown;
}

export type VendorModelFetchSource = 'auto' | 'openai' | 'anthropic';

export interface VendorModelFetchResponse {
    models: string[];
    source: VendorModelFetchSource;
}

export async function listVendors(params?: VendorQuery): Promise<ListResult<Vendor>> {
    return request.get('/vendor/list.json', { params });
}

export async function fetchVendorsByIds(ids: number[]): Promise<Vendor[]> {
    return request.post('/vendor/batch.json', { ids });
}

export async function getVendor(id: number): Promise<Vendor> {
    return request.get(`/vendor/${id}`);
}

export async function createVendor(data: CreateVendorRequest): Promise<Vendor> {
    return request.post('/vendor/create.json', data);
}

export async function updateVendor(id: number, data: UpdateVendorRequest): Promise<Vendor> {
    return request.put(`/vendor/${id}`, data);
}

export async function deleteVendor(id: number): Promise<{ success: boolean }> {
    return request.delete(`/vendor/${id}`);
}

export async function listVendorModels(vendorId: number): Promise<import('../types/vendor').VendorModel[]> {
    return request.get(`/vendor/${vendorId}/model/list.json`);
}

export async function fetchVendorModelsByIds(ids: number[]): Promise<import('../types/vendor').VendorModel[]> {
    return request.post('/vendor-model/batch.json', { ids });
}

export async function fetchVendorModels(vendorId: number, source: VendorModelFetchSource = 'auto'): Promise<VendorModelFetchResponse> {
    return request.get(`/vendor/${vendorId}/model/fetch.json`, { params: { source } });
}

export async function syncVendorModels(vendorId: number, modelIds: string[]): Promise<import('../types/vendor').VendorModel[]> {
    return request.post(`/vendor/${vendorId}/model/sync.json`, { model_ids: modelIds });
}

export async function addVendorModel(
    vendorId: number,
    modelId: string,
    allowedFormats?: string[] | null,
    headerFingerprint: HeaderFingerprintValue = '',
): Promise<import('../types/vendor').VendorModel> {
    return request.post(`/vendor/${vendorId}/model/add.json`, {
        model_id: modelId,
        allowed_formats: allowedFormats,
        header_fingerprint: headerFingerprint,
    });
}

export async function updateVendorModel(
    vendorId: number,
    id: number,
    allowedFormats: string[] | null,
    headerFingerprint?: HeaderFingerprintValue,
): Promise<import('../types/vendor').VendorModel> {
    const payload: { allowed_formats: string[] | null; header_fingerprint?: HeaderFingerprintValue } = {
        allowed_formats: allowedFormats,
    };
    if (headerFingerprint !== undefined) {
        payload.header_fingerprint = headerFingerprint;
    }
    return request.put(`/vendor/${vendorId}/model/${id}`, payload);
}

export async function deleteVendorModel(vendorId: number, id: number): Promise<{ success: boolean }> {
    return request.delete(`/vendor/${vendorId}/model/${id}`);
}

export async function getVendorPresetUrls(): Promise<Record<string, Record<string, string>>> {
    return request.get('/vendor/preset-urls.json');
}


export async function testVendor(
    id: number,
    format: string = 'openai',
    model?: string,
    autoConvert: boolean = false,
    testContent?: string,
    maxTokens?: number,
): Promise<VendorTestResponse> {
    return request.post(`/vendor/${id}/test.json`, {
        format,
        model,
        auto_convert: autoConvert,
        test_content: testContent,
        max_tokens: maxTokens,
    });
}
