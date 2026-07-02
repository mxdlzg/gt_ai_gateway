<template>
    <div class="advanced-settings">
        <div class="page-header">
            <h2 class="page-title">高级设置</h2>
        </div>

        <a-spin :spinning="loading">
            <div class="settings-section">
                <h3 class="section-title">请求处理</h3>
                <div class="settings-list">
                    <div class="setting-item">
                        <div class="setting-info">
                            <div class="setting-title">屏蔽 Claude Code 跟踪</div>
                            <div class="setting-desc">启用后，系统会自动清洗 Claude Code 发送的隐藏的地区/时区/公司跟踪标记，避免污染用户真实数据与缓存特征</div>
                        </div>
                        <div class="setting-action">
                            <a-switch
                                v-model:checked="form.claude_code_tracking_rewrite_enabled"
                                :disabled="saving"
                            />
                        </div>
                    </div>
                    <div class="setting-item">
                        <div class="setting-info">
                            <div class="setting-title">强制改写 CCH</div>
                            <div class="setting-desc">启用后，系统会自动修改 claudecode 请求体中的 cch 值为默认固定值，用于修复无法命中缓存问题</div>
                        </div>
                        <div class="setting-action">
                            <a-switch
                                v-model:checked="form.cch_rewrite_enabled"
                                :disabled="saving"
                            />
                        </div>
                    </div>
                    <div class="setting-item">
                        <div class="setting-info">
                            <div class="setting-title">Responses API 粘性路由</div>
                            <div class="setting-desc">启用后，会在 Responses API 请求中自动注入 prompt_cache_key，优化缓存命中率</div>
                        </div>
                        <div class="setting-action">
                            <a-switch
                                v-model:checked="form.responses_prompt_cache_key_enabled"
                                :disabled="saving"
                            />
                        </div>
                    </div>
                </div>
            </div>


            <div class="settings-section">
                <h3 class="section-title">网络代理</h3>
                <div class="settings-list">
                    <div class="setting-item">
                        <div class="setting-info">
                            <div class="setting-title">全局上游代理</div>
                            <div class="setting-desc">用于请求上游供应商的代理地址。留空则直连；供应商单独配置后会优先使用供应商代理。</div>
                        </div>
                        <div class="setting-action setting-input">
                            <a-input-group compact>
                                <a-input
                                    v-model:value="form.upstream_proxy_url"
                                    :disabled="saving"
                                    allow-clear
                                    placeholder="例如：http://127.0.0.1:7890"
                                    style="width: calc(100% - 72px)"
                                />
                                <a-button
                                    :loading="testingProxy"
                                    :disabled="saving"
                                    @click="handleTestProxy"
                                >
                                    测试
                                </a-button>
                            </a-input-group>
                            <div v-if="proxyTestResult" :class="['proxy-test-result', proxyTestResult.success ? 'success' : 'error']">
                                {{ proxyTestText }}
                            </div>
                        </div>
                    </div>
                    <div class="setting-item">
                        <div class="setting-info">
                            <div class="setting-title">请求记录</div>
                            <div class="setting-desc">启用后，会保存 LLM 请求的元数据、请求内容、响应内容、用量和耗时；关闭后新请求不再写入请求记录</div>
                        </div>
                        <div class="setting-action">
                            <a-switch
                                v-model:checked="form.request_record_enabled"
                                :disabled="saving"
                            />
                        </div>
                    </div>
                    <div class="setting-item">
                        <div class="setting-info">
                            <div class="setting-title">测试请求超时</div>
                            <div class="setting-desc">供应商连通性、模型可用性和 API 测试请求等待上游响应的最长时间</div>
                        </div>
                        <div class="setting-action setting-number">
                            <a-input-number
                                v-model:value="form.test_request_timeout_seconds"
                                :disabled="saving"
                                :min="10"
                                :max="600"
                                :step="10"
                                addon-after="秒"
                                style="width: 160px"
                            />
                        </div>
                    </div>
                </div>
            </div>


            <div class="settings-section">
                <h3 class="section-title">系统更新</h3>
                <div class="settings-list">
                    <div class="setting-item">
                        <div class="setting-info">
                            <div class="setting-title">自动检测更新</div>
                            <div class="setting-desc">
                                当前版本：v{{ currentVersion }}
                                <span v-if="hasUpdate" style="color: var(--accent-primary); margin-left: 8px;">
                                    (发现新版本：{{ latestVersion }})
                                </span>
                                <span v-else-if="checkedUpdate" style="color: var(--text-secondary); margin-left: 8px;">
                                    (已是最新版本)
                                </span>
                            </div>
                        </div>
                        <div class="setting-action">
                            <a-button 
                                v-if="hasUpdate" 
                                type="primary" 
                                @click="openUpdateUrl"
                            >
                                下载更新
                            </a-button>
                            <a-button v-else :loading="checkingUpdate" @click="doCheckUpdate">
                                检查更新
                            </a-button>
                        </div>
                    </div>
                </div>
            </div>

            <div class="page-actions">
                <a-button style="margin-right: 12px" :disabled="!isDirty || saving" @click="cancelChanges">
                    取消修改
                </a-button>
                <a-button type="primary" :loading="saving" :disabled="!isDirty" @click="saveConfig">
                    保存配置
                </a-button>
            </div>
        </a-spin>
    </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref, computed } from 'vue';
import { message } from 'ant-design-vue/es';
import { getConfig, testProxy, updateConfig } from '@/api/config';
import type { ProxyTestResponse } from '@/api/config';
import { checkUpdate } from '@/api/system';
import { useAppStore } from '@/stores/app';
import { DEFAULT_REQUEST_TIMEOUT_MS, setRequestTimeoutMs } from '@/utils/request';

const appStore = useAppStore();
const currentVersion = computed(() => appStore.version);
const checkingUpdate = ref(false);
const checkedUpdate = ref(false);
const hasUpdate = ref(false);
const updateUrl = ref('');
const latestVersion = ref('');

const loading = ref(false);
const saving = ref(false);
const testingProxy = ref(false);
const proxyTestResult = ref<ProxyTestResponse | null>(null);

const originalConfig = reactive({
    cch_rewrite_enabled: false,
    responses_prompt_cache_key_enabled: false,
    claude_code_tracking_rewrite_enabled: true,
    request_record_enabled: true,
    upstream_proxy_url: '',
    test_request_timeout_seconds: DEFAULT_REQUEST_TIMEOUT_MS / 1000,
});

const form = reactive({
    cch_rewrite_enabled: false,
    responses_prompt_cache_key_enabled: false,
    claude_code_tracking_rewrite_enabled: true,
    request_record_enabled: true,
    upstream_proxy_url: '',
    test_request_timeout_seconds: DEFAULT_REQUEST_TIMEOUT_MS / 1000,
});

const isDirty = computed(() => {
    return form.cch_rewrite_enabled !== originalConfig.cch_rewrite_enabled ||
           form.responses_prompt_cache_key_enabled !== originalConfig.responses_prompt_cache_key_enabled ||
           form.claude_code_tracking_rewrite_enabled !== originalConfig.claude_code_tracking_rewrite_enabled ||
           form.request_record_enabled !== originalConfig.request_record_enabled ||
           form.upstream_proxy_url !== originalConfig.upstream_proxy_url ||
           form.test_request_timeout_seconds !== originalConfig.test_request_timeout_seconds;
});

const proxyTestText = computed(() => {
    const result = proxyTestResult.value;
    if (!result) return '';
    const proxyText = result.proxy_url ? `代理 ${result.proxy_url}` : '直连';
    if (result.success) {
        return `${proxyText} 可连接，HTTP ${result.status}，耗时 ${result.duration}ms`;
    }
    return `${proxyText} 测试失败：${result.error || '未知错误'}`;
});

onMounted(() => {
    void loadConfig();
});

async function loadConfig(): Promise<void> {
    loading.value = true;
    try {
        const config = await getConfig();
        form.cch_rewrite_enabled = config.cch_rewrite_enabled === "true";
        originalConfig.cch_rewrite_enabled = config.cch_rewrite_enabled === "true";
        
        form.responses_prompt_cache_key_enabled = config.responses_prompt_cache_key_enabled === "true";
        originalConfig.responses_prompt_cache_key_enabled = config.responses_prompt_cache_key_enabled === "true";
        
        form.claude_code_tracking_rewrite_enabled = config.claude_code_tracking_rewrite_enabled !== "false"; // Default to true
        originalConfig.claude_code_tracking_rewrite_enabled = config.claude_code_tracking_rewrite_enabled !== "false";

        form.request_record_enabled = config.request_record_enabled !== "false"; // Default to true
        originalConfig.request_record_enabled = config.request_record_enabled !== "false";

        form.upstream_proxy_url = config.upstream_proxy_url || '';
        originalConfig.upstream_proxy_url = config.upstream_proxy_url || '';

        const timeoutMs = setRequestTimeoutMs(config.test_request_timeout_ms || DEFAULT_REQUEST_TIMEOUT_MS);
        form.test_request_timeout_seconds = Math.round(timeoutMs / 1000);
        originalConfig.test_request_timeout_seconds = form.test_request_timeout_seconds;
        if (!appStore.version) {
            appStore.fetchVersion();
        }
    } finally {
        loading.value = false;
    }
}

function cancelChanges() {
    form.cch_rewrite_enabled = originalConfig.cch_rewrite_enabled;
    form.responses_prompt_cache_key_enabled = originalConfig.responses_prompt_cache_key_enabled;
    form.claude_code_tracking_rewrite_enabled = originalConfig.claude_code_tracking_rewrite_enabled;
    form.request_record_enabled = originalConfig.request_record_enabled;
    form.upstream_proxy_url = originalConfig.upstream_proxy_url;
    form.test_request_timeout_seconds = originalConfig.test_request_timeout_seconds;
}

async function handleTestProxy() {
    testingProxy.value = true;
    proxyTestResult.value = null;
    try {
        const result = await testProxy(form.upstream_proxy_url);
        proxyTestResult.value = result;
        if (result.success) {
            message.success(proxyTestText.value);
        } else {
            message.error(proxyTestText.value);
        }
    } catch (error: any) {
        const detail = error?.data || error;
        proxyTestResult.value = {
            success: false,
            error: detail?.error || error?.message || '测试失败',
            error_detail: detail?.error_detail,
            proxy_url: form.upstream_proxy_url.trim() || null,
        };
        message.error(proxyTestText.value);
    } finally {
        testingProxy.value = false;
    }
}

async function doCheckUpdate() {
    checkingUpdate.value = true;
    try {
        const status = await checkUpdate(true);
        if (!status.success) {
            message.error(status.error_message || '检查更新失败');
            return;
        }

        hasUpdate.value = status.has_update;
        checkedUpdate.value = true;
        if (status.has_update) {
            updateUrl.value = status.release_url || '';
            latestVersion.value = status.latest_version;
            message.info(`发现新版本 v${status.latest_version}`);
        } else {
            message.success('当前已是最新版本');
        }
    } catch (e) {
        message.error('检查更新失败');
        console.error(e);
    } finally {
        checkingUpdate.value = false;
    }
}

import { openUrl } from '@/utils/platform';

async function openUpdateUrl() {
    await openUrl(updateUrl.value);
}

async function saveConfig() {
    saving.value = true;
    try {
        await updateConfig({
            cch_rewrite_enabled: form.cch_rewrite_enabled ? "true" : "false",
            responses_prompt_cache_key_enabled: form.responses_prompt_cache_key_enabled ? "true" : "false",
            claude_code_tracking_rewrite_enabled: form.claude_code_tracking_rewrite_enabled ? "true" : "false",
            request_record_enabled: form.request_record_enabled ? "true" : "false",
            upstream_proxy_url: form.upstream_proxy_url.trim(),
            test_request_timeout_ms: String(Math.max(1, form.test_request_timeout_seconds) * 1000),
        });
        message.success('配置已保存');
        originalConfig.cch_rewrite_enabled = form.cch_rewrite_enabled;
        originalConfig.responses_prompt_cache_key_enabled = form.responses_prompt_cache_key_enabled;
        originalConfig.claude_code_tracking_rewrite_enabled = form.claude_code_tracking_rewrite_enabled;
        originalConfig.request_record_enabled = form.request_record_enabled;
        originalConfig.upstream_proxy_url = form.upstream_proxy_url.trim();
        originalConfig.test_request_timeout_seconds = form.test_request_timeout_seconds;
        setRequestTimeoutMs(originalConfig.test_request_timeout_seconds * 1000);
        form.upstream_proxy_url = originalConfig.upstream_proxy_url;
    } catch {
        // error handling is typically done by the request interceptor
    } finally {
        saving.value = false;
    }
}
</script>

<style scoped>
.advanced-settings {
    background: var(--bg-page);
    min-height: calc(100vh - 64px);
    padding: 24px;
    max-width: 900px;
}

.page-header {
    margin-bottom: 24px;
}

.page-title {
    margin: 0;
    font-size: 20px;
    font-weight: 600;
    color: var(--text-primary);
}

.settings-section {
    margin-bottom: 32px;
}

.section-title {
    margin: 0 0 16px;
    font-size: 16px;
    font-weight: 600;
    color: var(--text-primary);
}

.settings-list {
    background: var(--component-bg, #ffffff);
    border: 1px solid var(--border-color, #f0f0f0);
    border-radius: 8px;
    overflow: hidden;
}

.setting-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 20px 24px;
    transition: background-color 0.3s;
}

.setting-item:not(:last-child) {
    border-bottom: 1px solid var(--border-color, #f0f0f0);
}

.setting-info {
    flex: 1;
    min-width: 0;
    margin-right: 24px;
}

.setting-title {
    color: var(--text-primary);
    font-size: 15px;
    font-weight: 500;
    margin-bottom: 4px;
}

.setting-desc {
    color: var(--text-secondary, #8c8c8c);
    font-size: 13px;
    line-height: 1.5;
}

.setting-input {
    width: 320px;
    flex-shrink: 0;
}

.proxy-test-result {
    margin-top: 6px;
    font-size: 12px;
    line-height: 1.4;
    word-break: break-word;
}

.proxy-test-result.success {
    color: #389e0d;
}

.proxy-test-result.error {
    color: #cf1322;
}

.page-actions {
    margin-top: 24px;
    display: flex;
    justify-content: flex-end;
}
</style>
