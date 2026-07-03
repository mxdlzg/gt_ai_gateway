import { Context } from "hono";
import configService, { ConfigKey } from "../service/configService";
import hostService from "../service/hostService";
import senderService from "../service/senderService";
import ormService from "../service/ormService";
import desktopNotificationService from "../service/desktopNotificationService";
import logService from "../service/logService";

async function getConfig(c: Context) {
    await hostService.getHostKey();
    return c.json(await configService.getAll());
}

async function updateConfig(c: Context) {
    const body = await c.req.json();
    const result = await configService.updateAll(body);
    await logService.applyRuntimeConfig();
    return c.json(result);
}

async function testProxy(c: Context) {
    const body = await c.req.json().catch(() => ({}));
    const configuredProxyUrl = (await configService.getConfig(ConfigKey.UPSTREAM_PROXY_URL, "")).getString().trim();
    const proxyUrl = typeof body.proxy_url === "string" && body.proxy_url.trim()
        ? body.proxy_url.trim()
        : configuredProxyUrl;
    const targetUrl = typeof body.target_url === "string" && body.target_url.trim()
        ? body.target_url.trim()
        : "https://api.openai.com/v1/models";

    if (proxyUrl && !ormService.isNode) {
        return c.json({
            success: false,
            error: "Proxy testing is only supported in Node mode",
            proxy_url: proxyUrl,
            target_url: targetUrl,
        }, 400);
    }

    const startTime = Date.now();
    try {
        const response = await senderService.fetchWithProxyUrl(targetUrl, {
            method: "GET",
            headers: {
                "User-Agent": "gt-ai-gateway-proxy-test",
            },
            signal: c.req.raw.signal,
        }, proxyUrl);
        const duration = Date.now() - startTime;
        const text = await response.text().catch(() => "");

        return c.json({
            success: true,
            status: response.status,
            duration,
            proxy_url: proxyUrl || null,
            target_url: targetUrl,
            response_preview: text.slice(0, 500),
        });
    } catch (error) {
        return c.json({
            success: false,
            error: senderService.formatFetchError(error),
            error_detail: senderService.serializeFetchError(error),
            duration: Date.now() - startTime,
            proxy_url: proxyUrl || null,
            target_url: targetUrl,
        }, 500);
    }
}


async function testNotification(c: Context) {
    return c.json(await desktopNotificationService.test());
}

export default {
    getConfig,
    testNotification,
    updateConfig,
    testProxy,
};
