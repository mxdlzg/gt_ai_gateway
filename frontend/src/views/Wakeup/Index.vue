<template>
    <div class="wakeup-page">
        <div class="page-header">
            <div>
                <h2 class="page-title">唤醒保活</h2>
                <div class="page-desc">为指定供应商模型配置低频唤醒和保活任务，执行结果会写入独立日志。</div>
            </div>
            <a-space>
                <a-button @click="loadJobs">刷新</a-button>
                <a-button @click="openPromptTemplates">
                    <FileTextOutlined /> 提示词模板
                </a-button>
                <a-button type="primary" @click="openCreate">
                    <PlusOutlined /> 新建任务
                </a-button>
            </a-space>
        </div>

        <div class="table-header">
            <a-form layout="inline">
                <a-form-item label="关键词">
                    <a-input
                        v-model:value="searchForm.keyword"
                        placeholder="任务 / 模型 / 供应商"
                        allow-clear
                    />
                </a-form-item>
                <a-form-item label="模式">
                    <a-select
                        v-model:value="searchForm.mode"
                        placeholder="全部"
                        allow-clear
                        style="width: 120px"
                        :options="modeOptions"
                    />
                </a-form-item>
                <a-form-item label="状态">
                    <a-select
                        v-model:value="searchForm.enabled"
                        placeholder="全部"
                        allow-clear
                        style="width: 120px"
                    >
                        <a-select-option value="true">启用</a-select-option>
                        <a-select-option value="false">停用</a-select-option>
                    </a-select>
                </a-form-item>
                <a-form-item>
                    <a-space>
                        <a-button type="primary" @click="handleSearch">搜索</a-button>
                        <a-button @click="handleReset">重置</a-button>
                    </a-space>
                </a-form-item>
            </a-form>
        </div>

        <a-table
            :columns="columns"
            :data-source="jobs"
            :loading="loading"
            :pagination="pagination"
            :row-key="(record: WakeupJob) => record.id"
            @change="handleTableChange"
        >
            <template #bodyCell="{ column, record }">
                <template v-if="column.key === 'enabled'">
                    <a-switch
                        :checked="record.enabled"
                        :loading="togglingIds.has(record.id)"
                        checked-children="开"
                        un-checked-children="关"
                        @change="handleToggleChange(record, $event)"
                    />
                </template>
                <template v-else-if="column.key === 'mode'">
                    <a-tag :color="record.mode === 'warmup' ? 'geekblue' : 'green'">
                        {{ getModeLabel(record.mode) }}
                    </a-tag>
                </template>
                <template v-else-if="column.key === 'target'">
                    <div class="target-cell">
                        <div class="target-main">{{ record.vendor_name || `#${record.vendor_id}` }}</div>
                        <div class="target-sub">{{ record.model_name }}</div>
                    </div>
                </template>
                <template v-else-if="column.key === 'window'">
                    <div>{{ record.start_time }} - {{ record.end_time }}</div>
                    <div class="table-sub">{{ formatInterval(record) }}</div>
                </template>
                <template v-else-if="column.key === 'last_status'">
                    <a-tag :color="getStatusColor(record.last_status)">
                        {{ getStatusLabel(record.last_status) }}
                    </a-tag>
                    <span v-if="record.last_http_status" class="status-code">HTTP {{ record.last_http_status }}</span>
                    <div v-if="record.last_error" class="table-sub error-text">{{ record.last_error }}</div>
                </template>
                <template v-else-if="column.key === 'next_run_at'">
                    <div>{{ record.next_run_at ? formatDate(record.next_run_at) : '-' }}</div>
                    <div class="table-sub">今日 {{ record.run_count }} 次</div>
                </template>
                <template v-else-if="column.key === 'action'">
                    <a-space>
                        <a-button
                            type="link"
                            style="padding: 0"
                            :loading="runningIds.has(record.id)"
                            @click="handleRun(record)"
                        >
                            运行
                        </a-button>
                        <a-button type="link" style="padding: 0" @click="openEdit(record)">
                            编辑
                        </a-button>
                        <a-button type="link" style="padding: 0" @click="openLogs(record)">
                            日志
                        </a-button>
                        <a-button type="link" danger style="padding: 0" @click="handleDelete(record)">
                            删除
                        </a-button>
                    </a-space>
                </template>
            </template>
        </a-table>

        <a-modal
            v-model:open="formOpen"
            :title="editingId ? '编辑唤醒任务' : '新建唤醒任务'"
            width="880px"
            :confirm-loading="saving"
            @ok="submitForm"
        >
            <a-form class="job-form" layout="vertical">
                <div class="form-section">
                    <div class="form-section-title">任务目标</div>
                    <a-row :gutter="16">
                        <a-col :span="12">
                            <a-form-item label="任务名称" required>
                                <a-input v-model:value="form.name" placeholder="例如：Claude 早间唤醒" />
                            </a-form-item>
                        </a-col>
                        <a-col :span="6">
                            <a-form-item label="模式">
                                <a-segmented v-model:value="form.mode" block :options="modeOptions" />
                            </a-form-item>
                        </a-col>
                        <a-col :span="6">
                            <a-form-item label="启用">
                                <a-switch v-model:checked="form.enabled" checked-children="开" un-checked-children="关" />
                            </a-form-item>
                        </a-col>
                        <a-col :span="12">
                            <a-form-item label="供应商" required>
                                <a-select
                                    v-model:value="form.vendor_id"
                                    show-search
                                    placeholder="选择供应商"
                                    :options="vendorOptions"
                                    :filter-option="filterOption"
                                    @change="handleFormVendorChange"
                                />
                            </a-form-item>
                        </a-col>
                        <a-col :span="12">
                            <a-form-item label="供应商模型">
                                <a-select
                                    v-model:value="form.vendor_model_id"
                                    show-search
                                    allow-clear
                                    placeholder="选择或手动填写"
                                    :options="modelOptions"
                                    :filter-option="filterOption"
                                    @change="handleFormModelChange"
                                />
                            </a-form-item>
                        </a-col>
                        <a-col :span="12">
                            <a-form-item label="上游模型名" required>
                                <a-input v-model:value="form.model_name" placeholder="例如：claude-sonnet-4-5" />
                            </a-form-item>
                        </a-col>
                        <a-col :span="6">
                            <a-form-item label="协议格式">
                                <a-select v-model:value="form.format" :options="formatOptions" />
                            </a-form-item>
                        </a-col>
                        <a-col :span="6">
                            <a-form-item label="协议转换">
                                <a-switch
                                    v-model:checked="form.auto_convert"
                                    checked-children="自动"
                                    un-checked-children="直连"
                                />
                            </a-form-item>
                        </a-col>
                    </a-row>
                </div>

                <div class="form-section">
                    <div class="form-section-title">调度策略</div>
                    <a-row :gutter="16">
                        <a-col :span="12">
                            <a-form-item label="每日窗口">
                                <div class="time-range-control">
                                    <a-time-picker
                                        v-model:value="form.start_time"
                                        value-format="HH:mm"
                                        format="HH:mm"
                                        :minute-step="5"
                                        style="width: 100%"
                                    />
                                    <span class="range-separator">至</span>
                                    <a-time-picker
                                        v-model:value="form.end_time"
                                        value-format="HH:mm"
                                        format="HH:mm"
                                        :minute-step="5"
                                        style="width: 100%"
                                    />
                                </div>
                            </a-form-item>
                        </a-col>
                        <a-col :span="12" v-if="form.mode === 'keepalive'">
                            <a-form-item label="保活运行时间">
                                <a-segmented
                                    v-model:value="form.schedule_mode"
                                    block
                                    :options="scheduleModeOptions"
                                />
                            </a-form-item>
                        </a-col>
                        <a-col :span="12">
                            <a-form-item label="随机间隔">
                                <div class="range-control">
                                    <a-input-number
                                        v-model:value="form.interval_min_minutes"
                                        :min="2"
                                        :max="1440"
                                        addon-after="分钟"
                                        style="width: 100%"
                                    />
                                    <span class="range-separator">至</span>
                                    <a-input-number
                                        v-model:value="form.interval_max_minutes"
                                        :min="2"
                                        :max="1440"
                                        addon-after="分钟"
                                        style="width: 100%"
                                    />
                                </div>
                            </a-form-item>
                        </a-col>
                        <a-col :span="6">
                            <a-form-item label="唤醒尝试">
                                <a-input-number
                                    v-model:value="form.max_attempts"
                                    :min="1"
                                    :max="100"
                                    addon-after="次"
                                    style="width: 100%"
                                />
                            </a-form-item>
                        </a-col>
                        <a-col :span="6">
                            <a-form-item label="每日上限">
                                <a-input-number
                                    v-model:value="form.daily_limit"
                                    :min="1"
                                    :max="500"
                                    addon-after="次"
                                    style="width: 100%"
                                />
                            </a-form-item>
                        </a-col>
                        <a-col :span="6">
                            <a-form-item label="429 冷却">
                                <a-input-number
                                    v-model:value="form.cooldown_after_429_minutes"
                                    :min="5"
                                    :max="1440"
                                    addon-after="分钟"
                                    style="width: 100%"
                                />
                            </a-form-item>
                        </a-col>
                        <a-col :span="6">
                            <a-form-item label="成功后动作">
                                <a-select
                                    v-model:value="form.after_success_action"
                                    :disabled="form.mode !== 'warmup'"
                                    :options="afterSuccessActionOptions"
                                />
                            </a-form-item>
                        </a-col>
                        <a-col :span="6" v-if="form.mode === 'warmup' && form.after_success_action === 'duration'">
                            <a-form-item label="保活时长">
                                <a-input-number
                                    v-model:value="form.after_success_keepalive_minutes"
                                    :min="1"
                                    :max="1440"
                                    addon-after="分钟"
                                    style="width: 100%"
                                />
                            </a-form-item>
                        </a-col>
                        <a-col :span="12" v-if="form.mode === 'warmup' && form.after_success_action === 'duration'">
                            <a-form-item label="成功后保活间隔">
                                <div class="range-control">
                                    <a-input-number
                                        v-model:value="form.after_success_keepalive_interval_min_minutes"
                                        :min="2"
                                        :max="1440"
                                        addon-after="分钟"
                                        style="width: 100%"
                                    />
                                    <span class="range-separator">至</span>
                                    <a-input-number
                                        v-model:value="form.after_success_keepalive_interval_max_minutes"
                                        :min="2"
                                        :max="1440"
                                        addon-after="分钟"
                                        style="width: 100%"
                                    />
                                </div>
                            </a-form-item>
                        </a-col>
                        <a-col :span="12" v-if="form.mode === 'warmup' && form.after_success_action === 'job'">
                            <a-form-item label="接续保活任务">
                                <a-select
                                    v-model:value="form.after_success_keepalive_job_id"
                                    allow-clear
                                    show-search
                                    placeholder="选择一个保活任务"
                                    :options="keepaliveJobOptions"
                                    :filter-option="filterOption"
                                />
                            </a-form-item>
                        </a-col>
                    </a-row>
                </div>

                <div class="form-section">
                    <div class="form-section-title">请求内容</div>
                    <a-row :gutter="16">
                        <a-col :span="8">
                            <a-form-item label="提示词分类">
                                <a-select v-model:value="form.prompt_category" :options="promptCategoryOptions" />
                            </a-form-item>
                        </a-col>
                        <a-col :span="8">
                            <a-form-item label="Max Tokens">
                                <a-input-number
                                    v-model:value="form.max_tokens"
                                    :min="1"
                                    :max="1024"
                                    style="width: 100%"
                                />
                            </a-form-item>
                        </a-col>
                        <a-col :span="8">
                            <a-form-item label="Temperature">
                                <a-input-number
                                    v-model:value="form.temperature"
                                    :min="0"
                                    :max="2"
                                    :step="0.1"
                                    style="width: 100%"
                                />
                            </a-form-item>
                        </a-col>
                        <a-col :span="24">
                            <a-form-item label="自定义提示词">
                                <a-textarea
                                    v-model:value="form.custom_prompts_text"
                                    :rows="4"
                                    placeholder="每行一个模板；留空则使用内置模板池"
                                />
                            </a-form-item>
                        </a-col>
                        <a-col :span="24">
                            <a-form-item label="System Prompt">
                                <a-textarea
                                    v-model:value="form.system_prompt"
                                    :rows="2"
                                    placeholder="可选"
                                />
                            </a-form-item>
                        </a-col>
                    </a-row>
                </div>
            </a-form>
        </a-modal>

        <a-modal
            v-model:open="promptTemplateOpen"
            title="内置提示词模板"
            width="900px"
            :confirm-loading="promptTemplateSaving"
            @ok="savePromptTemplates"
        >
            <div class="template-toolbar">
                <a-space>
                    <a-button :loading="promptTemplateLoading" @click="loadPromptTemplates">刷新</a-button>
                    <a-popconfirm
                        title="恢复为代码内置默认模板？"
                        ok-text="恢复"
                        cancel-text="取消"
                        @confirm="handleResetPromptTemplates"
                    >
                        <a-button danger>恢复默认</a-button>
                    </a-popconfirm>
                </a-space>
            </div>
            <a-spin :spinning="promptTemplateLoading">
                <a-tabs v-model:active-key="promptTemplateTab">
                    <a-tab-pane
                        v-for="category in promptTemplateCategories"
                        :key="category.value"
                        :tab="`${category.label} (${promptTemplateCounts[category.value]})`"
                    >
                        <div class="template-desc">{{ category.description }}</div>
                        <a-textarea
                            v-model:value="promptTemplateText[category.value]"
                            :rows="14"
                            placeholder="每行一个模板"
                        />
                    </a-tab-pane>
                </a-tabs>
            </a-spin>
        </a-modal>

        <a-drawer
            v-model:open="logDrawerOpen"
            width="920"
            :title="logJob ? `${logJob.name} 日志` : '运行日志'"
        >
            <div class="log-toolbar">
                <a-space>
                    <a-button @click="loadLogs">刷新</a-button>
                    <a-popconfirm
                        title="清空当前任务的唤醒日志？"
                        ok-text="清空"
                        cancel-text="取消"
                        ok-type="danger"
                        @confirm="handleClearLogs"
                    >
                        <a-button danger>
                            <DeleteOutlined /> 清空日志
                        </a-button>
                    </a-popconfirm>
                </a-space>
            </div>
            <a-table
                :columns="logColumns"
                :data-source="logs"
                :loading="logLoading"
                :pagination="logPagination"
                :row-key="(record: WakeupLog) => record.id"
                @change="handleLogTableChange"
            >
                <template #bodyCell="{ column, record }">
                    <template v-if="column.key === 'success'">
                        <a-tag :color="record.success ? 'green' : 'red'">
                            {{ record.success ? '成功' : '失败' }}
                        </a-tag>
                    </template>
                    <template v-else-if="column.key === 'http_status'">
                        {{ record.http_status || '-' }}
                    </template>
                    <template v-else-if="column.key === 'prompt_text'">
                        <span>{{ truncateText(record.prompt_text, 64) }}</span>
                    </template>
                    <template v-else-if="column.key === 'created_at'">
                        {{ formatDate(record.created_at) }}
                    </template>
                </template>
                <template #expandedRowRender="{ record }">
                    <div class="log-detail">
                        <div class="log-detail-title">Prompt</div>
                        <pre>{{ record.prompt_text }}</pre>
                        <template v-if="record.response_preview">
                            <div class="log-detail-title">Response Preview</div>
                            <pre>{{ record.response_preview }}</pre>
                        </template>
                        <template v-if="record.error_detail">
                            <div class="log-detail-title">Error Detail</div>
                            <pre>{{ record.error_detail }}</pre>
                        </template>
                    </div>
                </template>
            </a-table>
        </a-drawer>
    </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import type { TableColumnsType, TablePaginationConfig } from 'ant-design-vue';
import { Modal } from 'ant-design-vue/es';
import { DeleteOutlined, FileTextOutlined, PlusOutlined } from '@ant-design/icons-vue';
import {
    clearWakeupLogs,
    createWakeupJob,
    deleteWakeupJob,
    getWakeupPromptCategories,
    getWakeupPromptTemplates,
    listWakeupJobs,
    listWakeupLogs,
    resetWakeupPromptTemplates,
    runWakeupJob,
    toggleWakeupJob,
    updateWakeupPromptTemplates,
    updateWakeupJob,
} from '@/api/wakeup';
import { listVendors, listVendorModels } from '@/api/vendor';
import type { Vendor, VendorModel } from '@/types/vendor';
import type { WakeupAfterSuccessAction, WakeupJob, WakeupJobPayload, WakeupLog, WakeupMode, WakeupPromptCategory, WakeupPromptCategoryOption, WakeupPromptTemplateMap, WakeupScheduleMode } from '@/types/wakeup';
import { normalizeListResponse } from '@/utils/listResponse';
import { formatDate, truncateText } from '@/utils/format';
import { notifyRequestError, notifySuccess } from '@/utils/requestFeedback';

interface WakeupForm {
    name: string;
    vendor_id: number | null;
    vendor_model_id: number | null;
    model_name: string;
    format: 'openai' | 'anthropic' | 'responses';
    auto_convert: boolean;
    mode: WakeupMode;
    enabled: boolean;
    schedule_mode: WakeupScheduleMode;
    start_time: string;
    end_time: string;
    interval_min_minutes: number;
    interval_max_minutes: number;
    max_attempts: number;
    daily_limit: number;
    cooldown_after_429_minutes: number;
    after_success_action: WakeupAfterSuccessAction;
    after_success_keepalive_minutes: number;
    after_success_keepalive_interval_min_minutes: number;
    after_success_keepalive_interval_max_minutes: number;
    after_success_keepalive_job_id: number | null;
    prompt_category: WakeupPromptCategory;
    custom_prompts_text: string;
    system_prompt: string;
    max_tokens: number;
    temperature: number;
}

const loading = ref(false);
const jobs = ref<WakeupJob[]>([]);
const pagination = reactive({
    current: 1,
    pageSize: 10,
    total: 0,
    showSizeChanger: true,
    showQuickJumper: true,
    pageSizeOptions: ['10', '20', '50', '100'],
});

const searchForm = reactive<{
    keyword?: string;
    enabled?: string;
    mode?: WakeupMode;
}>({});

const formOpen = ref(false);
const saving = ref(false);
const editingId = ref<number | null>(null);
const vendors = ref<Vendor[]>([]);
const vendorModels = ref<VendorModel[]>([]);
const runningIds = ref(new Set<number>());
const togglingIds = ref(new Set<number>());

const logDrawerOpen = ref(false);
const logJob = ref<WakeupJob | null>(null);
const logLoading = ref(false);
const logs = ref<WakeupLog[]>([]);
const logPagination = reactive({
    current: 1,
    pageSize: 10,
    total: 0,
    showSizeChanger: true,
    showQuickJumper: true,
    pageSizeOptions: ['10', '20', '50'],
});

const promptCategories = ref<{ value: WakeupPromptCategory; label: string; description: string }[]>([]);
const promptTemplateOpen = ref(false);
const promptTemplateLoading = ref(false);
const promptTemplateSaving = ref(false);
const promptTemplateTab = ref<WakeupPromptCategory>('mixed');
const promptTemplateText = reactive<Record<WakeupPromptCategory, string>>({
    mixed: '',
    code: '',
    chat: '',
    self_chain: '',
});

const modeOptions = [
    { label: '唤醒', value: 'warmup' },
    { label: '保活', value: 'keepalive' },
];

const formatOptions = [
    { label: 'OpenAI', value: 'openai' },
    { label: 'Anthropic', value: 'anthropic' },
    { label: 'Responses', value: 'responses' },
];

const scheduleModeOptions = [
    { label: '仅每日窗口内', value: 'window' },
    { label: '全天持续保活', value: 'always' },
];

const afterSuccessActionOptions = [
    { label: '不保活', value: 'none' },
    { label: '持续保活', value: 'duration' },
    { label: '启用保活任务', value: 'job' },
];

const form = reactive<WakeupForm>({
    name: '',
    vendor_id: null,
    vendor_model_id: null,
    model_name: '',
    format: 'openai',
    auto_convert: false,
    mode: 'keepalive',
    enabled: true,
    schedule_mode: 'window',
    start_time: '08:30',
    end_time: '18:30',
    interval_min_minutes: 4,
    interval_max_minutes: 7,
    max_attempts: 8,
    daily_limit: 120,
    cooldown_after_429_minutes: 15,
    after_success_action: 'none',
    after_success_keepalive_minutes: 0,
    after_success_keepalive_interval_min_minutes: 4,
    after_success_keepalive_interval_max_minutes: 7,
    after_success_keepalive_job_id: null,
    prompt_category: 'mixed',
    custom_prompts_text: '',
    system_prompt: '',
    max_tokens: 64,
    temperature: 0.7,
});

const columns: TableColumnsType<WakeupJob> = [
    { title: '启用', key: 'enabled', width: 78 },
    { title: '任务', key: 'name', dataIndex: 'name', width: 180 },
    { title: '模式', key: 'mode', width: 90 },
    { title: '目标', key: 'target', width: 220 },
    { title: '窗口 / 间隔', key: 'window', width: 170 },
    { title: '上次状态', key: 'last_status', width: 180 },
    { title: '下次运行', key: 'next_run_at', width: 190 },
    { title: '操作', key: 'action', width: 170, fixed: 'right' as const },
];

const logColumns: TableColumnsType<WakeupLog> = [
    { title: '结果', key: 'success', width: 80 },
    { title: 'HTTP', key: 'http_status', width: 80 },
    { title: '耗时', key: 'duration_ms', dataIndex: 'duration_ms', width: 90 },
    { title: 'Prompt', key: 'prompt_text' },
    { title: '错误', key: 'error', dataIndex: 'error', width: 180 },
    { title: '时间', key: 'created_at', width: 180 },
];

const vendorOptions = computed(() => vendors.value.map(vendor => ({
    value: vendor.id,
    label: vendor.name,
})));

const modelOptions = computed(() => vendorModels.value.map(model => ({
    value: model.id,
    label: model.model_id,
})));

const keepaliveJobOptions = computed(() => jobs.value
    .filter(job => job.mode === 'keepalive' && job.id !== editingId.value)
    .map(job => ({
        value: job.id,
        label: `${job.name} (${job.model_name})`,
    })));

const promptCategoryOptions = computed(() => {
    if (promptCategories.value.length > 0) {
        return promptCategories.value.map(item => ({ value: item.value, label: item.label }));
    }

    return [
        { value: 'mixed', label: '混合' },
        { value: 'code', label: '代码向' },
        { value: 'chat', label: '闲聊向' },
        { value: 'self_chain', label: '自生成链' },
    ];
});

const promptTemplateCategories = computed<WakeupPromptCategoryOption[]>(() => {
    if (promptCategories.value.length > 0) {
        return promptCategories.value;
    }

    return [
        { value: 'mixed', label: '混合', description: '代码、运维和轻量闲聊混合模板' },
        { value: 'code', label: '代码向', description: '偏工程、调试、重构和测试的小问题' },
        { value: 'chat', label: '闲聊向', description: '偏日常、规划和低风险短回复' },
        { value: 'self_chain', label: '自生成链', description: '让模型用 JSON 返回下一次可用的问题' },
    ];
});

const promptTemplateCounts = computed<Record<WakeupPromptCategory, number>>(() => ({
    mixed: splitPromptTemplateText(promptTemplateText.mixed).length,
    code: splitPromptTemplateText(promptTemplateText.code).length,
    chat: splitPromptTemplateText(promptTemplateText.chat).length,
    self_chain: splitPromptTemplateText(promptTemplateText.self_chain).length,
}));

onMounted(() => {
    void loadOptions();
    void loadJobs();
});

function filterOption(input: string, option: { label: string }) {
    return option.label.toLowerCase().includes(input.toLowerCase());
}

async function loadOptions() {
    const [vendorResult, categories] = await Promise.all([
        listVendors({ pageSize: 1000 }),
        getWakeupPromptCategories(),
    ]);
    vendors.value = normalizeListResponse(vendorResult).list;
    promptCategories.value = categories;
}

async function loadJobs() {
    loading.value = true;
    try {
        const result = normalizeListResponse(await listWakeupJobs({
            ...searchForm,
            page: pagination.current,
            pageSize: pagination.pageSize,
        }));
        jobs.value = result.list;
        pagination.total = result.total;
    } finally {
        loading.value = false;
    }
}

function handleSearch() {
    pagination.current = 1;
    void loadJobs();
}

function handleReset() {
    searchForm.keyword = undefined;
    searchForm.enabled = undefined;
    searchForm.mode = undefined;
    pagination.current = 1;
    void loadJobs();
}

function handleTableChange(pag: TablePaginationConfig) {
    pagination.current = pag.current ?? 1;
    pagination.pageSize = pag.pageSize ?? pagination.pageSize;
    void loadJobs();
}

function resetForm() {
    editingId.value = null;
    form.name = '';
    form.vendor_id = null;
    form.vendor_model_id = null;
    form.model_name = '';
    form.format = 'openai';
    form.auto_convert = false;
    form.mode = 'keepalive';
    form.enabled = true;
    form.schedule_mode = 'window';
    form.start_time = '08:30';
    form.end_time = '18:30';
    form.interval_min_minutes = 4;
    form.interval_max_minutes = 7;
    form.max_attempts = 8;
    form.daily_limit = 120;
    form.cooldown_after_429_minutes = 15;
    form.after_success_action = 'none';
    form.after_success_keepalive_minutes = 0;
    form.after_success_keepalive_interval_min_minutes = 4;
    form.after_success_keepalive_interval_max_minutes = 7;
    form.after_success_keepalive_job_id = null;
    form.prompt_category = 'mixed';
    form.custom_prompts_text = '';
    form.system_prompt = '';
    form.max_tokens = 64;
    form.temperature = 0.7;
    vendorModels.value = [];
}

function openCreate() {
    resetForm();
    formOpen.value = true;
}

async function openEdit(record: WakeupJob) {
    resetForm();
    editingId.value = record.id;
    form.name = record.name;
    form.vendor_id = record.vendor_id;
    form.vendor_model_id = record.vendor_model_id;
    form.model_name = record.model_name;
    form.format = record.format;
    form.auto_convert = record.auto_convert;
    form.mode = record.mode;
    form.enabled = record.enabled;
    form.schedule_mode = record.schedule_mode;
    form.start_time = record.start_time;
    form.end_time = record.end_time;
    form.interval_min_minutes = Math.max(2, Math.round(record.interval_min_seconds / 60));
    form.interval_max_minutes = Math.max(form.interval_min_minutes, Math.round(record.interval_max_seconds / 60));
    form.max_attempts = record.max_attempts;
    form.daily_limit = record.daily_limit;
    form.cooldown_after_429_minutes = Math.max(5, Math.round(record.cooldown_after_429_seconds / 60));
    form.after_success_action = record.after_success_action;
    form.after_success_keepalive_minutes = record.after_success_keepalive_minutes;
    form.after_success_keepalive_interval_min_minutes = Math.max(2, Math.round(record.after_success_keepalive_interval_min_seconds / 60));
    form.after_success_keepalive_interval_max_minutes = Math.max(form.after_success_keepalive_interval_min_minutes, Math.round(record.after_success_keepalive_interval_max_seconds / 60));
    form.after_success_keepalive_job_id = record.after_success_keepalive_job_id;
    form.prompt_category = record.prompt_category;
    form.custom_prompts_text = record.custom_prompts.join('\n');
    form.system_prompt = record.system_prompt || '';
    form.max_tokens = record.max_tokens;
    form.temperature = record.temperature;
    if (record.vendor_id) {
        await loadVendorModels(record.vendor_id);
    }
    formOpen.value = true;
}

async function loadVendorModels(vendorId: number | null) {
    if (!vendorId) {
        vendorModels.value = [];
        return;
    }

    vendorModels.value = await listVendorModels(vendorId);
}

async function handleFormVendorChange(value: number) {
    form.vendor_model_id = null;
    form.model_name = '';
    await loadVendorModels(value);
}

function handleFormModelChange(value: number | undefined) {
    const model = vendorModels.value.find(item => item.id === value);
    if (model) {
        form.model_name = model.model_id;
    }
}

function buildPayload(): WakeupJobPayload | null {
    if (!form.name.trim()) {
        notifyRequestError(new Error('任务名称不能为空'));
        return null;
    }

    if (!form.vendor_id) {
        notifyRequestError(new Error('请选择供应商'));
        return null;
    }

    if (!form.model_name.trim()) {
        notifyRequestError(new Error('请填写上游模型名'));
        return null;
    }

    const intervalMin = Math.max(2, Math.floor(form.interval_min_minutes || 2));
    const intervalMax = Math.max(intervalMin, Math.floor(form.interval_max_minutes || intervalMin));
    const afterSuccessIntervalMin = Math.max(2, Math.floor(form.after_success_keepalive_interval_min_minutes || 2));
    const afterSuccessIntervalMax = Math.max(afterSuccessIntervalMin, Math.floor(form.after_success_keepalive_interval_max_minutes || afterSuccessIntervalMin));
    const afterSuccessAction = form.mode === 'warmup' ? form.after_success_action : 'none';

    if (afterSuccessAction === 'duration' && Math.floor(form.after_success_keepalive_minutes || 0) <= 0) {
        notifyRequestError(new Error('请填写成功后保活时长'));
        return null;
    }

    if (afterSuccessAction === 'job' && !form.after_success_keepalive_job_id) {
        notifyRequestError(new Error('请选择接续保活任务'));
        return null;
    }

    return {
        name: form.name.trim(),
        vendor_id: form.vendor_id,
        vendor_model_id: form.vendor_model_id,
        model_name: form.model_name.trim(),
        format: form.format,
        auto_convert: form.auto_convert,
        mode: form.mode,
        enabled: form.enabled,
        schedule_mode: form.mode === 'keepalive' ? form.schedule_mode : 'window',
        start_time: form.start_time.trim(),
        end_time: form.end_time.trim(),
        interval_min_seconds: intervalMin * 60,
        interval_max_seconds: intervalMax * 60,
        max_attempts: Math.max(1, Math.floor(form.max_attempts || 1)),
        daily_limit: Math.max(1, Math.floor(form.daily_limit || 1)),
        cooldown_after_429_seconds: Math.max(5, Math.floor(form.cooldown_after_429_minutes || 5)) * 60,
        after_success_action: afterSuccessAction,
        after_success_keepalive_minutes: afterSuccessAction === 'duration'
            ? Math.max(0, Math.floor(form.after_success_keepalive_minutes || 0))
            : 0,
        after_success_keepalive_interval_min_seconds: afterSuccessIntervalMin * 60,
        after_success_keepalive_interval_max_seconds: afterSuccessIntervalMax * 60,
        after_success_keepalive_job_id: afterSuccessAction === 'job'
            ? form.after_success_keepalive_job_id
            : null,
        prompt_category: form.prompt_category,
        custom_prompts: form.custom_prompts_text
            .split(/\r?\n/)
            .map(item => item.trim())
            .filter(Boolean),
        system_prompt: form.system_prompt.trim() || null,
        max_tokens: Math.max(1, Math.floor(form.max_tokens || 1)),
        temperature: Number(form.temperature || 0),
    };
}

function splitPromptTemplateText(value: string): string[] {
    return value
        .split(/\r?\n/)
        .map(item => item.trim())
        .filter(Boolean);
}

function toPromptTemplateMap(): WakeupPromptTemplateMap {
    return {
        mixed: splitPromptTemplateText(promptTemplateText.mixed),
        code: splitPromptTemplateText(promptTemplateText.code),
        chat: splitPromptTemplateText(promptTemplateText.chat),
        self_chain: splitPromptTemplateText(promptTemplateText.self_chain),
    };
}

function setPromptTemplateText(prompts: WakeupPromptTemplateMap) {
    promptTemplateText.mixed = prompts.mixed.join('\n');
    promptTemplateText.code = prompts.code.join('\n');
    promptTemplateText.chat = prompts.chat.join('\n');
    promptTemplateText.self_chain = prompts.self_chain.join('\n');
}

async function openPromptTemplates() {
    promptTemplateOpen.value = true;
    await loadPromptTemplates();
}

async function loadPromptTemplates() {
    promptTemplateLoading.value = true;
    try {
        const settings = await getWakeupPromptTemplates();
        promptCategories.value = settings.categories;
        setPromptTemplateText(settings.prompts);
    } catch (error) {
        notifyRequestError(error, '加载提示词模板失败');
    } finally {
        promptTemplateLoading.value = false;
    }
}

async function savePromptTemplates() {
    promptTemplateSaving.value = true;
    try {
        const settings = await updateWakeupPromptTemplates(toPromptTemplateMap());
        promptCategories.value = settings.categories;
        setPromptTemplateText(settings.prompts);
        notifySuccess('提示词模板已保存');
        promptTemplateOpen.value = false;
    } catch (error) {
        notifyRequestError(error, '保存提示词模板失败');
    } finally {
        promptTemplateSaving.value = false;
    }
}

async function handleResetPromptTemplates() {
    promptTemplateLoading.value = true;
    try {
        const settings = await resetWakeupPromptTemplates();
        promptCategories.value = settings.categories;
        setPromptTemplateText(settings.prompts);
        notifySuccess('已恢复默认提示词模板');
    } catch (error) {
        notifyRequestError(error, '恢复默认模板失败');
    } finally {
        promptTemplateLoading.value = false;
    }
}

async function submitForm() {
    const payload = buildPayload();
    if (!payload) return;

    saving.value = true;
    try {
        if (editingId.value) {
            await updateWakeupJob(editingId.value, payload);
            notifySuccess('任务已更新');
        } else {
            await createWakeupJob(payload);
            notifySuccess('任务已创建');
        }
        formOpen.value = false;
        await loadJobs();
    } catch (error) {
        notifyRequestError(error, '保存任务失败');
    } finally {
        saving.value = false;
    }
}

async function handleRun(record: WakeupJob) {
    runningIds.value = new Set([...runningIds.value, record.id]);
    try {
        const result = await runWakeupJob(record.id);
        if (result.success) {
            notifySuccess(`运行成功，耗时 ${result.duration}ms`);
        } else {
            notifyRequestError(new Error(result.error || `HTTP ${result.status || '未知'}`), '运行失败');
        }
        await loadJobs();
        if (logDrawerOpen.value && logJob.value?.id === record.id) {
            await loadLogs();
        }
    } catch (error) {
        notifyRequestError(error, '运行任务失败');
    } finally {
        const next = new Set(runningIds.value);
        next.delete(record.id);
        runningIds.value = next;
    }
}

async function handleToggle(record: WakeupJob, enabled: boolean) {
    togglingIds.value = new Set([...togglingIds.value, record.id]);
    try {
        await toggleWakeupJob(record.id, enabled);
        record.enabled = enabled;
        notifySuccess(enabled ? '任务已启用' : '任务已停用');
        await loadJobs();
    } catch (error) {
        notifyRequestError(error, '切换任务状态失败');
    } finally {
        const next = new Set(togglingIds.value);
        next.delete(record.id);
        togglingIds.value = next;
    }
}

function handleToggleChange(record: WakeupJob, checked: unknown) {
    void handleToggle(record, Boolean(checked));
}

function handleDelete(record: WakeupJob) {
    Modal.confirm({
        title: '确认删除',
        content: `确定要删除任务 "${record.name}" 吗？关联唤醒日志也会被删除。`,
        okText: '删除',
        cancelText: '取消',
        okType: 'danger',
        onOk: async () => {
            try {
                await deleteWakeupJob(record.id);
                notifySuccess('任务已删除');
                await loadJobs();
            } catch (error) {
                notifyRequestError(error, '删除任务失败');
            }
        },
    });
}

async function openLogs(record: WakeupJob) {
    logJob.value = record;
    logPagination.current = 1;
    logDrawerOpen.value = true;
    await loadLogs();
}

async function loadLogs() {
    if (!logJob.value) return;

    logLoading.value = true;
    try {
        const result = normalizeListResponse(await listWakeupLogs({
            job_id: logJob.value.id,
            page: logPagination.current,
            pageSize: logPagination.pageSize,
        }));
        logs.value = result.list;
        logPagination.total = result.total;
    } finally {
        logLoading.value = false;
    }
}

function handleLogTableChange(pag: TablePaginationConfig) {
    logPagination.current = pag.current ?? 1;
    logPagination.pageSize = pag.pageSize ?? logPagination.pageSize;
    void loadLogs();
}

async function handleClearLogs() {
    if (!logJob.value) return;

    try {
        const result = await clearWakeupLogs(logJob.value.id);
        notifySuccess(`已清理 ${result.deleted} 条日志`);
        logPagination.current = 1;
        await loadLogs();
    } catch (error) {
        notifyRequestError(error, '清理日志失败');
    }
}

function getModeLabel(mode: WakeupMode): string {
    return mode === 'warmup' ? '唤醒' : '保活';
}

function getStatusLabel(status: string): string {
    const labels: Record<string, string> = {
        idle: '待运行',
        success: '成功',
        failed: '失败',
        rate_limited: '429 冷却',
        skipped: '已跳过',
        keeping_alive: '保活中',
    };
    return labels[status] || status;
}

function getStatusColor(status: string): string {
    const colors: Record<string, string> = {
        idle: 'default',
        success: 'green',
        failed: 'red',
        rate_limited: 'orange',
        skipped: 'blue',
        keeping_alive: 'cyan',
    };
    return colors[status] || 'default';
}

function formatInterval(record: WakeupJob): string {
    const min = Math.round(record.interval_min_seconds / 60);
    const max = Math.round(record.interval_max_seconds / 60);
    const parts = [`${min}-${max} 分钟`, `429 冷却 ${Math.round(record.cooldown_after_429_seconds / 60)} 分钟`];
    if (record.mode === 'keepalive') {
        parts.unshift(record.schedule_mode === 'always' ? '全天持续保活' : '仅每日窗口内');
    }
    if (record.mode === 'warmup' && record.after_success_action === 'duration' && record.after_success_keepalive_minutes > 0) {
        const keepaliveMin = Math.round(record.after_success_keepalive_interval_min_seconds / 60);
        const keepaliveMax = Math.round(record.after_success_keepalive_interval_max_seconds / 60);
        parts.push(`成功后保活 ${record.after_success_keepalive_minutes} 分钟，间隔 ${keepaliveMin}-${keepaliveMax} 分钟`);
    }
    if (record.mode === 'warmup' && record.after_success_action === 'job' && record.after_success_keepalive_job_name) {
        parts.push(`成功后启用 ${record.after_success_keepalive_job_name}`);
    }
    return parts.join('，');
}
</script>

<style scoped>
.wakeup-page {
    background: var(--bg-page);
    padding: 24px;
}

.page-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 16px;
    margin-bottom: 20px;
}

.page-title {
    margin: 0;
    font-size: 20px;
    font-weight: 600;
    color: var(--text-primary);
}

.page-desc {
    margin-top: 6px;
    color: var(--text-secondary);
    font-size: 13px;
}

.table-header {
    margin-bottom: 16px;
}

.target-cell {
    min-width: 0;
}

.target-main {
    color: var(--text-primary);
    font-weight: 500;
}

.target-sub,
.table-sub {
    color: var(--text-secondary);
    font-size: 12px;
    line-height: 1.5;
    word-break: break-all;
}

.status-code {
    margin-left: 6px;
    color: var(--text-secondary);
    font-size: 12px;
}

.error-text {
    color: #cf1322;
}

.job-form {
    max-height: 68vh;
    overflow-y: auto;
    padding-right: 6px;
}

.form-section {
    padding: 2px 0 8px;
}

.form-section:not(:last-child) {
    border-bottom: 1px solid var(--border-color);
    margin-bottom: 18px;
}

.form-section-title {
    color: var(--text-primary);
    font-size: 14px;
    font-weight: 600;
    margin-bottom: 14px;
}

.job-form :deep(.ant-form-item) {
    margin-bottom: 16px;
}

.time-range-control,
.range-control {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    align-items: center;
    gap: 8px;
    width: 100%;
}

.range-separator {
    color: var(--text-secondary);
    white-space: nowrap;
}

.template-toolbar {
    display: flex;
    justify-content: flex-end;
    margin-bottom: 12px;
}

.template-desc {
    color: var(--text-secondary);
    font-size: 13px;
    line-height: 1.5;
    margin-bottom: 10px;
}

.log-toolbar {
    display: flex;
    justify-content: flex-end;
    margin-bottom: 12px;
}

.log-detail {
    background: var(--bg-page);
    border: 1px solid var(--border-color);
    border-radius: 8px;
    padding: 12px;
}

.log-detail-title {
    color: var(--text-primary);
    font-size: 13px;
    font-weight: 600;
    margin-bottom: 6px;
}

.log-detail-title:not(:first-child) {
    margin-top: 12px;
}

.log-detail pre {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
    color: var(--text-secondary);
    font-size: 12px;
    line-height: 1.5;
}
</style>
