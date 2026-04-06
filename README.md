# co-claw-dex

`co-claw-dex` 是一个可本地运行的 Claude Code 风格终端编码代理 fork。

这个仓库的目标不是重做整套 CLI，而是在尽量保留原有终端交互、工具系统、权限模型和 agent 工作流的前提下，把模型提供方边界替换为 **OpenAI / Codex 兼容的 Responses backend**。

## 项目定位

这个 fork 的核心思路是：

- 保留现有 Claude Code 风格的本地运行时与工具执行模型
- 默认使用 OpenAI Responses 作为模型后端
- 继续沿用 Codex 风格的本地凭证与配置来源
- 通过适配层把内部 Claude-shaped transcript / tool protocol 映射到 OpenAI Responses API
- 尽量不改动终端 UX、slash commands、工具审批与本地执行权

换句话说，这个项目是 **“保留本地 runtime authority 的前提下，替换模型后端”**，而不是改成 provider-native 的远端工具执行模型。

## 主要特性

- 保留 Claude Code 风格的终端使用体验
- 默认后端为 OpenAI / Codex 兼容 Responses API
- 继续使用 `OPENAI_API_KEY`、`~/.codex/auth.json`、`~/.codex/config.toml`
- 将 Responses streaming 事件转换回现有内部流式事件格式
- 将 function calling 映射回既有 tool-use 流程
- 对 `previous_response_id` 支持不稳定的代理场景保留 stateless replay 兼容策略
- 保留一部分 Claude 风格模型别名以兼容既有工作流
- 禁用官方 Anthropic install / update 发布路径，避免误走上游分发逻辑

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置凭证

优先使用环境变量：

```bash
export OPENAI_API_KEY="your_api_key"
```

也支持本地配置文件：

- `~/.codex/auth.json`
- `~/.codex/config.toml`

最小配置示例：

```toml
model_provider = "openai"
model = "gpt-5.4"
disable_response_storage = true

[model_providers.openai]
base_url = "https://api.openai.com/v1"
wire_api = "responses"
```

### 3. 构建

```bash
npm run build
```

`npm run build` 会同时刷新：

- 默认 bundle：`dist/`
- ant prompt 变体 bundle：`dist-ant/`

如果你只想刷新 ant 风格 bundle：

```bash
npm run build:ant
```

### 4. 启动

源码 launcher：

```bash
node cli.js --help
```

启动已构建产物：

```bash
npm start
```

### 5. 快速验证

```bash
node cli.js auth status --text
node cli.js -p "Reply with exactly: hello"
```

一键 smoke test：

```bash
npm run smoke
```

## 常用开发命令

### 构建与启动

```bash
npm run clean
npm run build
npm run build:ant
npm start
node cli.js --help
```

### 本地环境初始化

```bash
bash scripts/bootstrap.sh
```

### 认证与 smoke

```bash
node cli.js auth status --text
npm run smoke
```

### 测试

运行 P0 回归测试：

```bash
npm run test:p0
```

使用 dot reporter：

```bash
npm run test:p0:check
```

输出 JSON：

```bash
npm run test:p0:json
```

只跑一个测试文件：

```bash
bunx vitest run --config vitest.config.ts tests/p0/model/openaiResponsesBackend.test.ts
```

按名称运行单个测试：

```bash
bunx vitest run --config vitest.config.ts tests/p0/model/openaiResponsesBackend.test.ts -t "serializes structured tool_result content"
```

## 配置与凭证来源

这个 fork 默认使用 OpenAI Responses backend，而不是 Anthropic backend。

凭证与配置的主要来源如下：

- API key：`OPENAI_API_KEY` 或 `~/.codex/auth.json`
- provider / model 默认值：`~/.codex/config.toml`
- env vars 可覆盖本地配置，例如：
  - `OPENAI_MODEL`
  - `OPENAI_REASONING_EFFORT`
  - `OPENAI_BASE_URL`

配置优先级的规范实现位于：

- `src/services/modelBackend/openaiCodexConfig.ts`

这里是 API key、base URL、model、prompt-cache retention、context window、reasoning effort 的 canonical precedence 定义位置。

## 文档入口

规范文档已经迁移到 `docs/`，README 只保留高层入口。

优先阅读：

- `docs/INDEX.md` — 文档总入口
- `docs/implementation/hybrid-native-implementation-plan.md` — 当前实现工作的 source of truth
- `docs/ant-mode-summary.md` — `USER_TYPE=ant` / `dist-ant` 相关说明
- `docs/release-version-policy.md` — release、tag、npm publish 的正式规则

历史研究材料位于：

- `research/`

请将 `research/` 视为历史背景，而不是当前实现真源。

## 架构概览

### 启动链路

- 根 `cli.js` 很薄，只负责启动 `dist/cli.js`
- 真正的 CLI 启动入口是 `src/entrypoints/cli.tsx`
- 完整 bootstrap 在 `src/main.tsx`

### 命令与工具

- `src/commands.ts`：slash commands 的中央注册点
- `src/Tool.ts`：共享工具契约与 tool-use context
- `src/tools.ts`：当前 session 暴露哪些 built-in tools 的 source of truth
- `src/services/tools/`：工具执行实现
- `src/services/tools/toolOrchestration.ts`：并发安全的只读工具批处理与状态变更工具串行执行

### 核心对话与模型适配

- `src/query.ts`：核心 turn loop，负责 transcript、compact / recovery、streaming、tool feedback
- `src/services/modelBackend/index.ts`：模型提供方选择入口
- `src/services/modelBackend/openaiResponsesBackend.ts`：本 fork 最关键的适配器
- `src/services/modelBackend/openaiApi.ts`：OpenAI HTTP 边界，统一处理请求与鉴权头

## 当前状态

这个仓库已经可以作为一个可用的终端编码代理平台运行。

已经完成的迁移包括：

- OpenAI / Codex-compatible Responses backend 成为默认模型路径
- 凭证从 `OPENAI_API_KEY` 或 `~/.codex/auth.json` 读取
- provider 设置从 `~/.codex/config.toml` 读取
- Responses streaming 已接入现有内部消息流
- function calling 已接入现有内部 tool-use 流程
- 保留部分 Claude 风格模型别名兼容层
- 官方 Anthropic install / update 渠道已在本 fork 中禁用

## 发布与版本规则

正式发布、npm publish、Git tag、GitHub Release 相关操作必须遵循：

- `docs/release-version-policy.md`

仓库里的强约束是：

- `package.json.version` 是唯一正式版本真源
- 不要在脚本、CI、release notes 中再维护第二套正式版本来源

## 本地 launcher 辅助脚本

把本地源码版 CLI 链接到系统命令：

```bash
npm run activate-cli
```

恢复官方链接：

```bash
npm run restore-cli
```

安装 sidecar ant launcher（不覆盖现有 `claude` / `claude-codex` 链接）：

```bash
npm run activate-ant-cli
```

## 仓库约定

- 这个 fork 主要面向 **source-first** 使用方式
- 不要依赖官方 Anthropic install / update 流程来使用这个仓库
- `scripts/build.mjs` 会使用 Bun 构建 `src/entrypoints/cli.tsx`，写入 `dist/cli.js`，并复制 `vendor/` 到构建目录
- 只修改文档时通常不需要重新构建
- `.claude/` 应保持忽略，不要提交

## 测试重点

最重要的自动化覆盖位于：

- `tests/p0/model/`
- `tests/p0/tool/`
- `tests/p0/protocol/`

如果你修改了 backend translation、tool orchestration 或 protocol 行为，应该优先补充或更新对应的 P0 测试。

## 项目来源

这个代码库起初来自 Claude Code 已发布 bundle 的源码提取，随后被改造成一个可本地构建、可本地运行、并默认接入 OpenAI / Codex Responses backend 的开发工作区。
