<template>
    <a-modal
        v-model:open="visible"
        title="新建模型"
        width="900px"
        @cancel="handleCancel"
        :confirm-loading="loading"
    >
        <template #footer>
            <div class="modal-footer">
                <a-button :disabled="!primaryRoute?.vendor_id" @click="handleTest()">
                    测试优先路由
                </a-button>
                <div>
                    <a-button @click="handleCancel">Cancel</a-button>
                    <a-button type="primary" :loading="loading" @click="handleOk">OK</a-button>
                </div>
            </div>
        </template>
        <a-form
            :model="formState"
            :rules="rules"
            layout="vertical"
            ref="formRef"
        >
            <a-form-item label="模型名称" name="name">
                <a-input v-model:value="formState.name" placeholder="请输入模型名称" />
            </a-form-item>
            <a-form-item label="状态" name="enable">
                <a-switch v-model:checked="formState.enable" />
            </a-form-item>

            <div class="route-section">
                <div class="route-section-header">
                    <span>供应商路由</span>
                    <a-button size="small" @click="addRoute">添加路由</a-button>
                </div>

                <div
                    v-for="(route, index) in routeRows"
                    :key="route.local_id"
                    class="route-row"
                >
                    <div class="route-fields">
                        <a-select
                            v-model:value="route.vendor_id"
                            placeholder="供应商"
                            :loading="vendorsLoading"
                            class="route-vendor"
                            @change="handleRouteVendorChange(route)"
                        >
                            <a-select-option
                                v-for="vendor in vendors"
                                :key="vendor.id"
                                :value="vendor.id"
                            >
                                {{ vendor.name }}
                            </a-select-option>
                        </a-select>
                        <a-select
                            v-model:value="route.vendor_model_id"
                            placeholder="自动（使用模型名称）"
                            :loading="isRouteVendorModelsLoading(route.local_id)"
                            allow-clear
                            class="route-model"
                            :disabled="!route.vendor_id"
                        >
                            <a-select-option
                                v-for="vm in getRouteVendorModels(route.local_id)"
                                :key="vm.id"
                                :value="vm.id"
                            >
                                {{ vm.model_id }}
                            </a-select-option>
                        </a-select>
                        <a-input-number
                            v-model:value="route.priority"
                            :min="0"
                            :precision="0"
                            class="route-number"
                            addon-before="优先级"
                        />
                        <a-input-number
                            v-model:value="route.weight"
                            :min="1"
                            :precision="0"
                            class="route-number"
                            addon-before="权重"
                        />
                        <a-switch v-model:checked="route.enabled" />
                    </div>
                    <div class="route-meta">
                        <span class="format-list">
                            <template v-if="getRouteFormats(route).length > 0">
                                <a-tag
                                    v-for="fmt in getRouteFormats(route)"
                                    :key="fmt"
                                    :color="formatTagColor(fmt)"
                                >
                                    {{ fmt.toUpperCase() }}
                                </a-tag>
                            </template>
                            <span v-else>协议按供应商 URL 自动判断</span>
                        </span>
                        <a-space>
                            <a-button type="link" size="small" @click="setPrimaryRoute(index)">设为优先</a-button>
                            <a-button type="link" size="small" :disabled="!route.vendor_id" @click="handleTest(route)">测试</a-button>
                            <a-button type="link" danger size="small" @click="removeRoute(index)">删除</a-button>
                        </a-space>
                    </div>
                </div>
            </div>
        </a-form>
    </a-modal>

    <DialogTest ref="testDialogRef" />
</template>

<script setup lang="ts">
import { ref, reactive, computed } from 'vue';
import type { FormInstance } from 'ant-design-vue/es';
import { createModel } from '@/api/model';
import { listVendors, listVendorModels } from '@/api/vendor';
import type { Model, ModelProviderRouteInput } from '@/types/model';
import type { Vendor as VendorType, VendorModel } from '@/types/vendor';
import { normalizeListResponse } from '@/utils/listResponse';
import { notifyError, notifyRequestError, notifySuccess } from '@/utils/requestFeedback';
import DialogTest from '@/views/Vendor/DialogTest.vue';

interface RouteFormItem {
    local_id: string;
    vendor_id?: number;
    vendor_model_id?: number;
    priority: number;
    weight: number;
    enabled: boolean;
}

const emit = defineEmits<{
    success: [model: Model];
}>();

const visible = ref(false);
const loading = ref(false);
const formRef = ref<FormInstance>();
const testDialogRef = ref<InstanceType<typeof DialogTest>>();

const formState = reactive({
    name: '',
    enable: true,
});

const rules = {
    name: [{ required: true, message: '请输入模型名称' }],
};

const vendors = ref<VendorType[]>([]);
const vendorsLoading = ref(false);
const routeRows = ref<RouteFormItem[]>([]);
const routeVendorModels = reactive<Record<string, VendorModel[]>>({});
const routeVendorModelsLoading = reactive<Record<string, boolean>>({});

const primaryRoute = computed(() => {
    const enabledRoutes = routeRows.value.filter(route => route.enabled && route.vendor_id);
    const source = enabledRoutes.length > 0 ? enabledRoutes : routeRows.value.filter(route => route.vendor_id);
    return [...source].sort((a, b) => a.priority - b.priority)[0];
});

function createRoute(priority = 100): RouteFormItem {
    return {
        local_id: `${Date.now()}-${Math.random()}`,
        vendor_id: undefined,
        vendor_model_id: undefined,
        priority,
        weight: 1,
        enabled: true,
    };
}

async function loadVendors() {
    vendorsLoading.value = true;
    try {
        vendors.value = normalizeListResponse(await listVendors({ page: 1, pageSize: 1000 })).list;
    } catch (error) {
        notifyRequestError(error, '加载供应商列表失败');
    } finally {
        vendorsLoading.value = false;
    }
}

async function loadVendorModels(route: RouteFormItem) {
    if (!route.vendor_id) return;
    routeVendorModelsLoading[route.local_id] = true;
    try {
        routeVendorModels[route.local_id] = await listVendorModels(route.vendor_id);
    } catch {
        routeVendorModels[route.local_id] = [];
    } finally {
        routeVendorModelsLoading[route.local_id] = false;
    }
}

function handleRouteVendorChange(route: RouteFormItem) {
    route.vendor_model_id = undefined;
    routeVendorModels[route.local_id] = [];
    void loadVendorModels(route);
}

function getRouteVendorModels(localId: string): VendorModel[] {
    return routeVendorModels[localId] ?? [];
}

function isRouteVendorModelsLoading(localId: string): boolean {
    return Boolean(routeVendorModelsLoading[localId]);
}

function getRouteFormats(route: RouteFormItem): string[] {
    if (!route.vendor_model_id) return [];
    const model = getRouteVendorModels(route.local_id).find(vm => vm.id === route.vendor_model_id);
    return model?.allowed_formats ?? [];
}

function formatTagColor(fmt: string): string {
    if (fmt === 'anthropic') return 'orange';
    if (fmt === 'responses') return 'blue';
    return 'default';
}

function addRoute() {
    const maxPriority = routeRows.value.length > 0
        ? Math.max(...routeRows.value.map(route => route.priority))
        : 90;
    routeRows.value.push(createRoute(maxPriority + 10));
}

function removeRoute(index: number) {
    if (routeRows.value.length <= 1) {
        notifyError('至少保留一条路由');
        return;
    }
    routeRows.value.splice(index, 1);
}

function setPrimaryRoute(index: number) {
    routeRows.value.forEach((route, routeIndex) => {
        route.priority = routeIndex === index ? 0 : Math.max(route.priority, 10 + routeIndex);
    });
}

function getUpstreamModelName(route: RouteFormItem): string {
    if (route.vendor_model_id) {
        return getRouteVendorModels(route.local_id).find(vm => vm.id === route.vendor_model_id)?.model_id ?? formState.name;
    }
    return formState.name;
}

function handleTest(route?: RouteFormItem) {
    const targetRoute = route ?? primaryRoute.value;
    const vendor = vendors.value.find(v => v.id === targetRoute?.vendor_id);
    if (!vendor || !targetRoute) return;

    const vendorModel = targetRoute.vendor_model_id
        ? getRouteVendorModels(targetRoute.local_id).find(vm => vm.id === targetRoute.vendor_model_id)
        : null;
    testDialogRef.value?.open(vendor, getUpstreamModelName(targetRoute) || undefined, {
        modelName: formState.name,
        vendorModelName: vendorModel?.model_id ?? null,
        allowedFormats: vendorModel?.allowed_formats ?? null,
        showAutoConvert: true,
    });
}

function normalizeRoutes(): ModelProviderRouteInput[] | null {
    const routes = routeRows.value
        .filter(route => route.vendor_id)
        .map(route => ({
            vendor_id: route.vendor_id!,
            vendor_model_id: route.vendor_model_id ?? null,
            priority: route.priority,
            weight: route.weight,
            enabled: route.enabled,
        }));

    if (routes.length === 0) {
        notifyError('请至少配置一条供应商路由');
        return null;
    }

    return routes;
}

function open() {
    routeRows.value = [createRoute()];
    void loadVendors();
    visible.value = true;
}

async function handleOk() {
    try {
        await formRef.value?.validate();
        const routes = normalizeRoutes();
        if (!routes) return;

        loading.value = true;
        const primary = primaryRoute.value;
        const model = await createModel({
            name: formState.name,
            vendor_id: primary?.vendor_id,
            vendor_model_id: primary?.vendor_model_id ?? null,
            enable: formState.enable,
            routes,
        });
        notifySuccess('创建成功');
        emit('success', model);
        handleCancel();
    } catch (error) {
        notifyRequestError(error, '创建失败');
    } finally {
        loading.value = false;
    }
}

function handleCancel() {
    visible.value = false;
    formState.name = '';
    formState.enable = true;
    routeRows.value = [];
    Object.keys(routeVendorModels).forEach(key => delete routeVendorModels[key]);
    Object.keys(routeVendorModelsLoading).forEach(key => delete routeVendorModelsLoading[key]);
}

defineExpose({ open });
</script>

<style scoped>
.modal-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
}

.modal-footer > div {
    display: flex;
    gap: 8px;
}

.route-section {
    display: flex;
    flex-direction: column;
    gap: 10px;
}

.route-section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-weight: 500;
}

.route-row {
    border: 1px solid var(--color-border-secondary, #f0f0f0);
    border-radius: 6px;
    padding: 10px;
}

.route-fields {
    display: grid;
    grid-template-columns: minmax(150px, 1fr) minmax(180px, 1.2fr) 130px 120px 56px;
    gap: 8px;
    align-items: center;
}

.route-vendor,
.route-model,
.route-number {
    width: 100%;
}

.route-meta {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    margin-top: 8px;
    color: var(--color-text-secondary, #888);
    font-size: 12px;
}

.format-list {
    min-height: 22px;
}

@media (max-width: 760px) {
    .route-fields {
        grid-template-columns: 1fr;
    }

    .route-meta {
        align-items: flex-start;
        flex-direction: column;
    }
}
</style>
