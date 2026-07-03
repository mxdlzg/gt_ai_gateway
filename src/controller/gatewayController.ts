import { Context } from "hono";
import modelService from "../service/modelService";
import userService from "../service/userService";
import sender from "../service/senderService";
import { SgModel } from "../model/sgModel";
import { SgUser } from "../model/sgUser";
import { ApiFormat, UserStatus } from "../constants";
import customError from "../util/customError";

async function getUserByBearerToken(c: Context): Promise<SgUser> {
    const authHeader = c.req.header("Authorization");

    if (!authHeader) {
        throw new customError.AppError("Authorization header is missing", 401, "authentication_error");
    }

    if (!authHeader.startsWith("Bearer ")) {
        throw new customError.AppError("Invalid token format", 401, "authentication_error");
    }

    const token = authHeader.split(" ")[1];
    const user = await userService.getUserByToken(token!, c.env.ROOT_TOKEN);

    if (user == null) {
        throw new customError.AppError("Invalid token (user not found)", 401, "authentication_error");
    }

    if (user.status === UserStatus.DISABLED) {
        throw new customError.AppError("User disabled", 403, "authentication_error");
    }

    return user;
}

async function chatCompletions(c: Context) {
    c.set("api_format", ApiFormat.OPENAI);
    const body: string = await c.req.text();

    //获取用户
    const user = await getUserByBearerToken(c);

    //解析请求
    const bodyDict = JSON.parse(body);

    //获取后端模型配置
    const modelName = bodyDict.model;
    console.log("[gatewayController] OpenAI chat request:", { model: modelName, user_id: user.id });
    const modelConfig: SgModel | null = await modelService.getModel(modelName, true);

    if (modelConfig == null) {
        throw new customError.NotFoundError("model not found");
    }

    return sender.sendRequest(c, user!, modelConfig!, ApiFormat.OPENAI, body);
}

async function anthropicMessages(c: Context) {
    c.set("api_format", ApiFormat.ANTHROPIC);
    const body: string = await c.req.text();

    //获取用户
    const apiKey = c.req.header("x-api-key");
    let token = apiKey;

    if (!token) {
        // 退一步检查 Authorization header 是否以 "Bearer " 开头
        const authHeader = c.req.header("Authorization");
        if (authHeader && authHeader.startsWith("Bearer ")) {
            token = authHeader.split(" ")[1];
        }
    }

    if (!token) {
        throw new customError.AppError("x-api-key or Authorization header is missing", 401, "authentication_error");
    }

    const user = await userService.getUserByToken(token!, c.env.ROOT_TOKEN);

    if (user == null) {
        throw new customError.AppError("Invalid token (user not found)", 401, "authentication_error");
    }

    if (user.status === UserStatus.DISABLED) {
        throw new customError.AppError("User disabled", 403, "authentication_error");
    }

    //解析请求
    const bodyDict = JSON.parse(body);

    //获取后端模型配置
    const modelName = bodyDict.model;
    console.log("[gatewayController] Anthropic messages request:", { model: modelName, user_id: user.id });
    const modelConfig: SgModel | null = await modelService.getModel(modelName, true);

    if (modelConfig == null) {
        throw new customError.NotFoundError("model not found");
    }

    return sender.sendRequest(c, user, modelConfig, ApiFormat.ANTHROPIC, body);
}

async function responsesApi(c: Context) {
    c.set("api_format", ApiFormat.RESPONSES);
    const body: string = await c.req.text();

    const user = await getUserByBearerToken(c);

    const bodyDict = JSON.parse(body);
    const modelName = bodyDict.model;
    console.log("[gatewayController] Responses request:", { model: modelName, user_id: user.id });
    const modelConfig: SgModel | null = await modelService.getModel(modelName, true);
    if (modelConfig == null) {
        throw new customError.NotFoundError("model not found");
    }

    return sender.sendRequest(c, user!, modelConfig!, ApiFormat.RESPONSES, body);
}

async function listModels(c: Context) {
    c.set("api_format", ApiFormat.OPENAI);
    await getUserByBearerToken(c);

    const models = await SgModel.query()
        .where("enable", 1)
        .orderBy("name", "asc")
        .get();

    const modelList = models.toArray() as SgModel[];

    return c.json({
        object: "list",
        data: modelList.map(model => ({
            id: model.name,
            object: "model",
            created: 0,
            owned_by: "gt-ai-gateway",
        })),
    });
}

export default {
    chatCompletions,
    anthropicMessages,
    responsesApi,
    listModels,
};
