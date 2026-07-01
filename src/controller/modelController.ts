import { Context } from "hono";
import { SgModel } from "../model/sgModel";
import { SgVendor } from "../model/sgVendor";
import modelService from "../service/modelService";
import ormService from "../service/ormService";
import customError from "../util/customError";
import { createListResponse, parsePaginationQuery } from "../util/pagination";


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


async function formatModel(model: SgModel) {
    const data = model.toData();
    const routes = await modelService.getModelRoutes(model.id);

    return {
        ...data,
        routes,
    };
}


async function formatModels(models: SgModel[]) {
    const routeMap = await modelService.getModelRoutesMap(models.map(model => model.id));

    return models.map(model => ({
        ...model.toData(),
        routes: routeMap.get(model.id) ?? [],
    }));
}


async function createModel(c: Context) {
    const body = await c.req.json();
    const { name, vendor_id, enable = true, prices = {}, vendor_model_id = null, routes } = body;
    const normalizedRoutes = Array.isArray(routes)
        ? routes
        : [{
            vendor_id,
            vendor_model_id,
            priority: 100,
            weight: 1,
            enabled: true,
        }];
    const primaryRoute = normalizedRoutes
        .filter((route: any) => route.enabled !== false)
        .sort((a: any, b: any) => Number(a.priority ?? 100) - Number(b.priority ?? 100))[0] ?? normalizedRoutes[0];

    console.log("[modelController] Creating model:", { name, vendor_id, enable, prices, vendor_model_id, routes: normalizedRoutes });

    // Validate required fields
    if (!name || !primaryRoute?.vendor_id) {
        throw new customError.AppError("Missing required fields");
    }

    // Validate vendor_id exists
    const vendor = await SgVendor.query().find(primaryRoute.vendor_id);
    if (!vendor) {
        throw new customError.NotFoundError("Vendor not found");
    }
    await modelService.validateModelRoutes(normalizedRoutes);

    // Check for duplicate enabled model
    if (enable) {
        const isDuplicate = await checkDuplicateEnabledModel(name);
        if (isDuplicate) {
            throw new customError.AppError("An enabled model with this name already exists", 409);
        }
    }

    const instance = await SgModel.query().create({
        name,
        vendor_id: primaryRoute.vendor_id,
        enable,
        prices,
        vendor_model_id: primaryRoute.vendor_model_id ?? null,
    });
    await modelService.replaceModelRoutes(instance.id, normalizedRoutes);

    console.log("[modelController] Model created successfully:", instance);
    const created = await SgModel.query().find(instance.id);
    return c.json(await formatModel(created!));
}


async function listModels(c: Context) {
    const query = c.req.query();
    const { pageSize, offset } = parsePaginationQuery(query);
    const dbQuery = SgModel.query().orderBy("id", "desc");

    if (query.vendor_id) {
        const vendorId = parseInt(query.vendor_id, 10);
        if (!isNaN(vendorId)) {
            const knex = ormService.getKnex();
            const legacyRows: { id: number }[] = await knex("model").select("id").where("vendor_id", vendorId);
            const routeRows: { model_id: number }[] = await knex("model_provider_route").select("model_id").where("vendor_id", vendorId);
            const ids = [...new Set([
                ...legacyRows.map(row => Number(row.id)),
                ...routeRows.map(row => Number(row.model_id)),
            ])];
            if (ids.length === 0) {
                return c.json(createListResponse([], 0));
            }
            dbQuery.whereIn("id", ids);
        }
    }

    if (query.keyword) {
        dbQuery.where("name", "like", `%${query.keyword}%`);
    }

    const total = Number(await dbQuery.clone().count() || 0);
    const modelConfigs = await dbQuery.limit(pageSize).offset(offset).get();
    return c.json(createListResponse(await formatModels(modelConfigs.toArray()), total));
}


async function getModel(c: Context) {
    const id = c.req.param("id");
    const modelId = parseInt(id ?? "", 10);

    if (isNaN(modelId)) {
        throw new customError.AppError("Invalid ID format");
    }

    const model = await SgModel.query().find(modelId);

    if (!model) {
        throw new customError.NotFoundError("Model not found");
    }

    return c.json(await formatModel(model));
}

async function getModelsByIds(c: Context) {
    const body = await c.req.json();
    const ids = body.ids;
    
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return c.json([]);
    }

    const idList = ids.map(id => parseInt(String(id), 10)).filter(id => !isNaN(id));
    if (idList.length === 0) {
        return c.json([]);
    }

    const models = await SgModel.query().whereIn("id", idList).get();
    return c.json(await formatModels(models.toArray()));
}


async function updateModel(c: Context) {
    const id = c.req.param("id");
    const modelId = parseInt(id ?? "", 10);

    if (isNaN(modelId)) {
        throw new customError.AppError("Invalid ID format");
    }

    const { name, vendor_id, enable, prices, vendor_model_id, routes } = await c.req.json();

    console.log("[modelController] Updating model:", {
        modelId,
        name,
        vendor_id,
        enable,
        prices,
        vendor_model_id,
        routes,
    });

    const updatedModel = await modelService.updateModel(modelId, {
        name,
        vendor_id,
        enable,
        prices,
        vendor_model_id,
        routes,
    });

    if (!updatedModel) {
        throw new customError.NotFoundError("Model not found");
    }

    console.log("[modelController] Model updated successfully:", updatedModel);
    return c.json(await formatModel(updatedModel));
}

export default {
    createModel,
    listModels,
    getModel,
    getModelsByIds,
    updateModel,
};
