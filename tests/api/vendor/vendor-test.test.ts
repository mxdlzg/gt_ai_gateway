import { describe, it, expect, beforeAll } from 'vitest';
import requestHelper from '../../helpers/requestHelper';
import dbHelper from '../../helpers/dbHelper';

describe('Vendor Test API', () => {
    let rootToken = 'root-token-123';

    beforeAll(async () => {
        await dbHelper.truncate();
    });

    it('should test vendor connectivity (OpenAI format)', async () => {
        // Create a vendor pointing to our mock server
        const vendor = await requestHelper.post('/vendor/create.json', {
            type: 'other',
            name: 'Test Vendor',
            token: 'test-token',
            urls: {
                openai: 'http://localhost:9999/v1/chat/completions'
            }
        }, rootToken);

        const response = await requestHelper.post(`/vendor/${vendor.body.id}/test.json`, {
            format: 'openai',
            model: 'gpt-4'
        }, rootToken);

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body).toHaveProperty('duration');
        expect(response.body).toHaveProperty('status', 200);
        expect(response.body.request_body.messages[0].role).toBe('user');
        expect(response.body.request_body.messages[0].content).toContain('连接测试成功');
        expect(response.body.request_body.max_tokens).toBe(64);
        expect(response.body.request_body.stream).toBe(false);
    });

    it('should test vendor connectivity with custom model', async () => {
        const vendor = await requestHelper.post('/vendor/create.json', {
            type: 'other',
            name: 'Custom Model Vendor',
            token: 'test-token',
            urls: {
                openai: 'http://localhost:9999/v1/chat/completions'
            }
        }, rootToken);

        const response = await requestHelper.post(`/vendor/${vendor.body.id}/test.json`, {
            format: 'openai',
            model: 'special-model-123'
        }, rootToken);

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
    });

    it('should test vendor connectivity with custom test content', async () => {
        const vendor = await requestHelper.post('/vendor/create.json', {
            type: 'other',
            name: 'Custom Content Vendor',
            token: 'test-token',
            urls: {
                openai: 'http://localhost:9999/v1/chat/completions'
            }
        }, rootToken);

        const response = await requestHelper.post(`/vendor/${vendor.body.id}/test.json`, {
            format: 'openai',
            model: 'gpt-4',
            test_content: '请回答 2+2 的结果',
            max_tokens: 128
        }, rootToken);

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.request_body.messages[0].content).toBe('请回答 2+2 的结果');
        expect(response.body.request_body.max_tokens).toBe(128);
    });

    it('should test vendor connectivity (Anthropic format)', async () => {
        const vendor = await requestHelper.post('/vendor/create.json', {
            type: 'other',
            name: 'Test Anthropic',
            token: 'test-token',
            urls: {
                anthropic: 'http://localhost:9999/v1/messages'
            }
        }, rootToken);

        const response = await requestHelper.post(`/vendor/${vendor.body.id}/test.json`, {
            format: 'anthropic',
            model: 'claude-3-opus'
        }, rootToken);

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body).toHaveProperty('status', 200);
        expect(response.body.request_body.messages[0].content).toContain('连接测试成功');
        expect(response.body.request_body.max_tokens).toBe(64);
    });

    it('should return failure for invalid URL', async () => {
        const vendor = await requestHelper.post('/vendor/create.json', {
            type: 'other',
            name: 'Invalid URL Vendor',
            token: 'test-token',
            urls: {
                openai: 'http://localhost:12345/invalid' // Non-existent port
            }
        }, rootToken);

        const response = await requestHelper.post(`/vendor/${vendor.body.id}/test.json`, {
            format: 'openai'
        }, rootToken);

        // fetch will throw, our controller returns 500
        expect(response.status).toBe(500);
        expect(response.body.success).toBe(false);
        expect(response.body).toHaveProperty('error');
        expect(response.body.error).toContain('fetch failed');
        expect(response.body).toHaveProperty('error_detail');
        expect(response.body.error_detail).toHaveProperty('message');
        expect(response.body.error_detail).toHaveProperty('cause');
    });
});
