import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { status } from '@/api/system';
import { clearAuthToken, getAuthToken, setAuthToken } from '@/utils/authSession';

export const useAuthStore = defineStore('auth', () => {
    const token = ref<string>(getAuthToken());
    const userType = ref<string>('');
    const isLoading = ref(false);

    const isAuthenticated = computed(() => !!token.value);

    function setToken(newToken: string) {
        token.value = newToken;
        setAuthToken(newToken);
    }

    function clearToken() {
        token.value = '';
        userType.value = '';
        clearAuthToken();
    }

    async function validateToken(): Promise<boolean> {
        if (!token.value) return false;

        isLoading.value = true;
        try {
            const data = await status();
            if (data && data.user_type) {
                userType.value = data.user_type;
            } else {
                userType.value = 'admin';
            }
            return true;
        } catch {
            clearToken();
            return false;
        } finally {
            isLoading.value = false;
        }
    }

    async function login(newToken: string): Promise<boolean> {
        setToken(newToken);
        return await validateToken();
    }

    function logout() {
        clearToken();
    }

    return {
        token,
        userType,
        isLoading,
        isAuthenticated,
        setToken,
        clearToken,
        validateToken,
        login,
        logout,
    };
});
