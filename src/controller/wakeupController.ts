import { Context } from "hono";
import customError from "../util/customError";
import wakeupService from "../service/wakeupService";
import wakeupPromptService from "../service/wakeupPromptService";

function parseId(value: string | undefined | null): number {
    const id = Number(value);
    if (!Number.isInteger(id) || id <= 0) {
        throw new customError.AppError("Invalid ID format", 400);
    }

    return id;
}


async function listJobs(c: Context) {
    return c.json(await wakeupService.listJobs(c.req.query()));
}


async function getJob(c: Context) {
    const id = parseId(c.req.query("id"));
    const job = await wakeupService.getJob(id);
    if (!job) {
        throw new customError.AppError("Wakeup job not found", 404);
    }

    return c.json(job);
}


async function createJob(c: Context) {
    const body = await c.req.json();
    return c.json(await wakeupService.createJob(body));
}


async function updateJob(c: Context) {
    const body = await c.req.json();
    const id = parseId(body.id);
    return c.json(await wakeupService.updateJob(id, body));
}


async function deleteJob(c: Context) {
    const id = parseId(c.req.query("id"));
    return c.json(await wakeupService.deleteJob(id));
}


async function toggleJob(c: Context) {
    const body = await c.req.json();
    const id = parseId(body.id);
    return c.json(await wakeupService.toggleJob(id, body.enabled !== false));
}


async function runJob(c: Context) {
    const body = await c.req.json();
    const id = parseId(body.id);
    return c.json(await wakeupService.runJobNow(id));
}


async function listLogs(c: Context) {
    return c.json(await wakeupService.listLogs(c.req.query()));
}


async function clearLogs(c: Context) {
    const rawId = c.req.query("job_id");
    const jobId = rawId ? parseId(rawId) : null;
    return c.json(await wakeupService.clearLogs(jobId));
}


async function getPromptCategories(c: Context) {
    return c.json(wakeupPromptService.getCategories());
}


async function getPromptTemplates(c: Context) {
    return c.json(await wakeupPromptService.getPromptTemplateSettings());
}


async function updatePromptTemplates(c: Context) {
    const body = await c.req.json();
    return c.json(await wakeupPromptService.updatePromptTemplates(body));
}


async function resetPromptTemplates(c: Context) {
    return c.json(await wakeupPromptService.resetPromptTemplates());
}


export default {
    clearLogs,
    createJob,
    deleteJob,
    getJob,
    getPromptCategories,
    getPromptTemplates,
    listJobs,
    listLogs,
    runJob,
    resetPromptTemplates,
    toggleJob,
    updatePromptTemplates,
    updateJob,
};
