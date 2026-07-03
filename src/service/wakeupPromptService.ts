import configService, { ConfigKey } from "./configService";

export type WakeupPromptCategory = "mixed" | "code" | "chat" | "self_chain";

interface PromptChoice {
    category: WakeupPromptCategory;
    text: string;
}

type PromptTemplateMap = Record<WakeupPromptCategory, string[]>;

const CODE_PROMPTS = [
    "Give one concise tip for making TypeScript error handling easier to maintain.",
    "Explain one small refactor that can reduce duplication in a service layer.",
    "Write a tiny JavaScript function that clamps a number between two bounds.",
    "Name one practical reason to keep controllers thin in an MVC backend.",
    "Suggest one lightweight test case for a retry mechanism that handles HTTP 429.",
    "Explain the difference between a timeout and a connection failure in one sentence.",
    "Give a short example of validating an integer query parameter safely.",
    "Name one way to make request logs useful without storing sensitive data.",
    "Explain why idempotent cleanup jobs are easier to operate.",
    "Write a one-line SQL idea for finding records older than a retention window.",
    "Suggest one improvement for a Vue table that lists background jobs.",
    "Explain one reason to keep prompt template selection deterministic within a test.",
    "Give a compact checklist for adding a database migration safely.",
    "Name one risk of unbounded background retries.",
    "Describe one simple exponential backoff rule.",
    "Write a tiny pseudo-code loop that skips disabled jobs.",
    "Explain one benefit of storing last_error on scheduled jobs.",
    "Suggest one status label for a task paused after HTTP 429.",
    "Name one reason to cap response previews in logs.",
    "Give one short tip for avoiding race conditions in a timer loop.",
    "Explain how a nullable next_run_at can be used by a scheduler.",
    "Write a small JSON object representing a healthy background job.",
    "Suggest one useful field for a provider health-check log.",
    "Explain why a direct upstream health request should not bill a gateway user.",
];

const CHAT_PROMPTS = [
    "Reply with one sentence: what is a calm way to start a busy workday?",
    "Give a brief productivity suggestion for returning from lunch.",
    "Name one small habit that keeps a project dashboard tidy.",
    "Share one neutral conversation starter about planning the afternoon.",
    "Summarize in one sentence why short feedback loops help teams.",
    "Suggest one low-effort way to organize notes after a meeting.",
    "Give one sentence about balancing focus time and communication.",
    "Name one way to make a morning checklist less stressful.",
    "Offer a concise reminder for reviewing priorities before coding.",
    "Give one practical tip for reducing context switching.",
    "Respond with a short, friendly sentence about steady progress.",
    "Name one small thing to check before starting a long task.",
    "Suggest one sentence for politely asking for clearer requirements.",
    "Give one quick tip for ending the day with less loose context.",
    "Explain in one sentence why naming things clearly matters.",
    "Share one brief idea for keeping a backlog readable.",
    "Give a short answer: how can someone make a task easier to resume?",
    "Name one useful question to ask before changing production settings.",
    "Reply with one compact sentence about useful logs.",
    "Suggest one neutral topic for a quick team check-in.",
    "Give one sentence about patience during slow external API calls.",
    "Name one way to keep documentation approachable.",
    "Share one concise reminder about taking breaks without losing momentum.",
    "Give one short planning question for the next hour.",
];

const MIXED_PROMPTS = [
    ...CODE_PROMPTS.slice(0, 12),
    ...CHAT_PROMPTS.slice(0, 12),
    "In one sentence, compare a warm-up request with a full user request.",
    "Give one concise reason to keep background jobs observable.",
    "Suggest one tiny code review question about scheduled tasks.",
    "Reply with one short sentence about making defaults conservative.",
    "Name one useful metric for a provider availability dashboard.",
    "Give one practical note about random jitter in scheduled work.",
    "Explain in one sentence why repeated identical probes are less useful than varied probes.",
    "Suggest one compact health-check message that asks for a short response.",
];

const SELF_CHAIN_STARTERS = [
    "What is one small improvement for a provider health dashboard?",
    "What is one safe default for a background keepalive interval?",
    "What is one useful thing to show beside a scheduled job's next run time?",
    "What is one simple way to make API error messages easier to debug?",
    "What is one concise question a developer can ask before adding a retry loop?",
];

const CATEGORY_DEFINITIONS = [
    { value: "mixed", label: "混合", description: "代码、运维和轻量闲聊混合模板" },
    { value: "code", label: "代码向", description: "偏工程、调试、重构和测试的小问题" },
    { value: "chat", label: "闲聊向", description: "偏日常、规划和低风险短回复" },
    { value: "self_chain", label: "自生成链", description: "让模型用 JSON 返回下一次可用的问题" },
] as const;


function pick<T>(items: T[]): T {
    return items[Math.floor(Math.random() * items.length)];
}


function normalizeCategory(value: unknown): WakeupPromptCategory {
    if (value === "code" || value === "chat" || value === "self_chain") {
        return value;
    }

    return "mixed";
}


function getDefaultPromptTemplates(): PromptTemplateMap {
    return {
        mixed: [...MIXED_PROMPTS],
        code: [...CODE_PROMPTS],
        chat: [...CHAT_PROMPTS],
        self_chain: [...SELF_CHAIN_STARTERS],
    };
}


function normalizePromptList(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }

    return value
        .map(item => String(item).trim())
        .filter(Boolean)
        .slice(0, 200)
        .map(item => item.slice(0, 2000));
}


function parseStoredPromptTemplates(value: string): Partial<PromptTemplateMap> {
    if (!value.trim()) {
        return {};
    }

    try {
        const parsed = JSON.parse(value) as Record<string, unknown>;
        const result: Partial<PromptTemplateMap> = {};
        for (const category of CATEGORY_DEFINITIONS) {
            const list = normalizePromptList(parsed[category.value]);
            if (list.length > 0) {
                result[category.value] = list;
            }
        }

        return result;
    } catch {
        return {};
    }
}


async function getPromptTemplates(): Promise<PromptTemplateMap> {
    const defaults = getDefaultPromptTemplates();
    const stored = parseStoredPromptTemplates(
        (await configService.getConfig(ConfigKey.WAKEUP_PROMPT_TEMPLATES, "")).getString(),
    );

    return {
        mixed: stored.mixed ?? defaults.mixed,
        code: stored.code ?? defaults.code,
        chat: stored.chat ?? defaults.chat,
        self_chain: stored.self_chain ?? defaults.self_chain,
    };
}


function buildSelfChainPrompt(nextPrompt: string | null | undefined, starters: string[]): string {
    const currentQuestion = nextPrompt?.trim() || pick(starters.length > 0 ? starters : SELF_CHAIN_STARTERS);
    return [
        "Return JSON only with this shape:",
        "{\"answer\":\"one short answer\",\"next_prompt\":\"one new harmless short question for a future lightweight model check\"}",
        `Current question: ${currentQuestion}`,
    ].join("\n");
}


async function buildPrompt(
    categoryValue: unknown,
    customPrompts: string[] = [],
    nextPrompt: string | null = null,
): Promise<PromptChoice> {
    const category = normalizeCategory(categoryValue);
    const customPool = customPrompts.map(item => item.trim()).filter(Boolean);
    const templates = await getPromptTemplates();

    if (customPool.length > 0) {
        return {
            category,
            text: pick(customPool),
        };
    }

    if (category === "self_chain") {
        return {
            category,
            text: buildSelfChainPrompt(nextPrompt, templates.self_chain),
        };
    }

    if (category === "code") {
        return {
            category,
            text: pick(templates.code),
        };
    }

    if (category === "chat") {
        return {
            category,
            text: pick(templates.chat),
        };
    }

    return {
        category,
        text: pick(templates.mixed),
    };
}


function getCategories() {
    return CATEGORY_DEFINITIONS.map(item => ({ ...item }));
}


async function getPromptTemplateSettings() {
    return {
        categories: getCategories(),
        prompts: await getPromptTemplates(),
        defaults: getDefaultPromptTemplates(),
    };
}


async function updatePromptTemplates(data: Record<string, unknown>) {
    const prompts = data.prompts && typeof data.prompts === "object"
        ? data.prompts as Record<string, unknown>
        : data;
    const normalized: Partial<PromptTemplateMap> = {};

    for (const category of CATEGORY_DEFINITIONS) {
        const list = normalizePromptList(prompts[category.value]);
        if (list.length > 0) {
            normalized[category.value] = list;
        }
    }

    await configService.setValue(ConfigKey.WAKEUP_PROMPT_TEMPLATES, JSON.stringify(normalized));
    return getPromptTemplateSettings();
}


async function resetPromptTemplates() {
    await configService.setValue(ConfigKey.WAKEUP_PROMPT_TEMPLATES, "");
    return getPromptTemplateSettings();
}


function tryParseJsonObject(text: string): Record<string, unknown> | null {
    const trimmed = text.trim();
    const candidates = [trimmed];
    const objectMatch = trimmed.match(/\{[\s\S]*\}/);
    if (objectMatch && objectMatch[0] !== trimmed) {
        candidates.push(objectMatch[0]);
    }

    for (const candidate of candidates) {
        try {
            const parsed = JSON.parse(candidate);
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                return parsed as Record<string, unknown>;
            }
        } catch {}
    }

    return null;
}


function extractNextPrompt(responseText: string): string | null {
    const parsed = tryParseJsonObject(responseText);
    const value = parsed?.next_prompt;
    if (typeof value !== "string") {
        return null;
    }

    const normalized = value.trim();
    if (!normalized || normalized.length > 500) {
        return null;
    }

    return normalized;
}


export default {
    buildPrompt,
    extractNextPrompt,
    getCategories,
    getPromptTemplateSettings,
    normalizeCategory,
    resetPromptTemplates,
    updatePromptTemplates,
};
