# Claude Desktop 客户端配置写入逻辑

## 配置文件位置

### macOS
| 文件 | 路径 | 用途 |
|------|------|------|
| normal_config | `~/Library/Application Support/Claude/claude_desktop_config.json` | 官方配置 |
| threep_config | `~/Library/Application Support/Claude-3p/claude_desktop_config.json` | 第三方配置 |
| profile | `~/Library/Application Support/Claude-3p/configLibrary/00000000-0000-4000-8000-000000157210.json` | Gateway 配置 |
| meta | `~/Library/Application Support/Claude-3p/configLibrary/_meta.json` | 元数据 |

### Windows
| 文件 | 路径 | 用途 |
|------|------|------|
| normal_config | `%LOCALAPPDATA%/Claude/claude_desktop_config.json` | 官方配置 |
| threep_config | `%LOCALAPPDATA%/Claude-3p/claude_desktop_config.json` | 第三方配置 |
| profile | `%LOCALAPPDATA%/Claude-3p/configLibrary/00000000-0000-4000-8000-000000157210.json` | Gateway 配置 |
| meta | `%LOCALAPPDATA%/Claude-3p/configLibrary/_meta.json` | 元数据 |

## 使用官方配置（OFFICIAL 模式）

### 从哪些文件哪些字段生成备份

Claude Desktop 使用快照机制，在切换前对全部 4 个文件做快照备份。

**normal_config**：
- `deploymentMode`：当前部署模式

**threep_config**：
- `deploymentMode`：当前部署模式
- 所有 gateway 相关字段

**profile**：
- 整个文件内容（包含 `inferenceProvider`、`inferenceGatewayBaseUrl`、`inferenceGatewayApiKey`、`inferenceModels` 等）

**meta**：
- `entries` 数组：所有配置条目
- `appliedId`：当前生效的配置 ID

### 恢复的时候，写入到哪些文件哪些字段

**normal_config**：
- 写入 `{"deploymentMode": "1p"}`

**threep_config**：
- 写入 `{"deploymentMode": "1p"}`，清除 gateway 字段

**profile**：
- **删除**该文件

**meta**：
- 移除 CC Switch 条目（ID 为 `00000000-0000-4000-8000-000000157210`）
- 清空 `appliedId`

## 使用供应商/网关（GATEWAY/VENDOR 模式）

### 从哪些文件哪些字段生成备份

Claude Desktop 使用快照机制，在切换前对全部 4 个文件做快照备份。

**normal_config**：
- `deploymentMode`：当前部署模式

**threep_config**：
- `deploymentMode`：当前部署模式
- 所有 gateway 相关字段

**profile**（如果存在）：
- 整个文件内容（包含 `inferenceProvider`、`inferenceGatewayBaseUrl`、`inferenceGatewayApiKey`、`inferenceModels` 等）

**meta**：
- `entries` 数组：所有配置条目
- `appliedId`：当前生效的配置 ID

### 恢复的时候，写入到哪些文件哪些字段

**normal_config**：
- 写入 `{"deploymentMode": "3p"}`

**threep_config**：
- 写入 `{"deploymentMode": "3p"}`

**profile**（核心配置）：
- `inferenceProvider`：设为 `"gateway"`
- `inferenceGatewayBaseUrl`：网关端点 URL
- `inferenceGatewayApiKey`：网关 API Key（格式为 `ccs-{uuid}`）
- `inferenceGatewayAuthScheme`：设为 `"bearer"`
- `inferenceModels`：模型列表（包含 `id`、`name`、`contextLength`、`maxTokens`）

**meta**：
- 添加 CC Switch 条目（ID 为 `00000000-0000-4000-8000-000000157210`，名称为 `"CC Switch"`）
- 设置 `appliedId` 为 CC Switch 条目 ID

## Direct 模式 vs Proxy 模式

Claude Desktop 的第三方模式分为 Direct 和 Proxy 两种，profile 配置的字段来源不同：

| 字段 | Direct 模式 | Proxy 模式 |
|------|------------|------------|
| `inferenceGatewayBaseUrl` | `provider.settings_config.env.ANTHROPIC_BASE_URL` | `http://127.0.0.1:{port}/claude-desktop` |
| `inferenceGatewayApiKey` | `provider.settings_config.env.ANTHROPIC_AUTH_TOKEN` | 本地生成的 gateway token（`ccs-{uuid}`） |

**Direct 模式限制**：
- 仅支持 Anthropic 原生 Messages API 格式
- 模型名必须是 `claude-*` 安全名称
- 不支持 GitHub Copilot / Codex OAuth 等需要本地代理的供应商

**Proxy 模式优势**：
- 支持任意模型名（如 `kimi-k2` 映射为 `claude-sonnet-4-6`）
- 支持 `openai_chat`、`openai_responses`、`gemini_native` 等多种 API 格式
- 支持 GitHub Copilot / Codex OAuth 供应商

## 回滚机制

`with_rollback` 在写操作前快照所有 4 个文件，写入失败时调用 `restore_snapshots` 恢复原状。

## Token 存储位置

| 模式 | 存储位置 | 格式 |
|------|----------|------|
| Direct | profile `inferenceGatewayApiKey` | 上游 API key |
| Proxy | 数据库 settings 表 | `ccs-{uuid}` 格式 |
