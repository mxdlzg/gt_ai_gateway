import { beforeEach, describe, it, expect } from "vitest";
import requestHelper from "../../helpers/requestHelper";
import dbHelper from "../../helpers/dbHelper";

const ROOT_TOKEN = "root-token-123";

describe("Config API", () => {
    beforeEach(async () => {
        await dbHelper.truncate();
    });

    it("should return advanced config with request rewrite features disabled by default", async () => {
        const response = await requestHelper.get("/config.json", ROOT_TOKEN);

        expect(response.body).toBeDefined();
        expect(response.body.cch_rewrite_enabled).toBeUndefined();
        expect(response.body.responses_prompt_cache_key_enabled).toBeUndefined();
    });

    it("should update config values and return updated config", async () => {
        const updateResponse = await requestHelper.put(
            "/config.json",
            { 
                cch_rewrite_enabled: "true",
                responses_prompt_cache_key_enabled: "true",
            },
            ROOT_TOKEN,
        );

        expect(updateResponse.status).toBe(200);
        expect(updateResponse.body.cch_rewrite_enabled).toBe("true");
        expect(updateResponse.body.responses_prompt_cache_key_enabled).toBe("true");

        // Verify it persists by getting it again
        const getResponse = await requestHelper.get("/config.json", ROOT_TOKEN);
        expect(getResponse.status).toBe(200);
        expect(getResponse.body.cch_rewrite_enabled).toBe("true");
        expect(getResponse.body.responses_prompt_cache_key_enabled).toBe("true");
    });

    it("should test upstream proxy connectivity against a target URL", async () => {
        const response = await requestHelper.post(
            "/config/proxy/test.json",
            {
                target_url: "http://localhost:9999/v1/models",
            },
            ROOT_TOKEN,
        );

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.status).toBe(200);
        expect(response.body.target_url).toBe("http://localhost:9999/v1/models");
        expect(response.body).toHaveProperty("duration");
    });
});
