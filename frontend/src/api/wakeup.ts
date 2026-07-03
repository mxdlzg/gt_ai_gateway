import request from '@/utils/request';
import type { ListResult } from '@/types';
import type {
    WakeupJob,
    WakeupJobPayload,
    WakeupJobQuery,
    WakeupLog,
    WakeupLogQuery,
    WakeupPromptCategoryOption,
    WakeupPromptTemplateMap,
    WakeupPromptTemplateSettings,
    WakeupRunResponse,
} from '@/types/wakeup';

export function listWakeupJobs(params?: WakeupJobQuery): Promise<ListResult<WakeupJob>> {
    return request.get('/wakeup/job/list.json', { params });
}

export function getWakeupJob(id: number): Promise<WakeupJob> {
    return request.get('/wakeup/job/detail.json', { params: { id } });
}

export function createWakeupJob(data: WakeupJobPayload): Promise<WakeupJob> {
    return request.post('/wakeup/job/create.json', data);
}

export function updateWakeupJob(id: number, data: WakeupJobPayload): Promise<WakeupJob> {
    return request.put('/wakeup/job/update.json', { ...data, id });
}

export function deleteWakeupJob(id: number): Promise<{ success: boolean }> {
    return request.delete('/wakeup/job/delete.json', { params: { id } });
}

export function toggleWakeupJob(id: number, enabled: boolean): Promise<WakeupJob> {
    return request.post('/wakeup/job/toggle.json', { id, enabled });
}

export function runWakeupJob(id: number): Promise<WakeupRunResponse> {
    return request.post('/wakeup/job/run.json', { id });
}

export function listWakeupLogs(params?: WakeupLogQuery): Promise<ListResult<WakeupLog>> {
    return request.get('/wakeup/log/list.json', { params });
}

export function clearWakeupLogs(jobId?: number): Promise<{ success: boolean; deleted: number }> {
    return request.delete('/wakeup/log/clear.json', { params: jobId ? { job_id: jobId } : undefined });
}

export function getWakeupPromptCategories(): Promise<WakeupPromptCategoryOption[]> {
    return request.get('/wakeup/prompt-categories.json');
}

export function getWakeupPromptTemplates(): Promise<WakeupPromptTemplateSettings> {
    return request.get('/wakeup/prompt-templates.json');
}

export function updateWakeupPromptTemplates(prompts: WakeupPromptTemplateMap): Promise<WakeupPromptTemplateSettings> {
    return request.put('/wakeup/prompt-templates.json', { prompts });
}

export function resetWakeupPromptTemplates(): Promise<WakeupPromptTemplateSettings> {
    return request.post('/wakeup/prompt-templates/reset.json');
}
