# 组件理解知识库设计（二开前置）

## Product
Shared

## 状态
in progress — 设计已确认，待写实施计划。

## 目的与定位

为复刻的 PromptHub 仓库建立"按功能子系统"的理解知识库，服务二开与改造前的代码理解。首个二开目标：接入本地模型推理（根目录 `Qwen3.5-9B-...-IQ4_XS.gguf`，约 6.4GB），使其流畅、稳定、最优运行，并调研最优推理引擎。

定位：**独立只读理解层**。派生自代码与现有权威 spec，明确标注"非权威需求"，只引用不复制现有 `spec/knowledge` 需求，避免产生两份声称"当前"的文档（遵守 [文档规则](../../../rules/document-routing-rules.md)）。本层不改任何代码、不改权威 spec。

## 范围与粒度

按功能子系统切分（非顶层 app/package）。共 13 个子系统，按二开目标排优先级：

| 优先级 | 子系统 | 主要代码位置 |
| --- | --- | --- |
| P0 | AI provider / 模型接入（含引擎选型） | core `ai-client.ts`/`ai-config.ts`；desktop `agent-model-*`、`agent-provider-*`、`ai.ipc.ts`、`agent-qwen-definition.ipc.ts` |
| P1 | Agent 管理 / 平台适配 | core `agent-management/`；desktop `agent-*` 服务、adapter-registry |
| P1 | 设置 / 运行时 / 安全 | `settings`、`renderer-persistence-*`、`device-keyring`、`security.ipc`、runtime-paths |
| P2 | 存储 / canonical 权威 | core `canonical-*`、`content-addressed-object-store`、`directory-transaction`；`packages/db` |
| P2 | 同步 / 备份 / 恢复 | core `causal-sync/`、`journaled-storage-restore`、`portable-*-snapshot`、`recovery-artifact-*`、webdav |
| P2 | Prompt 工作区 | core `prompt-workspace/`、`prompt-canonical-*`；`prompt.ipc`/`folder.ipc`、版本 |
| P3 | Skill 系统 | core `skills/`；`skill.ipc`、frontmatter、package import/install/sync |
| P3 | MCP 库 / 集成 | core `mcp-*`；`mcp.ipc`/`mcp-version.ipc`、credentials/health/target-sync |
| P3 | Plugin 系统 | core `plugin-library/`、`codex-plugins/`、`plugin-*`、distribution |
| P3 | Rules 工作区 | `claude-scoped-rules`、`rule-resource-schema`、`rules.ipc` |
| P4 | 生成 / 图像工作台 | core `generation-*`、`image-generation-workbench`；`image.ipc` |
| P4 | Desktop 外壳 / 更新 / 托盘 | `updater`、`tray-*`、`window-state`、`menu`/`shortcuts`、native-notifications |
| P4 | 多端交付 | `apps/web`、`apps/web-cloudflare`、`apps/mobile`、`apps/cli` |

## 目录布局

committed 文档层（进 git，路由合规）：

```
spec/knowledge/understanding/
├── README.md                  # 入口：声明定位、引用权威 spec、子系统导航
├── _base/                     # graphify 底座说明 + 全库组件图索引
└── <subsystem>/
    ├── flow.md                # 详细流程图（mermaid）+ 叙述
    ├── architecture.md        # 架构 + 选型对照
    ├── todo.md                # 优化/修复待办（带证据）
    └── history.md             # git 修改历史（暂缓，占位）
```

可再生图谱层（不进 git）：`graphify-out/<component>/`，加入 `.gitignore`。

## graphify 底座策略

- 语料：仅代码目录 `apps/*/src`、`packages/{core,db,shared}` 源码。
- 排除：两个 GGUF（共约 12.9GB 二进制）、`node_modules`、`dist/build` 产物、`graphify-out/` 自身。
- 提取：仅 tree-sitter AST，确定性、零 token、纯本地。**不做文档语义提取**；spec 文档在写架构文档时直接读。
- 规模：全库约 1700 代码文件，超过单图 500 文件阈值。按组件建 8 张图（desktop/cli/web/cloudflare/mobile/core/db/shared）；desktop（990）细分 main/renderer/preload，renderer（691）超阈值时用 `--no-cluster` 或再细分。
- 功能子系统文档从相关组件图查询 + 直接读码组合，不要求图与子系统一一对应。

## 文档语言与抽象层级

以**中文自然语言**为主。区分两类内容，抽象层级不同：

- **理解现有成熟代码**（`flow.md`、`architecture.md` 的"现状"部分）：这是他人稳定的成熟代码，照实记录即可，**可以写具体代码框架、接口、调用上下级关系**，帮助看懂现状。证据仍引用 `文件:行号`。
- **我们二开的方向 / 大改动 / 待办**（`todo.md`、`architecture.md` 的"演进/目标"部分、二开改动点）：**不预设具体代码接口和上下级调用结构**，只用自然语言描述方向、目标、约束与取舍。原因：后续可能大修，过早固化实现细节会误导下一次改动。保持开放，落到具体接口是实施阶段的事。

一句话：现状照实写（可含接口），未来方向写意图（不锁接口）。

## 每子系统四件套规范

- `flow.md`：mermaid flowchart/sequence，覆盖正常流 + 关键失败/恢复路径、同步/异步边界、跨进程（main↔renderer↔core）调用；关键节点标注 `文件:行号`，附中文叙述。属"现状"，可含具体接口/调用关系。
- `architecture.md`：分两部分。**现状**——组件职责、依赖方向、数据所有权、关键抽象，可含具体接口；选型对照表（现有选型 vs 备选 + 权衡）。P0 此份含本地推理引擎对照（llama.cpp / ollama / koboldcpp / LM Studio），结合 9B IQ4_XS 在 8GB 显存/32GB 内存的适配、量化、上下文长度、并发与稳定性。**演进/目标**——二开方向用自然语言写意图与约束，不锁具体接口/上下级。引用权威 spec，只补理解/取舍/差距。
- `todo.md`：每条带证据（`文件:行号`）、分类（优化/修复/二开改动点）、优先级；合并 `spec/changes/active/` 与 `spec/issues/` 已有相关项，不另造平行清单。**二开改动点只写方向与目标，不预设代码接口和调用上下级**（见上节）。
- `history.md`：暂缓，占位说明（以后按子系统聚合 `git log`）。

## 证据与验证

- 所有论断/待办引用代码证据（`文件:行号`）。
- 流程图用 architecture-health 校验与代码一致。
- graphify 建图后跑内置 graph health check（悬空/缺失/折叠边）。
- 文档与权威 spec 核对：只引用、不复制需求，不产生竞争文档。

## 边界

- 只读理解层：不改代码、不改权威 spec；每份文档头部标注"派生·非权威"。
- git 修改历史暂缓。
- `graphify-out/` 加入 `.gitignore`。
- 不自动 commit；提交需用户明确指示（遵守 [提交规则](../../../rules/submission-traceability-rules.md)）。

## 成本

graphify 底座零 token（代码 AST）。真实成本在写文档：逐子系统读码 + 产出四件套耗模型 token，13 个全做是跨多次会话的大工程。P0 先行以按需控制投入。

## 执行节奏

1. 建全库 graphify 底座（8 组件图，免费）+ `understanding/README.md` 入口。
2. P0 AI 子系统四件套（含引擎选型）→ 用户验收。
3. 按 P1→P4 逐子系统推进，每个一批交付。

## 待决 / 暂缓

- git 修改历史复现：暂缓，后续按子系统聚合 `git log`。
- P0 需先查清 `agent-qwen-definition.ipc.ts` 与现有 provider 适配器是否已有本地模型脚手架，避免重复实现。

## 关联权威主题

- [系统规范](../../../knowledge/context/system.md)
- [存储架构](../../../knowledge/structure/storage-architecture.md)
- [Skill 系统设计](../../../knowledge/structure/skill-system-design.md)
- [桌面行为](../../../knowledge/behavior/desktop.md)、[同步](../../../knowledge/behavior/sync.md)、[Skills](../../../knowledge/behavior/skills.md)