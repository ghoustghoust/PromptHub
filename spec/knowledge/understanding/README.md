# 二开理解层入口（understanding）

> **二开理解层 · 派生自代码与权威 spec · 非权威需求**
> 派生 · 非权威 · 引用权威主题。本目录所有文档均为理解性派生记录，不构成需求或实现约定。

## 定位与边界

本层为复刻的 PromptHub 仓库建立"按功能子系统"的理解知识库，服务二次开发与改造前的代码理解。首个二开目标：接入本地模型推理（根目录 Qwen3.5-9B GGUF，约 6.4GB，**混合架构**：24 GDN + 8 全注意力），在**留余量不占满**约束下流畅、稳定、最优运行，并为未来**与 ComfyUI 生图共存**（自动卸载/重载 LLM 释放显存+内存）做准备。引擎调研与本机实测计划见 P0 的 [benchmark-plan.md](ai-provider/benchmark-plan.md)。

边界（必须遵守）：

- **只读理解层**：不改任何产品代码（`apps/*`、`packages/*`），不改权威 spec（`spec/knowledge/{context,structure,behavior,reference}`、`spec/rules`）。本层只新增理解文档。
- **只引用、不复制需求**：权威需求以下方"权威主题"为准；本层不产生第二份声称"当前"的需求文档（遵守[文档路由规则](../../rules/document-routing-rules.md)）。
- **每份文档头部标注**"派生 · 非权威 · 引用权威主题"。
- **论断带证据**：所有现状论断与待办引用代码证据 `文件:行号`；流程图经与代码一致性校验。
- **不自动 commit**：提交需用户明确指示。

设计依据：[component-understanding-kb 设计](../../changes/active/component-understanding-kb/design.md) · [实施计划](../../changes/active/component-understanding-kb/plan.md)。

## 文档语言与抽象层级原则

以**中文自然语言**为主。区分两类内容，抽象层级不同（出自设计文档"文档语言与抽象层级"节）：

- **理解现有成熟代码**（`flow.md`、`architecture.md` 的"现状"部分）：这是他人稳定的成熟代码，照实记录即可，**可以写具体代码框架、接口、调用上下级关系**，帮助看懂现状。证据仍引用 `文件:行号`。
- **我们二开的方向 / 大改动 / 待办**（`todo.md`、`architecture.md` 的"演进/目标"部分、二开改动点）：**不预设具体代码接口和上下级调用结构**，只用自然语言描述方向、目标、约束与取舍。原因：后续可能大修，过早固化实现细节会误导下一次改动。保持开放，落到具体接口是实施阶段的事。

一句话：**现状照实写（可含接口），未来方向写意图（不锁接口）**。

## 权威主题引用（需求的唯一来源）

- [系统规范](../context/system.md)
- [存储架构](../structure/storage-architecture.md)
- [Skill 系统设计](../structure/skill-system-design.md)
- 行为：[桌面](../behavior/desktop.md) · [同步](../behavior/sync.md) · [Skills](../behavior/skills.md) · [CLI](../behavior/cli.md) · [Web](../behavior/web.md) · [Cloudflare](../behavior/cloudflare.md) · [Mobile](../behavior/mobile.md)
- 参考：[AI provider API 矩阵](../reference/ai-provider-apis.md) · [Agent 平台](../reference/agent-platforms.md)
- 规则：[文档路由规则](../../rules/document-routing-rules.md)

## 图谱底座

8 个组件的 graphify 纯 AST 代码图谱（零 token、可再生、gitignore，不进 git）是本层的查询底座。索引、重建命令与查询示例见 [_base/graph-index.md](_base/graph-index.md)。功能子系统跨组件时组合多图查询 + 直接读码，图与子系统不要求一一对应。

## 子系统导航（P0 → P4，共 13 项）

每个子系统产出四件套：`flow.md`（现状流程图 + 叙述）、`architecture.md`（现状架构 + 选型对照 + 二开方向意图）、`todo.md`（带证据的优化/修复/二开改动点）、`history.md`（git 历史，暂缓占位）。

状态说明：**已建** = 该子系统四件套（flow/architecture/todo/history）均已产出（history.md 按设计为暂缓占位）；**建设中** = 本批正在产出、尚未齐全；**待建** = 后续各自成计划，目录尚未创建，创建后此表补充链接。

| 优先级 | 子系统 | 目录 | 主要代码位置 | 状态 |
| --- | --- | --- | --- | --- |
| P0 | AI provider / 模型接入（含引擎选型） | [ai-provider/](ai-provider/flow.md) | core `ai-client.ts`/`ai-config.ts`；desktop `agent-model-*`、`agent-provider-*`、`ai.ipc.ts`、`agent-qwen-definition.ipc.ts` | 已建（四件套） |
| P1 | Agent 管理 / 平台适配 | `agent-management/` | core `agent-management/`；desktop `agent-*` 服务、adapter-registry | 待建 |
| P1 | 设置 / 运行时 / 安全 | `settings-runtime-security/` | `settings`、`renderer-persistence-*`、`device-keyring`、`security.ipc`、runtime-paths | 待建 |
| P2 | 存储 / canonical 权威 | `storage-canonical/` | core `canonical-*`、`content-addressed-object-store`、`directory-transaction`；`packages/db` | 待建 |
| P2 | 同步 / 备份 / 恢复 | `sync-backup-restore/` | core `causal-sync/`、`journaled-storage-restore`、`portable-*-snapshot`、`recovery-artifact-*`、webdav | 待建 |
| P2 | Prompt 工作区 | `prompt-workspace/` | core `prompt-workspace/`、`prompt-canonical-*`；`prompt.ipc`/`folder.ipc`、版本 | 待建 |
| P3 | Skill 系统 | `skill-system/` | core `skills/`；`skill.ipc`、frontmatter、package import/install/sync | 待建 |
| P3 | MCP 库 / 集成 | `mcp-integration/` | core `mcp-*`；`mcp.ipc`/`mcp-version.ipc`、credentials/health/target-sync | 待建 |
| P3 | Plugin 系统 | `plugin-system/` | core `plugin-library/`、`codex-plugins/`、`plugin-*`、distribution | 待建 |
| P3 | Rules 工作区 | `rules-workspace/` | `claude-scoped-rules`、`rule-resource-schema`、`rules.ipc` | 待建 |
| P4 | 生成 / 图像工作台 | `generation-image/` | core `generation-*`、`image-generation-workbench`；`image.ipc` | 待建 |
| P4 | Desktop 外壳 / 更新 / 托盘 | `desktop-shell/` | `updater`、`tray-*`、`window-state`、`menu`/`shortcuts`、native-notifications | 待建 |
| P4 | 多端交付 | `multi-platform/` | `apps/web`、`apps/web-cloudflare`、`apps/mobile`、`apps/cli` | 待建 |

注：P0 需区分 AI 模型 provider 线与 coding-agent 平台适配线——`agent-qwen-definition.ipc.ts` 属 Qwen 编码 agent 定义管理，**非**本地 GGUF 推理。

P0 额外产出：[benchmark-plan.md](ai-provider/benchmark-plan.md)（本机实测计划 T0–T10：显存拟合留余量、MTP 接受率、KV 量化质量、KVMem 9B 召回、ComfyUI 卸载/重载 handoff、实时 tok/s、前缀复用、长推理稳定性）。引擎选型与混合架构纠正见 [architecture.md](ai-provider/architecture.md) 第二部分；二开约束 D7–D10 见 [todo.md](ai-provider/todo.md)。