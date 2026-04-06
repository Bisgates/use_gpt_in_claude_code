<!-- docmeta
role: reference
layer: 2
parent: docs/INDEX.md
children: []
summary: explanation of USER_TYPE=ant versus external builds, including prompt, tool, command, and runtime differences
read_when:
  - need to understand what ant mode means in the source tree
  - need to know whether a USER_TYPE-gated branch affects internal-only or external behavior
skip_when:
  - only investigating the default runtime behavior of the external fork
source_of_truth:
  - src/constants/prompts.ts
  - src/commands.ts
  - src/tools.ts
  - src/constants/oauth.ts
  - src/services/analytics/growthbook.ts
-->

# ant Mode Summary

## Scope

本文总结代码里 `process.env.USER_TYPE === 'ant'` 的含义，以及它和外部构建（通常可理解为 `external`）之间的主要差异。

重点不是枚举每一处条件分支，而是说明：

- `ant` 代表什么
- 它不是在识别“用户本人类型”
- 它会影响哪些能力面
- 改代码时应如何理解这些分支

## `USER_TYPE` 的含义

`USER_TYPE` 不是“当前操作者的人群画像”判断，而是**构建/发行渠道开关**。

代码里直接把它当作 build-time define 使用：

- `src/utils/envUtils.ts:137` 注释：`USER_TYPE is build-time --define'd`
- `src/constants/keys.ts:3` 注释：`USER_TYPE is a build-time define so it's safe`

在源码中常见的两个值是：

- `ant`：内部构建 / 内部渠道
- `external`：外部分发 / 普通用户构建

因此，`process.env.USER_TYPE === 'ant'` 更准确的理解是：

> 这段逻辑只给内部构建使用，而不是“只给某类终端用户使用”。

## 它是如何生效的

`USER_TYPE` 被设计成 build-time 常量，而不只是运行时环境变量。

这类条件经常被用来做 dead code elimination（DCE）：

- 内部构建保留 internal-only 分支
- 外部构建把这些分支直接裁掉

一个典型例子：`src/utils/envUtils.ts:137-145`

- `ant` 构建会引入内部受保护命名空间检查逻辑
- 外部构建这段路径会被裁掉，不只是“运行时不走到”

## ant 与 external 的主要差异

### 1. 主 system prompt 不同

最直接的差异在 `src/constants/prompts.ts`。

#### `ant` 下多出的 prompt 行为

来源：`src/constants/prompts.ts:245`、`265`、`278`

内部构建会额外注入一些更强的行为约束，例如：

- 更严格的“默认不要写注释”规则
- 完成前必须实际验证，不要只看代码就说完成
- 如果发现用户前提有误，要直接指出来，不要盲从
- 必须如实报告结果，不能把未验证内容说成成功

例如 `src/constants/prompts.ts:265`：

- 只有 `ant` 下才会加入“用户有误解时要指出来”的规则

#### 输出风格也不同

来源：`src/constants/prompts.ts:443`

- `ant` 使用较长的 `# Communicating with the user` 段
- 外部构建使用更短的 `# Output efficiency` 段

所以内部构建不仅更“强势”，也更强调解释清楚和沟通质量。

### 2. 内部命令只在 `ant` 下可用

来源：`src/commands.ts:225`

这里有明确注释：

- `Commands that get eliminated from the external build`

这些命令只在 `ant` 构建里挂载，外部构建会被剔除。代表性的 internal-only commands 包括：

- `bughunter`
- `commit`
- `commitPushPr`
- `issue`
- `share`
- `summary`
- `teleport`
- `antTrace`
- `perfIssue`
- `oauthRefresh`
- `debugToolCall`
- `autofixPr`

真正挂载条件见 `src/commands.ts:344`：

- `process.env.USER_TYPE === 'ant' && !process.env.IS_DEMO`

### 3. 工具集合不同

来源：`src/tools.ts:193`

`ant` 下会额外加入一些 internal-only 工具，例如：

- `ConfigTool` — `src/tools.ts:214`
- `TungstenTool` — `src/tools.ts:215`
- `REPLTool` — `src/tools.ts:232`

因此，如果你看到某段 prompt 或逻辑在谈论这些工具，不要默认 external build 也有。

### 4. 搜索能力和 prompt 文案不同

来源：

- `src/tools.ts:198`
- `src/constants/prompts.ts:328`

内部构建可能带有嵌入式搜索实现（如 bfs / ugrep），因此：

- 有时不暴露 `GlobTool` / `GrepTool`
- prompt 里也会改写成“直接用 find/grep 即可”

外部构建更常见的是显式暴露 `GlobTool` / `GrepTool`。

### 5. `/init` 等流程会有 internal-only 分支

来源：`src/commands/init.ts:230`

`/init` 的描述和 prompt 会因为：

- `USER_TYPE === 'ant'`
- 或特定 feature/env 开关

切到新的初始化流程。因此内部构建默认可能走实验性或更完整的初始化体验。

### 6. OAuth 环境不同

来源：`src/constants/oauth.ts:5`

只有 `ant` 下允许：

- `USE_LOCAL_OAUTH`
- `USE_STAGING_OAUTH`

并且只有 `ant` 构建包含 staging/local OAuth 配置。外部构建默认只走生产环境配置。

### 7. Feature flag / GrowthBook 控制能力不同

来源：`src/services/analytics/growthbook.ts:163`、`205`

只有 `ant` 下支持一些内部 feature flag 覆盖能力，例如：

- `CLAUDE_INTERNAL_FC_OVERRIDES`
- 本地配置覆盖 GrowthBook features
- 一些用于实验、回归验证、调试 rollout 的能力

外部构建通常看不到这些控制面。

### 8. Prompt / API dump 和调试观测不同

来源：`src/services/api/dumpPrompts.ts:49`

只有 `ant` 下会缓存和写出更强的 prompt / request dump 信息，例如：

- API request cache
- dump prompts 文件
- system/tools metadata 初始化数据

外部构建不会保留这套内部观测能力。

### 9. 内部日志与运行环境探测不同

来源：`src/services/internalLogging.ts:17`

只有 `ant` 下会：

- 探测 Kubernetes namespace
- 探测 container ID
- 上报内部 permission context telemetry

这类逻辑显然面向内部容器/基础设施环境，而不是普通外部分发场景。

## 对修改 prompt 时的实际含义

如果你在代码里看到：

- `process.env.USER_TYPE === 'ant'`

不要把它理解成：

- “只有某类用户才会感受到这条行为规则”

更准确的理解是：

- “只有内部构建才会带上这条规则”

这对改 prompt 非常重要。

例如你想让外部分发版本也更有原则、更不盲从用户：

- 不应该继续依赖 `USER_TYPE === 'ant'`
- 而应该把对应规则移到 external 也会走到的分支里

最典型的位置是：

- `src/constants/prompts.ts:265` — 主 agent 的 assertiveness 规则
- `src/constants/prompts.ts:802` — subagent 的统一增强入口

## 一句话结论

`ant` 模式本质上是**内部构建模式**，不是“内部用户识别模式”。

它会影响：

- 主 system prompt 文案
- 可用命令
- 可用工具
- 搜索能力与工具提示
- OAuth 环境
- feature flag / GrowthBook 覆盖能力
- prompt dump / 调试观测 / 内部 telemetry

所以只要看到 `USER_TYPE === 'ant'`，都应该先问自己：

> 这是内部渠道专属能力，还是我真的希望 external build 也拥有的行为？
