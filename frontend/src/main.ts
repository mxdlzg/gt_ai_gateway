import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { ConfigProvider } from 'ant-design-vue';
import App from './App.vue';
import router from './router';
import './style.css';
import { setBaseURL } from './utils/request';
import { setAuthToken } from './utils/authSession';

async function bootstrap() {
    // Desktop 模式下，Splash Screen 已经将参数存入 localStorage
    const storedUrl = localStorage.getItem('backendBaseURL');
    if (storedUrl) {
        setBaseURL(storedUrl);
    }
    const token = localStorage.getItem('adminToken');
    if (token) {
        setAuthToken(token);
    }

    const app = createApp(App);
    const pinia = createPinia();

    app.use(pinia);
    app.use(router);
    app.component('AConfigProvider', ConfigProvider);
    app.mount('#app');
}

bootstrap();
