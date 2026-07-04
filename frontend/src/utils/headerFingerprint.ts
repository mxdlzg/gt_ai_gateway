import { getHeaderFingerprintPresets } from '@/api/config';
import type { HeaderFingerprintPreset } from '@/api/config';

export type HeaderFingerprintValue = string;

interface SelectOption {
    label: string;
    value: string;
    disabled?: boolean;
}

const SYSTEM_VENDOR_OPTIONS: SelectOption[] = [
    { label: '透传客户端', value: 'auto' },
    { label: '无', value: 'none' },
];

const presetOptions: SelectOption[] = [
    { label: 'Claude CLI', value: 'claude_cli' },
    { label: 'Codex CLI', value: 'codex_cli' },
];

const vendorOptions: SelectOption[] = [
    ...SYSTEM_VENDOR_OPTIONS,
    ...presetOptions,
];

const modelOptions: SelectOption[] = [
    { label: '继承供应商', value: '' },
    ...vendorOptions,
];

const wakeupOptions: SelectOption[] = [
    { label: '继承供应商/模型', value: '' },
    { label: '无', value: 'none' },
    ...presetOptions,
    { label: '透传客户端（后台任务无客户端）', value: 'auto', disabled: true },
];

let presets: HeaderFingerprintPreset[] = [
    { key: 'claude_cli', label: 'Claude CLI', headers: {} },
    { key: 'codex_cli', label: 'Codex CLI', headers: {} },
];
let loadingPromise: Promise<void> | null = null;

function normalizePresetOptions(items: HeaderFingerprintPreset[]): SelectOption[] {
    const seen = new Set<string>();
    const options: SelectOption[] = [];
    for (const item of items) {
        const key = item.key?.trim();
        if (!key || key === 'auto' || key === 'none' || seen.has(key)) continue;
        seen.add(key);
        options.push({
            label: item.label?.trim() || key,
            value: key,
        });
    }

    return options;
}

function replaceOptions(target: SelectOption[], next: SelectOption[]): void {
    target.splice(0, target.length, ...next);
}

function applyPresets(items: HeaderFingerprintPreset[]): void {
    presets = [...items];
    const nextPresetOptions = normalizePresetOptions(items);
    replaceOptions(presetOptions, nextPresetOptions);
    replaceOptions(vendorOptions, [
        ...SYSTEM_VENDOR_OPTIONS,
        ...nextPresetOptions,
    ]);
    replaceOptions(modelOptions, [
        { label: '继承供应商', value: '' },
        ...vendorOptions,
    ]);
    replaceOptions(wakeupOptions, [
        { label: '继承供应商/模型', value: '' },
        { label: '无', value: 'none' },
        ...nextPresetOptions,
        { label: '透传客户端（后台任务无客户端）', value: 'auto', disabled: true },
    ]);
}

async function loadPresets(force = false): Promise<void> {
    if (loadingPromise && !force) {
        return loadingPromise;
    }

    loadingPromise = getHeaderFingerprintPresets()
        .then(settings => {
            applyPresets(settings.presets);
        })
        .catch(() => {
            // Keep the local fallback options when settings cannot be loaded.
        })
        .finally(() => {
            loadingPromise = null;
        });

    return loadingPromise;
}

function getLabel(value?: string | null): string {
    const key = value ?? '';
    if (key === '') return '继承供应商';
    if (key === 'auto') return '透传客户端';
    if (key === 'none') return '无';

    const preset = presets.find(item => item.key === key);
    return preset?.label || key;
}

function getTagColor(value?: string | null): string {
    if (!value) return 'default';
    if (value === 'claude_cli') return 'orange';
    if (value === 'codex_cli') return 'blue';
    if (value === 'none') return 'red';
    if (value === 'auto') return 'green';
    return 'purple';
}

export default {
    applyPresets,
    getLabel,
    getTagColor,
    loadPresets,
    modelOptions,
    wakeupOptions,
    vendorOptions,
};
