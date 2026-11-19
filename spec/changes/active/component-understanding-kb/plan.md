# 组件理解知识库 · 第一批（graphify 底座 + P0 AI 子系统）实施计划

## Product

Shared

## Status

in progress — graphify 底座与 P0 理解文档已完成，P1–P4 子系统理解文档待后续批次。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立零 token 的 graphify 代码图谱底座与理解层入口，并产出 P0「AI provider / 模型接入」子系统的四件套文档（含本地推理引擎选型对照），服务"接入本地 Qwen3.5-9B GGUF"的二开目标。

**Architecture:** 用 `graphify extract --code-only --no-cluster` 对 8 个组件各建一张纯 AST 图谱（可再生、gitignore）；在 `spec/knowledge/understanding/` 建立只读理解层，按功能子系统产出 flow/architecture/todo/history 四件套。本批只做底座 + 入口 + P0；P1–P4 各自后续成计划。

**Tech Stack:** graphify CLI（graphifyy 0.9.111，已装）、tree-sitter AST、mermaid 图、architecture-visualization 技能（flow-visualizer / system-modeler / risk-quality-reviewer / architecture-health）、WebSearch（引擎选型）。

**Spec:** [spec/changes/active/component-understanding-kb/design.md](design.md)

## Global Constraints

- 文档以**中文自然语言**为主。
- 抽象层级：**现状照实写（可含具体代码框架/接口/调用上下级）；我们二开的方向/大改动/待办只写意图与约束，不预设代码接口和上下级调用结构**（后续可能大修）。
- **只读理解层**：不改任何产品代码、不改权威 spec；每份文档头部标注"派生·非权威·引用权威主题"。
- 所有论断/待办引用代码证据 `文件:行号`；流程图用 architecture-health 校验与代码一致。
- graphify 底座**仅代码 AST，零 token**：必须带 `--code-only --no-cluster`，不做文档语义提取、不做 LLM 社区命名。
- `graphify-out/` 加入 `.gitignore`，可再生图谱不进 git。
- **不自动 commit**：本计划所有任务均不含 git commit 步骤；提交需用户明确指示（仓库提交规则）。
- 排除语料：两个根目录 GGUF（约 12.9GB）、node_modules、dist/build、graphify-out 自身（`--code-only` + 默认 .gitignore 已覆盖；扫描路径限定 src，根目录 GGUF 不在扫描范围）。
- 图谱路径约定：组件 C 的图位于 `graphify-out/C/graphify-out/graph.json`（因 `--out DIR` 会再追加一层 `graphify-out/`）。下文记作 `GRAPH(C)`。查询用 `graphify query "..." --graph GRAPH(C)`。

## 文件结构

| 路径 | 责任 | 进 git |
| --- | --- | --- |
| `.gitignore` | 追加 `graphify-out/` | 是（修改） |
| `graphify-out/<component>/graphify-out/` | 8 组件原始图谱（graph.json/html/report） | 否 |
| `spec/knowledge/understanding/README.md` | 理解层入口：定位声明 + 权威 spec 引用 + 子系统导航 | 是 |
| `spec/knowledge/understanding/_base/graph-index.md` | 8 组件图索引 + 重建命令 + 查询示例 | 是 |
| `spec/knowledge/understanding/ai-provider/flow.md` | P0 现状流程图 + 叙述 | 是 |
| `spec/knowledge/understanding/ai-provider/architecture.md` | P0 现状架构 + 引擎选型对照 + 二开方向（意图） | 是 |
| `spec/knowledge/understanding/ai-provider/todo.md` | P0 优化/修复/二开改动点（带证据） | 是 |
| `spec/knowledge/understanding/ai-provider/history.md` | git 历史占位（暂缓） | 是 |

P0 关键证据源（只读）：
- `packages/core/src/ai-config.ts`（476 行；normalizeProtocol L106-133、normalizeProviderConfig L155+）
- `packages/core/src/ai-client.ts`（133 行；chatCompletion L114-133；apiKey 强校验 L120）
- `packages/shared/utils/ai-protocol.ts`（144 行；resolveAIProtocol/buildChatEndpointFromBase/resolveProtocolBase/buildHeadersForProtocol）
- `packages/shared/types/ai.ts`（AIProtocol/AITransportRequest/SafetyScanAIConfig）
- `apps/desktop/src/main/ipc/ai.ipc.ts`
- `apps/desktop/src/main/services/agent-model-*.ts`、`agent-provider-*.ts`
- 区分项：`apps/desktop/src/main/ipc/agent-qwen-definition.ipc.ts` 属 Qwen **编码 agent** 定义管理，**非**本地 GGUF 推理。

---

### Task 1: gitignore + graphify 底座（8 组件图）

**Files:**
- Modify: `.gitignore`（追加一行 `graphify-out/`）
- Create: `graphify-out/{desktop,cli,web,cloudflare,mobile,core,db,shared}/graphify-out/graph.json`（可再生）

**Interfaces:**
- Consumes: 已安装的 `graphify` CLI；组件源码路径。
- Produces: `GRAPH(C)` 路径约定（见 Global Constraints），供 Task 2 索引与 P0 查询使用。

- [ ] **Step 1: 追加 gitignore**

在 `.gitignore` 末尾追加：

```
# graphify 可再生代码图谱（理解层底座，不进 git）
graphify-out/
```

- [ ] **Step 2: 先在最小部件 db 上验证命令与输出路径**

Run:
```bash
cd "G:/program/3.prompt-forge"
graphify extract packages/db/src --code-only --no-cluster --out graphify-out/db
```
Expected: 退出 0；生成 `graphify-out/db/graphify-out/graph.json`；输出含 AST 节点/边计数；**无** semantic/LLM/token 字样。
若实际输出路径与约定不符，以实际为准并同步更新 Global Constraints 的 `GRAPH(C)` 约定与 Task 2 索引。

- [ ] **Step 3: 校验 db 图健康**

Run:
```bash
graphify diagnose multigraph --graph graphify-out/db/graphify-out/graph.json
```
Expected: 报告悬空/缺失/折叠边情况；记录结果（少量折叠边可接受，需在索引注明）。

- [ ] **Step 4: 建其余 7 张图**

Run（逐条执行，均带 `--code-only --no-cluster`）:
```bash
graphify extract packages/core/src        --code-only --no-cluster --out graphify-out/core
graphify extract packages/shared          --code-only --no-cluster --out graphify-out/shared
graphify extract apps/desktop/src         --code-only --no-cluster --out graphify-out/desktop
graphify extract apps/web/src             --code-only --no-cluster --out graphify-out/web
graphify extract apps/web-cloudflare/src  --code-only --no-cluster --out graphify-out/cloudflare
graphify extract apps/mobile/src          --code-only --no-cluster --out graphify-out/mobile
graphify extract apps/cli/src             --code-only --no-cluster --out graphify-out/cli
```
Expected: 各退出 0，生成对应 `GRAPH(C)`。desktop（990 文件）AST 应秒级完成；若超时或报错，细分 `apps/desktop/src/main` 与 `apps/desktop/src/renderer` 分别建图并在索引注明。

- [ ] **Step 5: 验证零 token 与图谱可用**

Run:
```bash
graphify god-nodes --top 5 --graph graphify-out/core/graphify-out/graph.json
graphify query "ai provider protocol" --graph graphify-out/core/graphify-out/graph.json --budget 800
```
Expected: god-nodes 列出核心枢纽节点；query 返回 AI 协议相关子图。确认全程无 API key 提示、无 token 计费。

- [ ] **Step 6: 不提交**（等待用户指示）。记录 8 图节点/边数与任何健康警告，供 Task 2 写入索引。

---

### Task 2: 理解层入口 + 图谱索引

**Files:**
- Create: `spec/knowledge/understanding/README.md`
- Create: `spec/knowledge/understanding/_base/graph-index.md`

**Interfaces:**
- Consumes: Task 1 的 8 图节点/边数、健康警告、`GRAPH(C)` 约定。
- Produces: 理解层导航入口；P0–P4 子系统目录占位导航；图谱重建/查询命令参考。

- [ ] **Step 1: 写 README.md**

内容须含：
- 头部声明："二开理解层 · 派生自代码与权威 spec · 非权威需求"。
- 定位与边界（只读、不改代码/权威 spec、现状可含接口而二开方向不锁接口、中文自然语言为主）。
- 引用权威主题链接：`../../knowledge/context/system.md`、`../../knowledge/structure/storage-architecture.md`、`../../knowledge/behavior/desktop.md` 等（相对 README 位置核算）。
- 子系统导航表（P0→P4，13 项，链接到各 `<subsystem>/`；未产出的标"待建"）。
- 文档语言与抽象层级原则（照抄 design.md 该节要点）。

- [ ] **Step 2: 写 _base/graph-index.md**

内容须含：
- 8 组件图表格：组件 / 扫描路径 / `GRAPH(C)` / 节点数 / 边数 / 健康警告。
- 重建命令（Task 1 Step 4 的 8 条，注明 `--code-only --no-cluster` 零 token）。
- 查询示例：`graphify query "..." --graph GRAPH(C)`、`graphify path A B --graph ...`、`graphify explain X --graph ...`。
- 说明：图谱可再生、gitignore；功能子系统跨组件时组合多图查询。

- [ ] **Step 3: 校验链接与一致性**

Run:
```bash
cd "G:/program/3.prompt-forge/spec/knowledge/understanding"
# 核对 README 与 index 中引用的相对路径均存在
```
Expected: 所有相对链接解析到真实文件；节点/边数与 Task 1 记录一致。

- [ ] **Step 4: 不提交**（等待用户指示）。

---

### Task 3: P0 调查 + flow.md（现状流程图）

**Files:**
- Create: `spec/knowledge/understanding/ai-provider/flow.md`

**Interfaces:**
- Consumes: `GRAPH(core)`、`GRAPH(desktop)`；P0 证据源文件。
- Produces: AI provider 现状调用链流程图，供 Task 4 架构文档与 Task 5 待办引用。

- [ ] **Step 1: 定义验收标准（先于起草）**

flow.md 必须覆盖：
- provider 配置归一化流（ai-config.ts normalizeProtocol/normalizeProviderConfig）。
- 一次 chat 调用链：`chatCompletion → resolveAIProtocol → buildChatEndpointFromBase(resolveProtocolBase(apiUrl)) → buildHeadersForProtocol → transport(fetch) → readChatResult`（ai-client.ts L114-133）。
- 协议分支（openai/anthropic/gemini）在 body 构造与结果解析上的差异（ai-client.ts L52-112）。
- 桌面侧 IPC 入口（ai.ipc.ts）到 core 的跨进程边界。
- 失败/恢复路径：apiKey/apiUrl/model 缺失抛错（L120-122）、超时 AbortController（L31-49）、非 JSON 错误回退（L95-97）。
- 明确区分：AI 模型 provider 线 vs coding-agent 平台适配线（agent-qwen-definition 属后者）。

- [ ] **Step 2: 取证**

Read 上述证据源文件；用 `graphify query "chatCompletion protocol" --graph GRAPH(core)` 与 `graphify explain "chatCompletion" --graph GRAPH(core)` 补充邻居关系。记录每个关键节点的 `文件:行号`。

- [ ] **Step 3: 起草 flow.md**

用 mermaid flowchart + sequence 表达调用链与跨进程边界；每个关键节点标 `文件:行号`；附中文叙述解释"为什么这么流"。头部标注"派生·非权威"。属现状，可含具体接口/调用关系。

- [ ] **Step 4: 校验（替代失败测试环节）**

用 architecture-health 技能核对流程图与代码一致；逐条核对引用的 `文件:行号` 真实存在且语义匹配。
Expected: 无虚构边/节点；所有引用可定位。修正不符处。

- [ ] **Step 5: 不提交**（等待用户指示）。

---

### Task 4: P0 architecture.md（现状架构 + 引擎选型 + 二开方向）

**Files:**
- Create: `spec/knowledge/understanding/ai-provider/architecture.md`

**Interfaces:**
- Consumes: Task 3 流程图；`GRAPH(core)`/`GRAPH(desktop)`；WebSearch 引擎资料。
- Produces: 现状架构说明 + 本地推理引擎选型对照表 + 二开方向（意图级），供 Task 5 待办与后续本地模型实施引用。

- [ ] **Step 1: 定义验收标准**

architecture.md 须分三部分：
- **现状**：组件职责、依赖方向（desktop→core→shared）、数据所有权（provider 配置存哪）、关键抽象（ai-protocol 工具）；可含具体接口。
- **引擎选型对照表**：llama.cpp / ollama / koboldcpp / LM Studio 至少四引擎，列：OpenAI 兼容端点支持、GGUF 直载、9B IQ4_XS（约 6.4GB）在 8GB 显存/32GB 内存的适配（ offload/量化/上下文）、并发与稳定性、部署复杂度、与 PromptHub 现有 openai 协议接入的契合度。给出推荐与理由。
- **二开方向（意图级）**：用自然语言写"接入本地模型"的方向、目标、约束（如本地端点通常无需 apiKey、需可配置 base URL、稳定性/性能调优目标），**不预设具体代码接口和上下级调用结构**。

- [ ] **Step 2: 取证现状**

Read ai-config.ts/ai-protocol.ts/shared/types/ai.ts；确认 provider 配置持久化位置（查 settings/agent-settings-repository）。记录证据。

- [ ] **Step 3: 引擎调研**

用 WebSearch 查 llama.cpp / ollama / koboldcpp / LM Studio 的 OpenAI 兼容 server、GGUF 支持、8GB 显存跑 9B IQ4_XS 的实践与性能/稳定性口碑。来源记入文档参考。

- [ ] **Step 4: 起草 architecture.md**

按三部分写；选型对照表含推荐；二开方向只写意图。头部"派生·非权威"，引用权威 spec。

- [ ] **Step 5: 校验**

核对现状论断的证据 `文件:行号`；核对选型表每项有来源支撑；确认二开方向段落不含具体接口/调用上下级预设。修正。

- [ ] **Step 6: 不提交**（等待用户指示）。

---

### Task 5: P0 todo.md（优化/修复/二开改动点）

**Files:**
- Create: `spec/knowledge/understanding/ai-provider/todo.md`

**Interfaces:**
- Consumes: Task 3/4 的现状与选型；`spec/changes/active/`、`spec/issues/` 已有相关项。
- Produces: 带证据、分类、优先级的待办清单；二开改动点为意图级。

- [ ] **Step 1: 定义验收标准**

每条待办含：证据 `文件:行号`、分类（优化/修复/二开改动点）、优先级、简述。二开改动点只写方向与目标，不锁接口。须合并已有相关 spec/issues，不另造平行清单。

- [ ] **Step 2: 取证与合并**

候选证据（需逐一核实后写入）：
- ai-client.ts L120 强制 apiKey → 本地无 key 端点的适配方向（二开改动点，意图级）。
- ai-client.ts L31-49 超时/ abort 处理 → 本地长推理的超时稳定性（优化）。
- 协议归一化 ai-config.ts L106-133 对 localhost/自定义端点的识别（核实是否有特殊处理）。
检索 `spec/changes/active/agent-provider-protocol-bridge/`、`spec/issues/` 中 AI provider 相关项并引用合并。

- [ ] **Step 3: 起草 todo.md**

按分类/优先级组织；每条带证据；二开改动点意图级。头部"派生·非权威"。

- [ ] **Step 4: 校验**

核对每条证据真实存在；核对未与权威 spec/issues 产生平行清单；确认二开改动点无接口预设。修正。

- [ ] **Step 5: 不提交**（等待用户指示）。

---

### Task 6: P0 history.md 占位 + 第一批验收

**Files:**
- Create: `spec/knowledge/understanding/ai-provider/history.md`

**Interfaces:**
- Consumes: Task 2–5 产出。
- Produces: 完整 P0 四件套 + 第一批验收记录。

- [ ] **Step 1: 写 history.md 占位**

内容：头部"派生·非权威"；说明"git 修改历史复现暂缓，后续按子系统聚合 `git log`"；留空章节骨架（按时间/按主题），不写虚构历史。

- [ ] **Step 2: 第一批整体验收**

核对：
- 8 图存在且零 token（Task 1）。
- README/index 链接解析、节点数一致（Task 2）。
- P0 四件套齐全，flow 经 architecture-health 校验，所有证据可定位，二开方向无接口预设（Task 3–5）。
- 全程未改产品代码/权威 spec，未自动 commit。
用 architecture-health 技能对 P0 文档做一次整体一致性检查。

- [ ] **Step 3: 向用户汇报第一批结果**

列出产出文件、8 图规模、引擎选型推荐、关键二开改动点（意图级）、任何健康警告与限制。请用户验收 P0，并决定是否继续 P1（Agent 管理 / 设置运行时）及是否提交。

- [ ] **Step 4: 不提交**（等待用户指示）。

---

## 后续计划（不在本批）

P1–P4 各子系统四件套各自成计划，复用本批底座与入口：
- P1：Agent 管理 / 平台适配；设置 / 运行时 / 安全。
- P2：存储 / canonical；同步 / 备份 / 恢复；Prompt 工作区。
- P3：Skill；MCP；Plugin；Rules。
- P4：生成 / 图像；Desktop 外壳 / 更新 / 托盘；多端交付。
git 修改历史复现（history.md 实质内容）暂缓，后续单独计划。

## 自审记录

- **Spec 覆盖**：design.md 的底座策略→Task 1；目录布局/入口→Task 2；四件套规范→Task 3–6；语言与抽象层级→Global Constraints 及各 Task 验收；证据/验证→各 Task 校验步；边界/不提交→Global Constraints 及各 Task 末步；成本（零 token 底座）→Task 1 Step 5。13 子系统清单→README 导航（Task 2）；本批仅 P0，其余明确后续成计划。
- **占位扫描**：无 TBD/TODO 式占位；history.md 的"暂缓"是 spec 明确决定而非占位失败。各文档任务给出精确证据源、章节结构与校验命令。
- **一致性**：`GRAPH(C)` 约定、`--code-only --no-cluster`、四件套文件名、"派生·非权威"头部在各 Task 一致。