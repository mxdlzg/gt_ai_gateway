import { beforeAll, describe, expect, it } from "vitest";
import requestHelper from "../../helpers/requestHelper";
import mockHelper from "../../helpers/mockHelper";
import vendorFixtures from "../../fixtures/vendorFixtures";
import modelFixtures from "../../fixtures/modelFixtures";
import dbHelper from "../../helpers/dbHelper";
import { setupAdminUser } from "../../globalSetup";

const adminToken = "admin-token-123";
let testUserToken: string;
let modelId: number;
let modelName: string;

describe("Request Record Switch", () => {
    beforeAll(async () => {
        await dbHelper.truncate();
        await setupAdminUser();

        const userResponse = await requestHelper.post(
            "/user/create.json",
            mockHelper.generateUser(),
            adminToken,
        );
        testUserToken = userResponse.body.token;

        const vendorResponse = await requestHelper.post(
            "/vendor/create.json",
            vendorFixtures.VENDOR_FIXTURES.openai(),
            adminToken,
        );

        modelName = `record-switch-model-${Date.now()}`;
        const modelResponse = await requestHelper.post(
            "/model/create.json",
            modelFixtures.createRandomModel(vendorResponse.body.id, modelName),
            adminToken,
        );
        modelId = modelResponse.body.id;
    });

    it("should not create request records when request_record_enabled is false", async () => {
        const configResponse = await requestHelper.put(
            "/config.json",
            { request_record_enabled: "false" },
            adminToken,
        );
        expect(configResponse.status).toBe(200);

        const chatResponse = await requestHelper.post(
            "/llm/v1/chat/completions",
            mockHelper.generateOpenAIChatRequest({ model: modelName, stream: false }),
            testUserToken,
        );
        expect(chatResponse.status).toBe(200);

        const recordsResponse = await requestHelper.get(
            "/record/latest.json?limit=1",
            adminToken,
        );
        expect(recordsResponse.status).toBe(200);
        expect(recordsResponse.body).toHaveLength(0);
    }, 30000);

    it("should create request records again when request_record_enabled is true", async () => {
        const configResponse = await requestHelper.put(
            "/config.json",
            { request_record_enabled: "true" },
            adminToken,
        );
        expect(configResponse.status).toBe(200);

        const chatResponse = await requestHelper.post(
            "/llm/v1/chat/completions",
            mockHelper.generateOpenAIChatRequest({ model: modelName, stream: false }),
            testUserToken,
        );
        expect(chatResponse.status).toBe(200);

        const recordsResponse = await requestHelper.get(
            "/record/latest.json?limit=1",
            adminToken,
        );
        expect(recordsResponse.status).toBe(200);
        expect(recordsResponse.body).toHaveLength(1);
        expect(recordsResponse.body[0].model_id).toBe(modelId);
    }, 30000);

    it("should clear all request records manually", async () => {
        const clearResponse = await requestHelper.del(
            "/record/clear.json",
            adminToken,
        );

        expect(clearResponse.status).toBe(200);
        expect(clearResponse.body.success).toBe(true);
        expect(clearResponse.body.deleted).toBeGreaterThanOrEqual(1);

        const recordsResponse = await requestHelper.get(
            "/record/latest.json?limit=1",
            adminToken,
        );
        expect(recordsResponse.status).toBe(200);
        expect(recordsResponse.body).toHaveLength(0);
    });
});
