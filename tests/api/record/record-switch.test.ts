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

    it("should respect request record content switches", async () => {
        const configResponse = await requestHelper.put(
            "/config.json",
            {
                request_record_enabled: "true",
                request_record_request_body_enabled: "false",
                request_record_response_body_enabled: "false",
                request_record_headers_enabled: "false",
            },
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
        const record = recordsResponse.body[0];
        expect(record.request_data).toBeNull();
        expect(record.response_data).toBeNull();
        expect(record.request_headers).toBeNull();
        expect(record.status).toBe("success");

        await requestHelper.put(
            "/config.json",
            {
                request_record_request_body_enabled: "true",
                request_record_response_body_enabled: "true",
                request_record_headers_enabled: "true",
            },
            adminToken,
        );
    }, 30000);

    it("should redact sensitive fields without redacting token statistics", async () => {
        const configResponse = await requestHelper.put(
            "/config.json",
            {
                request_record_enabled: "true",
                request_record_request_body_enabled: "true",
                request_record_response_body_enabled: "true",
                request_record_headers_enabled: "true",
                request_record_redaction_enabled: "true",
                request_record_redaction_keys: "secret,token",
            },
            adminToken,
        );
        expect(configResponse.status).toBe(200);

        const request = {
            ...mockHelper.generateOpenAIChatRequest({ model: modelName, stream: false }),
            metadata: {
                client_secret: "hidden-value",
                prompt_tokens: 123,
            },
        };

        const chatResponse = await requestHelper.post(
            "/llm/v1/chat/completions",
            request,
            testUserToken,
        );
        expect(chatResponse.status).toBe(200);

        const recordsResponse = await requestHelper.get(
            "/record/latest.json?limit=1",
            adminToken,
        );
        const requestData = JSON.parse(recordsResponse.body[0].request_data);
        expect(requestData.metadata.client_secret).toBe("[REDACTED]");
        expect(requestData.metadata.prompt_tokens).toBe(123);
    }, 30000);

    it("should cleanup request records by retention policy", async () => {
        await requestHelper.del("/record/clear.json", adminToken);
        await requestHelper.put(
            "/config.json",
            {
                request_record_enabled: "true",
                request_record_retention_days: "0",
                request_record_max_count: "1",
            },
            adminToken,
        );

        for (let i = 0; i < 3; i++) {
            const chatResponse = await requestHelper.post(
                "/llm/v1/chat/completions",
                mockHelper.generateOpenAIChatRequest({ model: modelName, stream: false }),
                testUserToken,
            );
            expect(chatResponse.status).toBe(200);
        }

        const cleanupResponse = await requestHelper.post(
            "/record/cleanup.json",
            {},
            adminToken,
        );
        expect(cleanupResponse.status).toBe(200);
        expect(cleanupResponse.body.success).toBe(true);
        expect(cleanupResponse.body.deleted).toBe(2);

        const recordsResponse = await requestHelper.get(
            "/record/latest.json?limit=10",
            adminToken,
        );
        expect(recordsResponse.status).toBe(200);
        expect(recordsResponse.body).toHaveLength(1);

        await requestHelper.put(
            "/config.json",
            {
                request_record_max_count: "0",
            },
            adminToken,
        );
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
