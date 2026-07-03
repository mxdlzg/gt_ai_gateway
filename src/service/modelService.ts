import { SgModel } from "../model/sgModel";

import { SgVendor } from "../model/sgVendor";
import { SgVendorModel } from "../model/sgVendorModel";
import SgModelProviderRoute from "../model/sgModelProviderRoute";
import customError from "../util/customError";

export interface ModelProviderRouteInput {
    id?: number;
    vendor_id: number;
    vendor_model_id?: number | null;
    priority?: number;
    weight?: number;
    cost_weight?: number;
    enabled?: boolean;
}


function normalizePositiveInt(value: unknown, fallback: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(0, Math.floor(parsed));
}


function normalizePositiveNumber(value: unknown, fallback: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(0, parsed);
}


function normalizeRouteInput(route: ModelProviderRouteInput, index: number) {
    return {
        vendor_id: Number(route.vendor_id),
        vendor_model_id: route.vendor_model_id ? Number(route.vendor_model_id) : null,
        priority: normalizePositiveInt(route.priority, 100 + index),
        weight: Math.max(1, normalizePositiveInt(route.weight, 1)),
        cost_weight: normalizePositiveNumber(route.cost_weight, 0),
        enabled: route.enabled !== false,
    };
}


function routeToResponse(route: SgModelProviderRoute) {
    return {
        id: route.id,
        model_id: route.model_id,
        vendor_id: route.vendor_id,
        vendor_model_id: route.vendor_model_id,
        priority: route.priority,
        weight: route.weight,
        cost_weight: Number(route.cost_weight ?? 0),
        enabled: Boolean(route.enabled),
        created_at: route.created_at,
        updated_at: route.updated_at,
    };
}


async function validateRoute(route: ReturnType<typeof normalizeRouteInput>): Promise<void> {
    if (!route.vendor_id || Number.isNaN(route.vendor_id)) {
        throw new customError.AppError("Route vendor_id is required");
    }

    const vendor = await SgVendor.query().find(route.vendor_id);
    if (!vendor) {
        throw new customError.NotFoundError("Route vendor not found");
    }

    if (route.vendor_model_id) {
        const vendorModel = await SgVendorModel.query()
            .where("id", route.vendor_model_id)
            .where("vendor_id", route.vendor_id)
            .first();
        if (!vendorModel) {
            throw new customError.AppError("Route vendor_model_id does not belong to vendor");
        }
    }
}


async function replaceModelRoutes(modelId: number, routes: ModelProviderRouteInput[]): Promise<void> {
    const normalizedRoutes = routes.map(normalizeRouteInput);
    if (normalizedRoutes.length === 0) {
        throw new customError.AppError("At least one provider route is required");
    }

    await validateModelRoutes(routes);

    await SgModelProviderRoute.query().where("model_id", modelId).delete();

    for (const route of normalizedRoutes) {
        await SgModelProviderRoute.query().create({
            model_id: modelId,
            vendor_id: route.vendor_id,
            vendor_model_id: route.vendor_model_id,
            priority: route.priority,
            weight: route.weight,
            cost_weight: route.cost_weight,
            enabled: route.enabled,
        });
    }

    const primaryRoute = normalizedRoutes
        .filter(route => route.enabled)
        .sort((a, b) => a.priority - b.priority)[0] ?? normalizedRoutes[0];

    await SgModel.query()
        .where("id", modelId)
        .update({
            vendor_id: primaryRoute.vendor_id,
            vendor_model_id: primaryRoute.vendor_model_id,
        });
}


async function validateModelRoutes(routes: ModelProviderRouteInput[]): Promise<void> {
    const normalizedRoutes = routes.map(normalizeRouteInput);
    if (normalizedRoutes.length === 0) {
        throw new customError.AppError("At least one provider route is required");
    }

    for (const route of normalizedRoutes) {
        await validateRoute(route);
    }
}


async function getModelRoutes(modelId: number): Promise<ReturnType<typeof routeToResponse>[]> {
    const routes = await SgModelProviderRoute.query()
        .where("model_id", modelId)
        .orderBy("priority", "asc")
        .orderBy("id", "asc")
        .get();

    return routes.map(routeToResponse).toArray();
}


async function getModelRoutesMap(modelIds: number[]): Promise<Map<number, ReturnType<typeof routeToResponse>[]>> {
    const map = new Map<number, ReturnType<typeof routeToResponse>[]>();
    if (modelIds.length === 0) return map;

    const routes = await SgModelProviderRoute.query()
        .whereIn("model_id", modelIds)
        .orderBy("priority", "asc")
        .orderBy("id", "asc")
        .get();

    for (const route of routes) {
        const row = routeToResponse(route);
        const list = map.get(row.model_id) ?? [];
        list.push(row);
        map.set(row.model_id, list);
    }

    return map;
}


async function getModel(modelName: string, enable?: boolean): Promise<SgModel | null> {
    if (modelName == null) return null;

    const query = SgModel.query().where("name", modelName);

    // 如果 enable 参数非空，则按 enable 过滤
    if (enable !== undefined) {
        query.where("enable", enable);
    }

    return await query.first();
}


async function checkDuplicateEnabledModel(
    name: string,
    excludeId?: number,
): Promise<boolean> {
    const query = SgModel.query()
        .where("name", name)
        .where("enable", 1);
    if (excludeId) {
        query.where("id", "!=", excludeId);
    }
    const existing = await query.first();
    return !!existing;
}


async function updateModel(
    modelId: number,
    data: {
        name?: string;
        vendor_id?: number;
        enable?: boolean;
        prices?: any;
        vendor_model_id?: number | null;
        routes?: ModelProviderRouteInput[];
    },
): Promise<SgModel | null> {
    const model = await SgModel.query().find(modelId);

    if (!model) {
        return null;
    }

    const fallbackRoutes = data.routes ?? (
        data.vendor_id !== undefined
            ? [{
                vendor_id: data.vendor_id,
                vendor_model_id: data.vendor_model_id ?? null,
                priority: 100,
                weight: 1,
                cost_weight: 0,
                enabled: true,
            }]
            : null
    );

    // Validate vendor_id exists if provided through legacy fields
    if (data.vendor_id !== undefined && !fallbackRoutes) {
        const vendor = await SgVendor.query().find(data.vendor_id);
        if (!vendor) {
            return null;
        }
    }

    // Check for duplicate enabled model when enabling or changing name
    const newName = data.name ?? model.name ?? "";
    const newEnable = data.enable !== undefined ? data.enable : model.enable;

    if (newEnable) {
        const isDuplicate = await checkDuplicateEnabledModel(newName, modelId);
        if (isDuplicate) {
            throw new customError.AppError("An enabled model with this name already exists", 409);
        }
    }

    // Note: name, vendor_id, enable, input_price, output_price can be updated. The id cannot be modified.
    const updateData: Record<string, unknown> = {
        name: newName,
        vendor_id: data.vendor_id ?? model.vendor_id,
        enable: newEnable,
    };

    if (data.prices !== undefined) {
        updateData.prices = JSON.stringify(data.prices);
    }

    if ("vendor_model_id" in data) {
        updateData.vendor_model_id = data.vendor_model_id ?? null;
    }

    await SgModel.query()
        .where("id", modelId)
        .update(updateData);

    if (fallbackRoutes) {
        await replaceModelRoutes(modelId, fallbackRoutes);
    }

    return await SgModel.query().find(modelId);
}

export default {
    getModel,
    getModelRoutes,
    getModelRoutesMap,
    replaceModelRoutes,
    updateModel,
    validateModelRoutes,
};
