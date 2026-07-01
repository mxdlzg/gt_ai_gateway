import type { BaseEntity, TableQuery } from './index';

export interface Model extends BaseEntity {
    name: string;
    vendor_id: number;
    vendor_model_id: number | null;
    enable: boolean;
    routes?: ModelProviderRoute[];
    prices?: {
        input?: number;
        output?: number;
        cache_read?: number;
    } | null;
}

export interface ModelProviderRoute extends BaseEntity {
    model_id: number;
    vendor_id: number;
    vendor_model_id: number | null;
    priority: number;
    weight: number;
    enabled: boolean;
}

export interface ModelProviderRouteInput {
    vendor_id: number;
    vendor_model_id?: number | null;
    priority?: number;
    weight?: number;
    enabled?: boolean;
}

export interface CreateModelRequest {
    name: string;
    vendor_id?: number;
    enable?: boolean;
    prices?: {
        input?: number;
        output?: number;
        cache_read?: number;
    } | null;
    vendor_model_id?: number | null;
    routes?: ModelProviderRouteInput[];
}

export interface UpdateModelRequest {
    name?: string;
    vendor_id?: number;
    enable?: boolean;
    prices?: {
        input?: number;
        output?: number;
        cache_read?: number;
    } | null;
    vendor_model_id?: number | null;
    routes?: ModelProviderRouteInput[];
}

export interface ModelQuery extends TableQuery {
    vendor_id?: number;
}
