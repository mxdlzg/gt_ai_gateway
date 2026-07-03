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
                <h3 class="section-title">网络与记录</h3>
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
                            <div class="setting-title">记录内容</div>
                            <div class="setting-desc">控制新请求记录中是否保存请求体、响应体和最终上游 Headers</div>
                        </div>
                        <div class="setting-action setting-input">
                            <a-space wrap>
                                <a-checkbox v-model:checked="form.request_record_request_body_enabled" :disabled="saving">
                                    请求体
                                </a-checkbox>
                                <a-checkbox v-model:checked="form.request_record_response_body_enabled" :disabled="saving">
                                    响应体
                                </a-checkbox>
                                <a-checkbox v-model:checked="form.request_record_headers_enabled" :disabled="saving">
                                    Headers
                                </a-checkbox>
                            </a-space>
                        </div>
                    </div>
                    <div class="setting-item">
                        <div class="setting-info">
                            <div class="setting-title">敏感字段脱敏</div>
                            <div class="setting-desc">保存请求记录前按字段名脱敏，字段名用英文逗号分隔</div>
                        </div>
                        <div class="setting-action setting-input">
                            <a-space direction="vertical" style="width: 100%">
                                <a-switch
                                    v-model:checked="form.request_record_redaction_enabled"
                                    :disabled="saving"
                                />
                                <a-input
                                    v-model:value="form.request_record_redaction_keys"
                                    :disabled="saving || !form.request_record_redaction_enabled"
                                />
                            </a-space>
                        </div>
                    </div>
                    <div class="setting-item">
                        <div class="setting-info">
                            <div class="setting-title">记录保留策略</div>
                            <div class="setting-desc">保留天数或最大条数为 0 时表示不限制；开启自动清理后会按小时检查</div>
                        </div>
                        <div class="setting-action setting-input">
                            <a-space direction="vertical" style="width: 100%">
                                <a-space wrap>
                                    <a-input-number
                                        v-model:value="form.request_record_retention_days"
                                        :disabled="saving"
                                        :min="0"
                                        :precision="0"
                                        addon-before="天数"
                                        style="width: 140px"
                                    />
                                    <a-input-number
                                        v-model:value="form.request_record_max_count"
                                        :disabled="saving"
                                        :min="0"
                                        :precision="0"
                                        addon-before="条数"
                                        style="width: 150px"
                                    />
                                    <a-switch
                                        v-model:checked="form.request_record_auto_cleanup_enabled"
                                        :disabled="saving"
                                        checked-children="自动"
                                        un-checked-children="手动"
                                    />
                                </a-space>
                                <div v-if="lastCleanupText" class="setting-extra">{{ lastCleanupText }}</div>
                            </a-space>
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
                    <div class="setting-item">
                        <div class="setting-info">
                            <div class="setting-title">唤醒通知</div>
                            <div class="setting-desc">启用后，Windows 打包版会在模型唤醒成功、保活失败、429 等事件发生时弹出系统通知</div>
                        </div>
                        <div class="setting-action setting-input">
                            <a-space direction="vertical" style="width: 100%">
                                <a-space wrap>
                                    <a-switch
                                        v-model:checked="form.wakeup_notification_enabled"
                                        :disabled="saving"
                                        checked-children="开启"
                                        un-checked-children="关闭"
                                    />
                                    <a-button
                                        :loading="testingNotification"
                                        :disabled="saving"
                                        @click="handleTestNotification"
                                    >
                                        测试通知
                                    </a-button>
                                </a-space>
                                <a-space wrap>
                                    <a-checkbox v-model:checked="form.wakeup_notify_warmup_success" :disabled="saving || !form.wakeup_notification_enabled">
                                        唤醒成功
                                    </a-checkbox>
                                    <a-checkbox v-model:checked="form.wakeup_notify_warmup_failure" :disabled="saving || !form.wakeup_notification_enabled">
                                        唤醒失败
                                    </a-checkbox>
                                    <a-checkbox v-model:checked="form.wakeup_notify_keepalive_failure" :disabled="saving || !form.wakeup_notification_enabled">
                                        保活失败
                                    </a-checkbox>
                                    <a-checkbox v-model:checked="form.wakeup_notify_rate_limited" :disabled="saving || !form.wakeup_notification_enabled">
                                        429 限流
                                    </a-checkbox>
                                    <a-checkbox v-model:checked="form.wakeup_notify_skipped" :disabled="saving || !form.wakeup_notification_enabled">
                                        任务跳过
                                    </a-checkbox>
                                </a-space>
                            </a-space>
                        </div>
                    </div>
                </div>
            </div>

            <div class="settings-section">
                <h3 class="section-title">路由策略</h3>
                <div class="settings-list">
                    <div class="setting-item">
                        <div class="setting-info">
                            <div class="setting-title">路由选择</div>
                            <div class="setting-desc">同优先级路由的选择方式；失败后会继续尝试下一条可用路由</div>
                        </div>
                        <div class="setting-action setting-input">
                            <a-select
                                v-model:value="form.routing_selection_strategy"
                                :options="routingStrategyOptions"
                                :disabled="saving"
                                style="width: 180px"
                            />
                        </div>
                    </div>
                    <div class="setting-item">
                        <div class="setting-info">
                            <div class="setting-title">Fallback</div>
                            <div class="setting-desc">启用后，连接失败或命中可重试 HTTP 状态码时会按路由队列继续尝试</div>
                        </div>
                        <div class="setting-action">
                            <a-switch
                                v-model:checked="form.routing_fallback_enabled"
                                :disabled="saving"
                            />
                        </div>
                    </div>
                    <div class="setting-item">
                        <div class="setting-info">
                            <div class="setting-title">Fallback 尝试</div>
                            <div class="setting-desc">单次客户端请求最多尝试的供应商路由数量</div>
                        </div>
                        <div class="setting-action setting-number">
                            <a-input-number
                                v-model:value="form.routing_max_attempts"
                                :disabled="saving || !form.routing_fallback_enabled"
                                :min="1"
                                :max="20"
                                :precision="0"
                                addon-after="次"
                                style="width: 160px"
                            />
                        </div>
                    </div>
                    <div class="setting-item">
                        <div class="setting-info">
                            <div class="setting-title">可重试状态码</div>
                            <div class="setting-desc">上游返回这些 HTTP 状态码时会触发 fallback，多个状态码用英文逗号分隔</div>
                        </div>
                        <div class="setting-action setting-input">
                            <a-input
                                v-model:value="form.routing_retry_status_codes"
                                :disabled="saving || !form.routing_fallback_enabled"
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
import { getConfig, testNotification, testProxy, updateConfig } from '@/api/config';
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
const testingNotification = ref(false);
const proxyTestResult = ref<ProxyTestResponse | null>(null);

const DEFAULT_REDACTION_KEYS = 'authorization,x-api-key,api_key,apikey,access_token,refresh_token,token,password,secret,cookie,set-cookie';
const DEFAULT_RETRY_STATUS_CODES = '429,500,502,503,504';
const routingStrategyOptions = [
    { label: '优先级 + 权重', value: 'priority_weight' },
    { label: '延迟优先', value: 'latency' },
    { label: '价格优先', value: 'cost' },
];

const originalConfig = reactive({
    cch_rewrite_enabled: false,
    responses_prompt_cache_key_enabled: false,
    claude_code_tracking_rewrite_enabled: true,
    request_record_enabled: true,
    request_record_request_body_enabled: true,
    request_record_response_body_enabled: true,
    request_record_headers_enabled: true,
    request_record_redaction_enabled: true,
    request_record_redaction_keys: DEFAULT_REDACTION_KEYS,
    request_record_retention_days: 0,
    request_record_max_count: 0,
    request_record_auto_cleanup_enabled: false,
    request_record_last_cleanup_at: '',
    routing_fallback_enabled: true,
    routing_max_attempts: 3,
    routing_retry_status_codes: DEFAULT_RETRY_STATUS_CODES,
    routing_selection_strategy: 'priority_weight',
    upstream_proxy_url: '',
    test_request_timeout_seconds: DEFAULT_REQUEST_TIMEOUT_MS / 1000,
    wakeup_notification_enabled: false,
    wakeup_notify_warmup_success: true,
    wakeup_notify_warmup_failure: true,
    wakeup_notify_keepalive_failure: true,
    wakeup_notify_rate_limited: true,
    wakeup_notify_skipped: false,
});

const form = reactive({
    cch_rewrite_enabled: false,
    responses_prompt_cache_key_enabled: false,
    claude_code_tracking_rewrite_enabled: true,
    request_record_enabled: true,
    request_record_request_body_enabled: true,
    request_record_response_body_enabled: true,
    request_record_headers_enabled: true,
    request_record_redaction_enabled: true,
    request_record_redaction_keys: DEFAULT_REDACTION_KEYS,
    request_record_retention_days: 0,
    request_record_max_count: 0,
    request_record_auto_cleanup_enabled: false,
    request_record_last_cleanup_at: '',
    routing_fallback_enabled: true,
    routing_max_attempts: 3,
    routing_retry_status_codes: DEFAULT_RETRY_STATUS_CODES,
    routing_selection_strategy: 'priority_weight',
    upstream_proxy_url: '',
    test_request_timeout_seconds: DEFAULT_REQUEST_TIMEOUT_MS / 1000,
    wakeup_notification_enabled: false,
    wakeup_notify_warmup_success: true,
    wakeup_notify_warmup_failure: true,
    wakeup_notify_keepalive_failure: true,
    wakeup_notify_rate_limited: true,
    wakeup_notify_skipped: false,
});

const configKeys = [
    'cch_rewrite_enabled',
    'responses_prompt_cache_key_enabled',
    'claude_code_tracking_rewrite_enabled',
    'request_record_enabled',
    'request_record_request_body_enabled',
    'request_record_response_body_enabled',
    'request_record_headers_enabled',
    'request_record_redaction_enabled',
    'request_record_redaction_keys',
    'request_record_retention_days',
    'request_record_max_count',
    'request_record_auto_cleanup_enabled',
    'routing_fallback_enabled',
    'routing_max_attempts',
    'routing_retry_status_codes',
    'routing_selection_strategy',
    'upstream_proxy_url',
    'test_request_timeout_seconds',
    'wakeup_notification_enabled',
    'wakeup_notify_warmup_success',
    'wakeup_notify_warmup_failure',
    'wakeup_notify_keepalive_failure',
    'wakeup_notify_rate_limited',
    'wakeup_notify_skipped',
] as const;

const isDirty = computed(() => {
    return configKeys.some(key => form[key] !== originalConfig[key]);
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

const lastCleanupText = computed(() => {
    const value = form.request_record_last_cleanup_at || originalConfig.request_record_last_cleanup_at;
    if (!value) return '';
    return `上次清理：${formatCleanupTime(value)}`;
});

onMounted(() => {
    void loadConfig();
});

function readBoolean(value: string | undefined, defaultValue: boolean): boolean {
    if (value === undefined || value === '') return defaultValue;
    return value !== 'false';
}

function readNumber(value: string | undefined, defaultValue: number): number {
    if (value === undefined || value === '') return defaultValue;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : defaultValue;
}

function formatCleanupTime(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString();
}

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

        form.request_record_request_body_enabled = readBoolean(config.request_record_request_body_enabled, true);
        originalConfig.request_record_request_body_enabled = form.request_record_request_body_enabled;

        form.request_record_response_body_enabled = readBoolean(config.request_record_response_body_enabled, true);
        originalConfig.request_record_response_body_enabled = form.request_record_response_body_enabled;

        form.request_record_headers_enabled = readBoolean(config.request_record_headers_enabled, true);
        originalConfig.request_record_headers_enabled = form.request_record_headers_enabled;

        form.request_record_redaction_enabled = readBoolean(config.request_record_redaction_enabled, true);
        originalConfig.request_record_redaction_enabled = form.request_record_redaction_enabled;

        form.request_record_redaction_keys = config.request_record_redaction_keys || DEFAULT_REDACTION_KEYS;
        originalConfig.request_record_redaction_keys = form.request_record_redaction_keys;

        form.request_record_retention_days = readNumber(config.request_record_retention_days, 0);
        originalConfig.request_record_retention_days = form.request_record_retention_days;

        form.request_record_max_count = readNumber(config.request_record_max_count, 0);
        originalConfig.request_record_max_count = form.request_record_max_count;

        form.request_record_auto_cleanup_enabled = readBoolean(config.request_record_auto_cleanup_enabled, false);
        originalConfig.request_record_auto_cleanup_enabled = form.request_record_auto_cleanup_enabled;

        form.request_record_last_cleanup_at = config.request_record_last_cleanup_at || '';
        originalConfig.request_record_last_cleanup_at = form.request_record_last_cleanup_at;

        form.routing_fallback_enabled = readBoolean(config.routing_fallback_enabled, true);
        originalConfig.routing_fallback_enabled = form.routing_fallback_enabled;

        form.routing_max_attempts = readNumber(config.routing_max_attempts, 3);
        originalConfig.routing_max_attempts = form.routing_max_attempts;

        form.routing_retry_status_codes = config.routing_retry_status_codes || DEFAULT_RETRY_STATUS_CODES;
        originalConfig.routing_retry_status_codes = form.routing_retry_status_codes;

        form.routing_selection_strategy = config.routing_selection_strategy || 'priority_weight';
        originalConfig.routing_selection_strategy = form.routing_selection_strategy;

        form.upstream_proxy_url = config.upstream_proxy_url || '';
        originalConfig.upstream_proxy_url = config.upstream_proxy_url || '';

        const timeoutMs = setRequestTimeoutMs(config.test_request_timeout_ms || DEFAULT_REQUEST_TIMEOUT_MS);
        form.test_request_timeout_seconds = Math.round(timeoutMs / 1000);
        originalConfig.test_request_timeout_seconds = form.test_request_timeout_seconds;

        form.wakeup_notification_enabled = readBoolean(config.wakeup_notification_enabled, false);
        originalConfig.wakeup_notification_enabled = form.wakeup_notification_enabled;

        form.wakeup_notify_warmup_success = readBoolean(config.wakeup_notify_warmup_success, true);
        originalConfig.wakeup_notify_warmup_success = form.wakeup_notify_warmup_success;

        form.wakeup_notify_warmup_failure = readBoolean(config.wakeup_notify_warmup_failure, true);
        originalConfig.wakeup_notify_warmup_failure = form.wakeup_notify_warmup_failure;

        form.wakeup_notify_keepalive_failure = readBoolean(config.wakeup_notify_keepalive_failure, true);
        originalConfig.wakeup_notify_keepalive_failure = form.wakeup_notify_keepalive_failure;

        form.wakeup_notify_rate_limited = readBoolean(config.wakeup_notify_rate_limited, true);
        originalConfig.wakeup_notify_rate_limited = form.wakeup_notify_rate_limited;

        form.wakeup_notify_skipped = readBoolean(config.wakeup_notify_skipped, false);
        originalConfig.wakeup_notify_skipped = form.wakeup_notify_skipped;

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
    form.request_record_request_body_enabled = originalConfig.request_record_request_body_enabled;
    form.request_record_response_body_enabled = originalConfig.request_record_response_body_enabled;
    form.request_record_headers_enabled = originalConfig.request_record_headers_enabled;
    form.request_record_redaction_enabled = originalConfig.request_record_redaction_enabled;
    form.request_record_redaction_keys = originalConfig.request_record_redaction_keys;
    form.request_record_retention_days = originalConfig.request_record_retention_days;
    form.request_record_max_count = originalConfig.request_record_max_count;
    form.request_record_auto_cleanup_enabled = originalConfig.request_record_auto_cleanup_enabled;
    form.request_record_last_cleanup_at = originalConfig.request_record_last_cleanup_at;
    form.routing_fallback_enabled = originalConfig.routing_fallback_enabled;
    form.routing_max_attempts = originalConfig.routing_max_attempts;
    form.routing_retry_status_codes = originalConfig.routing_retry_status_codes;
    form.routing_selection_strategy = originalConfig.routing_selection_strategy;
    form.upstream_proxy_url = originalConfig.upstream_proxy_url;
    form.test_request_timeout_seconds = originalConfig.test_request_timeout_seconds;
    form.wakeup_notification_enabled = originalConfig.wakeup_notification_enabled;
    form.wakeup_notify_warmup_success = originalConfig.wakeup_notify_warmup_success;
    form.wakeup_notify_warmup_failure = originalConfig.wakeup_notify_warmup_failure;
    form.wakeup_notify_keepalive_failure = originalConfig.wakeup_notify_keepalive_failure;
    form.wakeup_notify_rate_limited = originalConfig.wakeup_notify_rate_limited;
    form.wakeup_notify_skipped = originalConfig.wakeup_notify_skipped;
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

async function handleTestNotification() {
    testingNotification.value = true;
    try {
        const result = await testNotification();
        if (result.success) {
            message.success('测试通知已发送');
            return;
        }

        message.error(result.error || `当前平台不支持系统通知：${result.platform}`);
    } catch (error: any) {
        message.error(error?.message || '测试通知失败');
    } finally {
        testingNotification.value = false;
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
            request_record_request_body_enabled: form.request_record_request_body_enabled ? "true" : "false",
            request_record_response_body_enabled: form.request_record_response_body_enabled ? "true" : "false",
            request_record_headers_enabled: form.request_record_headers_enabled ? "true" : "false",
            request_record_redaction_enabled: form.request_record_redaction_enabled ? "true" : "false",
            request_record_redaction_keys: form.request_record_redaction_keys.trim() || DEFAULT_REDACTION_KEYS,
            request_record_retention_days: String(Math.max(0, Math.floor(form.request_record_retention_days || 0))),
            request_record_max_count: String(Math.max(0, Math.floor(form.request_record_max_count || 0))),
            request_record_auto_cleanup_enabled: form.request_record_auto_cleanup_enabled ? "true" : "false",
            routing_fallback_enabled: form.routing_fallback_enabled ? "true" : "false",
            routing_max_attempts: String(Math.max(1, Math.floor(form.routing_max_attempts || 1))),
            routing_retry_status_codes: form.routing_retry_status_codes.trim() || DEFAULT_RETRY_STATUS_CODES,
            routing_selection_strategy: form.routing_selection_strategy,
            upstream_proxy_url: form.upstream_proxy_url.trim(),
            test_request_timeout_ms: String(Math.max(1, form.test_request_timeout_seconds) * 1000),
            wakeup_notification_enabled: form.wakeup_notification_enabled ? "true" : "false",
            wakeup_notify_warmup_success: form.wakeup_notify_warmup_success ? "true" : "false",
            wakeup_notify_warmup_failure: form.wakeup_notify_warmup_failure ? "true" : "false",
            wakeup_notify_keepalive_failure: form.wakeup_notify_keepalive_failure ? "true" : "false",
            wakeup_notify_rate_limited: form.wakeup_notify_rate_limited ? "true" : "false",
            wakeup_notify_skipped: form.wakeup_notify_skipped ? "true" : "false",
        });
        message.success('配置已保存');
        originalConfig.cch_rewrite_enabled = form.cch_rewrite_enabled;
        originalConfig.responses_prompt_cache_key_enabled = form.responses_prompt_cache_key_enabled;
        originalConfig.claude_code_tracking_rewrite_enabled = form.claude_code_tracking_rewrite_enabled;
        originalConfig.request_record_enabled = form.request_record_enabled;
        originalConfig.request_record_request_body_enabled = form.request_record_request_body_enabled;
        originalConfig.request_record_response_body_enabled = form.request_record_response_body_enabled;
        originalConfig.request_record_headers_enabled = form.request_record_headers_enabled;
        originalConfig.request_record_redaction_enabled = form.request_record_redaction_enabled;
        originalConfig.request_record_redaction_keys = form.request_record_redaction_keys.trim() || DEFAULT_REDACTION_KEYS;
        originalConfig.request_record_retention_days = Math.max(0, Math.floor(form.request_record_retention_days || 0));
        originalConfig.request_record_max_count = Math.max(0, Math.floor(form.request_record_max_count || 0));
        originalConfig.request_record_auto_cleanup_enabled = form.request_record_auto_cleanup_enabled;
        originalConfig.routing_fallback_enabled = form.routing_fallback_enabled;
        originalConfig.routing_max_attempts = Math.max(1, Math.floor(form.routing_max_attempts || 1));
        originalConfig.routing_retry_status_codes = form.routing_retry_status_codes.trim() || DEFAULT_RETRY_STATUS_CODES;
        originalConfig.routing_selection_strategy = form.routing_selection_strategy;
        originalConfig.upstream_proxy_url = form.upstream_proxy_url.trim();
        originalConfig.test_request_timeout_seconds = form.test_request_timeout_seconds;
        originalConfig.wakeup_notification_enabled = form.wakeup_notification_enabled;
        originalConfig.wakeup_notify_warmup_success = form.wakeup_notify_warmup_success;
        originalConfig.wakeup_notify_warmup_failure = form.wakeup_notify_warmup_failure;
        originalConfig.wakeup_notify_keepalive_failure = form.wakeup_notify_keepalive_failure;
        originalConfig.wakeup_notify_rate_limited = form.wakeup_notify_rate_limited;
        originalConfig.wakeup_notify_skipped = form.wakeup_notify_skipped;
        setRequestTimeoutMs(originalConfig.test_request_timeout_seconds * 1000);
        form.request_record_redaction_keys = originalConfig.request_record_redaction_keys;
        form.request_record_retention_days = originalConfig.request_record_retention_days;
        form.request_record_max_count = originalConfig.request_record_max_count;
        form.routing_max_attempts = originalConfig.routing_max_attempts;
        form.routing_retry_status_codes = originalConfig.routing_retry_status_codes;
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

.setting-extra {
    color: var(--text-secondary, #8c8c8c);
    font-size: 12px;
    line-height: 1.4;
}

.page-actions {
    margin-top: 24px;
    display: flex;
    justify-content: flex-end;
}
</style>
