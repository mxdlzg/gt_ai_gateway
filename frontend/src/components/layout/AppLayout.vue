<template>
    <div class="app-layout">
        <AppHeader />
        <div class="layout-body">
            <AppSidebar />
            <div class="main-content">
                <router-view />
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import AppHeader from './AppHeader.vue';
import AppSidebar from './AppSidebar.vue';
import { useAuthStore } from '@/stores/auth';
import { getConfig } from '@/api/config';
import { DEFAULT_REQUEST_TIMEOUT_MS, setRequestTimeoutMs } from '@/utils/request';

const authStore = useAuthStore();

onMounted(async () => {
    if (authStore.isAuthenticated && !authStore.userType) {
        await authStore.validateToken();
    }

    if (authStore.isAuthenticated) {
        try {
            const config = await getConfig();
            setRequestTimeoutMs(config.test_request_timeout_ms || DEFAULT_REQUEST_TIMEOUT_MS);
        } catch {
            setRequestTimeoutMs(DEFAULT_REQUEST_TIMEOUT_MS);
        }
    }
});
</script>

<style scoped>
.app-layout {
    display: flex;
    flex-direction: column;
    height: 100vh;
    background: var(--bg-layout);
}

.layout-body {
    display: flex;
    flex: 1;
    overflow: hidden;
}

.main-content {
    flex: 1;
    overflow-y: auto;
    padding: 24px;
    background: var(--bg-page);
}
</style>
