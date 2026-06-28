# Gemini 客户端配置写入逻辑

## 配置文件位置

默认目录：`~/.gemini/`（可通过 `GEMINI_OVERRIDE_DIR` 设置自定义路径）

| 文件 | 路径 | 格式 | 用途 |
|------|------|------|------|
| .env | `~/.gemini/.env` | KEY=VALUE | 环境变量（API Key、模型、Base URL 等） |
| settings.json | `~/.gemini/settings.json` | JSON | 客户端配置（认证类型等） |
| oauth_creds.json | `~/.gemini/oauth_creds.json` | JSON | OAuth 凭据（由 Gemini CLI 管理） |

## 使用官方配置（OFFICIAL 模式）

### 从哪些文件哪些字段生成备份

**.env**：
- `GEMINI_API_KEY`：API Key（如果有）
- `GEMINI_MODEL`：模型名称（如果有）
- `GOOGLE_GEMINI_BASE_URL`：Base URL（如果有）
- 其他所有环境变量

**settings.json**：
- `security.auth.selectedType`：认证类型（`"gemini-api-key"` 或 `"oauth-personal"`）
- 其他所有字段（如 `mcpServers`）

**oauth_creds.json**：
- 整个文件内容（OAuth 凭据，由 Gemini CLI 管理）

### 恢复的时候，写入到哪些文件哪些字段

**认证类型检测**：

首先根据供应商信息检测认证类型：

| 条件 | 认证类型 |
|------|----------|
| `partner_promotion_key == "google-official"` | GoogleOfficial |
| 供应商名称等于 `"google"` 或以 `"google "` 开头 | GoogleOfficial |
| `partner_promotion_key == "packycode"` | Packycode |
| 名称/URL/`GOOGLE_GEMINI_BASE_URL` 包含 `"packycode"`、`"packyapi"` 或 `"packy"` | Packycode |
| 其他 | Generic |

**settings.json**：
- 如果 `provider.settings_config` 有 `config` 字段且为对象：与现有 `settings.json` **合并**（保留 `mcpServers` 等其他字段）
- 如果 `config` 为 null 或不存在：**不修改**已有的 `settings.json`

**认证模式标记**：

| 认证类型 | settings.json 写入 |
|----------|-------------------|
| GoogleOfficial | `security.auth.selectedType = "oauth-personal"` |
| Packycode | `security.auth.selectedType = "gemini-api-key"` |
| Generic | `security.auth.selectedType = "gemini-api-key"` |

**.env**：

从 `provider.settings_config.env` 提取键值对写入。

| 认证类型 | 写入内容 | 验证要求 |
|----------|----------|----------|
| GoogleOfficial | 直接写入 env_map | 无 |
| Packycode | env_map | **必须**包含 `GEMINI_API_KEY` |
| Generic | env_map | **必须**包含 `GEMINI_API_KEY` |

## 使用供应商/网关（GATEWAY/VENDOR 模式）

### 从哪些文件哪些字段生成备份

**.env**：
- `GEMINI_API_KEY`：API Key（如果有）
- `GEMINI_MODEL`：模型名称（如果有）
- `GOOGLE_GEMINI_BASE_URL`：Base URL（如果有）
- 其他所有环境变量

**settings.json**：
- `security.auth.selectedType`：认证类型
- 其他所有字段（如 `mcpServers`）

**oauth_creds.json**：
- 整个文件内容（OAuth 凭据，由 Gemini CLI 管理）

### 恢复的时候，写入到哪些文件哪些字段

**settings.json**：
- 如果 `provider.settings_config` 有 `config` 字段且为对象：与现有 `settings.json` **合并**（保留 `mcpServers` 等其他字段）
- 如果 `config` 为 null 或不存在：**不修改**已有的 `settings.json`
- `security.auth.selectedType`：设为 `"gemini-api-key"`（第三方模式统一使用 API Key 认证）

**.env**：
- 从 `provider.settings_config.env` 提取键值对写入
- **必须**包含 `GEMINI_API_KEY`（验证要求）

## 安全特性

- `.env` 文件权限设为 `0o600`（仅所有者可读写）
- 目录权限设为 `0o700`（仅所有者可访问）
- `update_selected_type()` 采用合并策略，仅修改 `selectedType`，不破坏 `mcpServers` 等其他配置

## Token 存储位置

| 模式 | 存储位置 | 格式 |
|------|----------|------|
| GoogleOfficial | OAuth 凭据（由 Gemini CLI 管理） | OAuth tokens |
| Packycode / Generic | `.env` 文件 `GEMINI_API_KEY` | 明文 API Key |
