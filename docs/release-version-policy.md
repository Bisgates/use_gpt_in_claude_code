<!-- docmeta
role: reference
layer: 2
parent: docs/INDEX.md
children: []
summary: canonical policy for keeping package.json, npm package versions, Git tags, and GitHub Releases in sync
read_when:
  - planning or automating npm publish, Git tags, or GitHub Releases
  - deciding which version field is authoritative for this repository
skip_when:
  - only changing runtime behavior unrelated to release flow
source_of_truth:
  - package.json
  - CLAUDE.md
-->

# Release Version Policy

## Scope

本文定义本仓库正式发行时，`package.json.version`、npm 包版本、Git tag 与 GitHub Release 之间的同步规则。

任何版本变更、npm publish、tag 创建、GitHub Release 创建、以及发版自动化都必须遵循本文。

## 单一版本真源

- 根 `package.json.version` 是唯一版本真源。
- Git tag、GitHub Release、npm publish 的版本都只能从 `package.json.version` 派生。
- 允许发布包名和根包名不同，但不允许发布版本与根 `package.json.version` 不同。
- 正式发版流程中不得再引入第二个版本来源。

这意味着以下做法都不允许进入正式发版路径：

- 在 npm script 中硬编码一个独立的发布版本
- 在 CI 环境变量中维护另一套正式版本号
- 先手工打 tag，再回头补改 `package.json.version`
- 先手工创建 GitHub Release，再让 npm 版本去追 GitHub

## 必须保持的同步关系

当 `package.json.version = X.Y.Z` 时，正式发行必须满足：

- Git tag = `vX.Y.Z`
- GitHub Release tag = `vX.Y.Z`
- npm 发布版本 = `X.Y.Z`

当 `package.json.version = X.Y.Z-beta.1` 或 `X.Y.Z-rc.1` 这类预发布版本时，正式发行必须满足：

- Git tag = `vX.Y.Z-beta.1` 或 `vX.Y.Z-rc.1`
- GitHub Release 使用同一个 tag，并标记为 prerelease
- npm 发布版本保持完全一致，并使用非 `latest` 的 dist-tag

## 命名规则

### 版本号

- 版本号必须符合 semver。
- 正式版使用 `X.Y.Z`。
- 预发布版使用 `X.Y.Z-beta.N`、`X.Y.Z-rc.N` 这类 semver 预发布格式。

### Git tag

- tag 格式固定为 `v<package.json.version>`。
- 不允许省略前缀 `v`。
- 不允许使用与 `package.json.version` 不一致的 tag。

### GitHub Release

- GitHub Release 必须从匹配的 tag 创建。
- Release 标题默认使用与 tag 相同的版本标识，例如 `v2.1.89`。
- 预发布版本必须在 GitHub 上标记为 prerelease。

### npm dist-tag

- 正式版 `X.Y.Z` 发布到 `latest`。
- `*-beta.*` 发布到 `beta`。
- `*-rc.*` 发布到 `rc`。

## 标准正式发版流程

### 1. 准备发版变更

先通过一个 release PR 更新正式版本信息。正常情况下，这个 PR 只应包含：

- `package.json.version`
- `package-lock.json` 中由版本变更带来的同步内容
- 必要的 release notes 或 changelog 文案

### 2. 合并到 `main`

release PR 合并后，`main` 上的目标 commit 就是待发布内容。

### 3. 创建并推送 tag

在目标 commit 上创建并推送匹配 tag：

- `package.json.version = 2.1.89` 时，tag 必须是 `v2.1.89`
- `package.json.version = 2.1.90-beta.1` 时，tag 必须是 `v2.1.90-beta.1`
- 后续正式发版默认应在 tag message 中写一句话摘要，例如：`telegram 支持关闭`
- 当前 release workflow 会把这句一句话摘要 prepend 到 GitHub Release 正文顶部；若 tag 没有注释，则回退到 tag 所指 commit 的 subject

### 4. 由 tag 触发正式发版自动化

正式 publish 应只允许由 tag 触发的 workflow 执行。该 workflow 至少要完成以下校验：

- tag 格式合法
- tag 去掉前缀 `v` 后与 `package.json.version` 完全一致
- tag 指向的 commit 已经在 `main` 上
- 目标 npm 包版本尚未存在于 registry

### 4.1 发布凭证要求

正式发版 workflow 还必须满足以下凭证约束：

- npm 发布凭证必须通过 GitHub Actions secret 注入，不能依赖本地机器登录态。
- 如果 workflow 读取 `${{ secrets.NPM_TOKEN }}`，则必须在 **repository-level Actions secrets** 中配置名为 `NPM_TOKEN` 的 secret。
- 除非 workflow 明确声明并使用了对应的 environment，否则不要把正式发布凭证只放在 environment secrets 里。
- `NPM_TOKEN` 必须是可用于 CI/CD 自动发布的 **automation token**（或 npm 后续等价的非交互式发布 token）。
- 不允许使用发布时仍要求交互式 OTP / 2FA 验证的一般 token 作为正式自动化发布凭证；否则 workflow 会在 `npm publish` 阶段以 `EOTP` 失败。
- 自动化发布需要保证整个 tag workflow 无人值守可完成；因此凭证类型必须与“受控 tag workflow 自动发布”这一要求兼容。

### 5. 先发布 npm，再创建 GitHub Release

正式发版顺序固定为：

1. 校验版本一致性
2. 运行构建与必要测试
3. 发布 npm
4. 在 npm publish 成功后创建 GitHub Release

这样可以避免出现“GitHub 看起来已经发版，但 npm 实际没有成功发布”的不一致状态。

## 必须具备的自动化闸门

任何正式发版自动化都必须至少包含以下闸门：

- **版本一致性闸门**：tag、`package.json.version`、待发布 npm 版本必须完全一致
- **唯一来源闸门**：正式发版流程不得读取第二个正式版本来源
- **重复发布闸门**：如果 npm registry 已存在同版本，流程必须直接失败
- **触发来源闸门**：正式 publish 只能由受控的 tag workflow 触发，不能由普通 branch push 触发
- **凭证注入闸门**：正式 npm 发布凭证必须由 GitHub Actions secret 注入，并与 workflow 中声明的 secret 名称完全一致
- **非交互凭证闸门**：正式发布凭证必须支持无人值守发布，不能在 `npm publish` 阶段要求手工输入 OTP
- **成功顺序闸门**：只有 npm publish 成功后，才允许创建 GitHub Release

## 禁止事项

以下操作不属于正式发版逻辑，不能作为官方 release 流程的一部分：

- 本地机器直接执行正式 `npm publish`
- 在 npm script 中硬编码正式发布版本
- 手工创建与 `package.json.version` 不一致的 tag 或 GitHub Release
- 在 npm publish 失败时仍保留对外可见的正式 GitHub Release
- 在 CI、脚本、文档中维护另一套独立的正式版本真源

## 仓库特定约束

本仓库允许“仓库根包名”和“实际发布包名”不同。例如：

- 根仓库包名可以保持为 `@anthropic-ai/claude-code`
- 实际对外发布包名可以是 `@zju_han/claudex-cli`

这个差异是允许的，但只允许体现在**包名**上，不允许体现在**版本号**上。

因此：

- 未来任何 `build:claudex`、打包脚本、发版脚本、GitHub Actions workflow，都必须从根 `package.json.version` 派生正式发布版本
- 不允许在正式发版路径里再硬编码 `CLAUDE_CODE_PACKAGE_VERSION` 之类的第二版本来源
- 本地临时试打包如果显式覆盖版本，只能视为实验产物，不能直接当作正式 npm 发版或 GitHub Release

## 执行原则

如果当前实现与本文不一致，应优先修改脚本或 workflow，使其重新回到本文定义的单一真源和单向派生关系，而不是继续兼容多套版本来源。
