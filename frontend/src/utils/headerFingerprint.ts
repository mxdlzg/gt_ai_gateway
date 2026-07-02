export type HeaderFingerprintValue = '' | 'auto' | 'none' | 'claude_cli' | 'codex_cli';

const VENDOR_OPTIONS = [
    { label: '透传客户端', value: 'auto' },
    { label: '无', value: 'none' },
    { label: 'Claude CLI', value: 'claude_cli' },
    { label: 'Codex CLI', value: 'codex_cli' },
];

const MODEL_OPTIONS = [
    { label: '继承供应商', value: '' },
    ...VENDOR_OPTIONS,
];

const LABEL_MAP: Record<HeaderFingerprintValue, string> = {
    '': '继承供应商',
    auto: '透传客户端',
    none: '无',
    claude_cli: 'Claude CLI',
    codex_cli: 'Codex CLI',
};


function getLabel(value?: string | null): string {
    const key = (value ?? '') as HeaderFingerprintValue;
    return LABEL_MAP[key] ?? '透传客户端';
}


function getTagColor(value?: string | null): string {
    if (!value) return 'default';
    if (value === 'claude_cli') return 'orange';
    if (value === 'codex_cli') return 'blue';
    if (value === 'none') return 'red';
    return 'green';
}


export default {
    getLabel,
    getTagColor,
    modelOptions: MODEL_OPTIONS,
    vendorOptions: VENDOR_OPTIONS,
};
