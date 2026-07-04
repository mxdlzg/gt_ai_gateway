import type { BaseEntity, TableQuery } from './index';

export type VendorType = 'openai' | 'anthropic' | 'google' | 'aliyun' | 'aliyun_coding' | 'volcengine_coding' | 'deepseek' | 'mimo' | 'mimo_token_plan' | 'opencode_go' | 'other';

export interface VendorUrls {
    [key: string]: string;
}

export interface VendorHeaders {
    [key: string]: string;
}

export type HeaderFingerprintValue = string;

export interface Vendor extends BaseEntity {
    type: VendorType;
    name: string;
    token: string;
    urls: VendorUrls;
    headers: VendorHeaders;
    header_fingerprint: HeaderFingerprintValue;
    proxy_url: string;
    skip_tls_verify: boolean;
    model_count: number;
}

export interface CreateVendorRequest {
    type: VendorType;
    name: string;
    token: string;
    urls?: VendorUrls;
    headers?: VendorHeaders;
    header_fingerprint?: HeaderFingerprintValue;
    proxy_url?: string;
    skip_tls_verify?: boolean;
}

export interface UpdateVendorRequest {
    type?: VendorType;
    name?: string;
    token?: string;
    urls?: VendorUrls;
    headers?: VendorHeaders;
    header_fingerprint?: HeaderFingerprintValue;
    proxy_url?: string;
    skip_tls_verify?: boolean;
}

export interface VendorQuery extends TableQuery {
    type?: VendorType;
}

export interface VendorModel {
    id: number;
    vendor_id: number;
    model_id: string;
    allowed_formats: string[] | null;
    header_fingerprint: HeaderFingerprintValue;
    created_at: string;
    updated_at: string;
}
