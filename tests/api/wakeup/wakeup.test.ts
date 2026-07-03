import { describe, it, expect, beforeAll } from 'vitest';
import requestHelper from '../../helpers/requestHelper';
import dbHelper from '../../helpers/dbHelper';

describe('Wakeup API', () => {
    const rootToken = 'root-token-123';

    beforeAll(async () => {
        await dbHelper.truncate();
    });

    it('should create, run, toggle, list logs, and clear a wakeup job', async () => {
        const vendor = await requestHelper.post('/vendor/create.json', {
            type: 'other',
            name: 'Wakeup Test Vendor',
            token: 'test-token',
            urls: {
                openai: 'http://localhost:9999/v1/chat/completions',
            },
        }, rootToken);

        const created = await requestHelper.post('/wakeup/job/create.json', {
            name: 'Morning warmup',
            vendor_id: vendor.body.id,
            model_name: 'mock-gpt-4o',
            format: 'openai',
            mode: 'warmup',
            enabled: false,
            start_time: '08:00',
            end_time: '09:00',
            interval_min_seconds: 120,
            interval_max_seconds: 180,
            max_attempts: 3,
            daily_limit: 10,
            prompt_category: 'code',
            max_tokens: 32,
        }, rootToken);

        expect(created.status).toBe(200);
        expect(created.body.name).toBe('Morning warmup');
        expect(created.body.enabled).toBe(false);
        expect(created.body.next_run_at).toBeNull();

        const categories = await requestHelper.get('/wakeup/prompt-categories.json', rootToken);
        expect(categories.status).toBe(200);
        expect(categories.body.some((item: any) => item.value === 'self_chain')).toBe(true);

        const run = await requestHelper.post('/wakeup/job/run.json', {
            id: created.body.id,
        }, rootToken);

        expect(run.status).toBe(200);
        expect(run.body.success).toBe(true);
        expect(run.body.status).toBe(200);
        expect(run.body.job.last_status).toBe('success');
        expect(run.body.job.run_count).toBe(1);
        expect(run.body.log.success).toBe(true);
        expect(run.body.log.prompt_text.length).toBeGreaterThan(0);

        const logs = await requestHelper.get(`/wakeup/log/list.json?job_id=${created.body.id}`, rootToken);
        expect(logs.status).toBe(200);
        expect(logs.body.total).toBe(1);
        expect(logs.body.list[0].model_name).toBe('mock-gpt-4o');

        const toggled = await requestHelper.post('/wakeup/job/toggle.json', {
            id: created.body.id,
            enabled: true,
        }, rootToken);

        expect(toggled.status).toBe(200);
        expect(toggled.body.enabled).toBe(true);
        expect(toggled.body.next_run_at).not.toBeNull();

        const cleared = await requestHelper.del(`/wakeup/log/clear.json?job_id=${created.body.id}`, rootToken);
        expect(cleared.status).toBe(200);
        expect(cleared.body.deleted).toBe(1);
    });

    it('should keep alive for a configured duration after warmup success', async () => {
        const vendor = await requestHelper.post('/vendor/create.json', {
            type: 'other',
            name: 'Warmup Keepalive Vendor',
            token: 'test-token',
            urls: {
                openai: 'http://localhost:9999/v1/chat/completions',
            },
        }, rootToken);

        const created = await requestHelper.post('/wakeup/job/create.json', {
            name: 'Warmup then keepalive',
            vendor_id: vendor.body.id,
            model_name: 'mock-gpt-4o',
            format: 'openai',
            mode: 'warmup',
            enabled: true,
            start_time: '00:00',
            end_time: '23:59',
            interval_min_seconds: 120,
            interval_max_seconds: 120,
            max_attempts: 3,
            daily_limit: 10,
            after_success_keepalive_minutes: 10,
            prompt_category: 'chat',
            max_tokens: 32,
        }, rootToken);

        expect(created.status).toBe(200);
        expect(created.body.after_success_keepalive_minutes).toBe(10);

        const run = await requestHelper.post('/wakeup/job/run.json', {
            id: created.body.id,
        }, rootToken);

        expect(run.status).toBe(200);
        expect(run.body.success).toBe(true);
        expect(run.body.job.last_status).toBe('keeping_alive');
        expect(run.body.job.keepalive_until_at).not.toBeNull();
        expect(run.body.job.next_run_at).not.toBeNull();
    });

    it('should view, update, and reset built-in prompt templates', async () => {
        const settings = await requestHelper.get('/wakeup/prompt-templates.json', rootToken);

        expect(settings.status).toBe(200);
        expect(settings.body.prompts.code.length).toBeGreaterThan(0);
        expect(settings.body.defaults.chat.length).toBeGreaterThan(0);

        const updated = await requestHelper.put('/wakeup/prompt-templates.json', {
            prompts: {
                mixed: ['Mixed template for tests'],
                code: ['Code template for tests'],
                chat: ['Chat template for tests'],
                self_chain: ['Next prompt starter for tests'],
            },
        }, rootToken);

        expect(updated.status).toBe(200);
        expect(updated.body.prompts.code).toEqual(['Code template for tests']);

        const reset = await requestHelper.post('/wakeup/prompt-templates/reset.json', {}, rootToken);

        expect(reset.status).toBe(200);
        expect(reset.body.prompts.code.length).toBeGreaterThan(1);
        expect(reset.body.prompts.code).not.toEqual(['Code template for tests']);
    });
});
