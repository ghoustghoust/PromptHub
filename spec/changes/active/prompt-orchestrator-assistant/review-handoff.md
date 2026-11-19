# 提示词编排助手：实施交接与范围评审

## Product

Desktop

## 状态

review-pending — 第一版已实现并做针对性真实验证；第四轮原生 MOSS 布局画布已实现并验证，其余选材、风格包与数据导入需求待实施和评审。

> 本文是实施交接与评审材料，不是新增需求或第二套验收定义。权威需求与边界仍以同目录 [design.md](design.md) 为准。

## 1. 给上级 agent 的评审摘要

本次工作把 PromptHub 从提示词管理扩展为原生提示词编排能力，覆盖了：

- SQLite 结构化词库、`series` 与长句模板。
- SQL 选词、模型/系列适配、互斥过滤、受控随机。
- moodyMoss、MOSS、K2 三套独立规则卡片。
- 本地 OpenAI 兼容 LLM、八模式输入、三层字段及降级结果。
- CLI、Desktop 原生 IPC/preload/renderer 工作区。
- 原生 Skill 生成器，生成带 `[REFERENCE]` 与 `[SUGGESTION]` 的 `SKILL.md`，经既有 `skill:create` 写入 SQLite 和受管技能包。
- 真实 LLM 编排、截图反推、ComfyUI 实际生图和 Skill 落盘验证。
- 设置内的本地 llama.cpp 面板：模型/视觉文件、推理参数、健康状态、日志和自有进程启停；启动后自动连接默认文本/视觉模型，编排页提供快捷控制。
- 原生 MOSS 布局画布：比例网格、拖框/移动/缩放/排序、逐框描述与精确文字、0–1000 编辑坐标、确定性中心原点像素 JSON、角色框编号及右侧对照和存库。

**架构自评：未发现做成外挂、独立 HTML、第三方插件或额外前端服务的偏离。**产品链路是：

`React → preload → Electron main IPC → packages/core → packages/db / 已配置的 chat 模型`

**范围自评：仍有多项需要上级判定是否属于“第一版未完成收敛”，不能按全部验收完成处理：**

1. 八模式目前是一个编排服务内的模式分发与策略，不是八个独立引擎类。
2. 第四轮词条选材、风格/主题包和参考数据导入仍未实施；原生 MOSS 布局画布已关闭此前的编译器缺口。
3. 真实 KB 尚未批量回填 `series/template`，关系表也需要数据才能证明实际互斥效果。
4. `series/template` 的旧库迁移尚缺“已有词条在升级后仍保留”的直接回归证据。
5. 全量回归及 A/B/C 质量评估尚未执行。

## 2. 原需求与实现对照

| 原需求/边界 | 当前状态 | 评审说明 |
| --- | --- | --- |
| 结构化词库及 KB 导入 | 已实现 | 支持词条、关系、模型档案、验证记录、来源素材与 KB 导入。 |
| `series` 维度与长句模板 | 代码已实现，数据待回填 | schema、导入、查询、迁移、选词及输出均已接入；真实 KB 主要仍是空值。 |
| 意图→SQL 选词→模型/互斥过滤 | 已实现 | 显式词条优先、跨入口去重、模型/系列过滤、双向冲突排除均有代码。 |
| MOSS/K2/moodyMoss 规则 | 已实现为压缩规则卡片 | 不是运行时整文注入；保留关键差异和输出约束。 |
| 直接要求/合理推导/创意建议 | 已实现并由 core 接管词条 provenance | 显式锁定为 fixed；自动相关/随机选词为 flexible；创意建议为 optional。 |
| 初始版/完整改造/选定字段 | 已实现 | LLM 输出有结构校验；失败返回明确 degraded，不伪装完整结果。 |
| 扩写/专业/润色/反推/编辑/随机/JSON/LoRA | 代码已覆盖，独立引擎边界待评审 | 随机、编辑、反推、JSON、LoRA 有专用输入与处理；其余主要靠模式策略和规则分发。 |
| CLI 或 IPC 可测试入口 | 两者均已实现 | `prompthub orchestrate run` 与三个 Desktop IPC channel。 |
| 原生能力面板 | 已实现 | 现有 Prompt 工作区新增“提示词编排助手”视图，七种 locale。 |
| Skill 生成器 | 已实现 | 原生预览、参考/建议标记、确认后复用 `skill:create` 落盘。 |
| 原生 MOSS 布局画布 | 已实现并做针对性验证 | 归一化编辑、确定性像素编译、LLM 仅改描述、右侧 JSON 与存库；尚未做实际 MOSS 生图质量评估。 |
| 不做 RAG/向量索引 | 遵守 | 未添加 RAG 或向量数据库。 |
| 不自动操作 ComfyUI / D8 自动交接 | 遵守 | 用户后续明确要求加入本地 LLM 设置与启停；仅限 llama.cpp 自有进程，不包含 ComfyUI 自动显存交接。 |
| 不做外挂/独立 HTML | 遵守 | 未新增 Pages、插件、独立 HTML 或第三方前端。 |
| 完整测试与 A/B/C 质量评估 | 未完成 | 只有针对性单测、静态检查及真实环境工作流验证。 |

## 3. 变更目录

### 3.1 `packages/db`：词库与迁移

| 文件 | 变更 | 责任 |
| --- | --- | --- |
| `packages/db/src/prompt-vocab-schema.ts` | 新增 | 五张词库表；`series/template` 列；旧库幂等补列函数。 |
| `packages/db/src/prompt-vocab.ts` | 新增 | 词条/关系/模型/验证 CRUD、KB 导入、系列查询、NUL 校验。 |
| `packages/db/src/schema.ts` | 修改 | 聚合词库 schema 与索引，新增 `(category, series)` 索引。 |
| `packages/db/src/init.ts` | 修改 | 在索引创建前注册 `migratePromptVocabSchema`。 |
| `packages/db/src/index.ts` | 修改 | 导出词库 API 与迁移函数。 |

迁移语义：`series=NULL` 表示通用词条；指定系列时返回该系列与通用词条。系列化导入 ID 为 `category:series:en`，普通导入仍为 `category:en`。`template` 保存长句，`en` 保留短规范词。

### 3.2 `packages/shared`：跨包契约

| 文件 | 变更 | 责任 |
| --- | --- | --- |
| `packages/shared/types/prompt-vocab.ts` | 新增 | 词条、关系、模型档案、验证和导入结果类型。 |
| `packages/shared/types/prompt-orchestrator.ts` | 新增 | 八模式、输入输出、三层字段、Skill 草稿与 IPC 请求/响应类型。 |
| `packages/shared/types/local-model.ts` | 新增 | llama.cpp 配置、默认参数、引擎状态与模型连接契约。 |
| `packages/shared/types/index.ts` | 修改 | 导出上述契约。 |
| `packages/shared/constants/ipc-channels.ts` | 修改 | 新增编排及本地引擎配置、状态、启停、文件选择和日志 channel。 |

### 3.3 `packages/core`：编排与 Skill 生成

| 文件 | 变更 | 责任 |
| --- | --- | --- |
| `packages/core/src/prompt-orchestrator.ts` | 新增 | 输入校验、模式分发、模型/LoRA 指令、组合与降级主流程。 |
| `packages/core/src/prompt-orchestrator-vocabulary.ts` | 新增 | SQL 选词、相关性、模型/系列过滤、互斥、去重、受控随机。 |
| `packages/core/src/prompt-orchestrator-composition.ts` | 新增 | 三层输出、消息构造、JSON 校验、provenance 合并、降级草稿。 |
| `packages/core/src/prompt-orchestrator-rule-cards.ts` | 新增 | moodyMoss/MOSS/K2 独立规则卡片。 |
| `packages/core/src/prompt-orchestrator-llm.ts` | 新增 | OpenAI 兼容端口、无 Key 本地调用、图像输入、thinking 关闭、截断识别。 |
| `packages/core/src/prompt-skill-generator.ts` | 新增 | 复用词库/规则生成可复用 `SKILL.md`；参考与建议分离。 |
| `packages/core/src/cli/orchestrate-command.ts` | 新增 | CLI 参数、参考图、模式/规则/系列/画布与 JSON/table 输出。 |
| `packages/core/src/cli/help.ts` | 修改 | 注册 orchestrate 帮助与示例。 |
| `packages/core/src/cli/run.ts` | 修改 | 注册 orchestrate 资源路由。 |
| `packages/core/src/database.ts` | 修改 | 导出 `PromptVocabDB`。 |
| `packages/core/src/index.ts` | 修改 | 导出编排器、LLM 和 Skill 生成器。 |
| `packages/core/tests/prompt-skill-generator.test.ts` | 新增 | 真实 SQLite + 假 LLM 的 3 个生成器测试。 |

### 3.4 Desktop main / preload

| 文件 | 变更 | 责任 |
| --- | --- | --- |
| `apps/desktop/src/main/ipc/prompt-orchestrator.ipc.ts` | 新增 | IPC 注册、结构化错误响应。 |
| `apps/desktop/src/main/services/prompt-orchestrator-service.ts` | 新增 | 复用 AI 设置选择 chat 模型，调用 core 编排和 Skill 生成。 |
| `apps/desktop/src/main/services/local-llama-engine-service.ts` | 新增 | 参数校验、参数数组、配置持久化、健康检查、日志和自有进程生命周期。 |
| `apps/desktop/src/main/ipc/local-llama.ipc.ts` | 新增 | 本地引擎 IPC 与原生文件选择；退出时清理自有进程。 |
| `apps/desktop/src/main/ipc/index.ts` | 修改 | 注册 channel，并纳入数据库恢复后的 IPC 重绑定。 |
| `apps/desktop/src/preload/api/prompt-orchestrator.ts` | 新增 | 类型化 run、generateSkill、listSeries API。 |
| `apps/desktop/src/preload/api/local-llama.ts` | 新增 | 类型化本地引擎配置、状态、启停、文件选择与日志 API。 |
| `apps/desktop/src/preload/index.ts` | 修改 | 暴露 `window.api.promptOrchestrator` 与 `window.api.localLlama`。 |

### 3.5 Desktop renderer / 原生界面

| 文件 | 变更 | 责任 |
| --- | --- | --- |
| `apps/desktop/src/renderer/components/prompt/PromptOrchestratorWorkbench.tsx` | 新增 | 原生编排表单、双版本、字段、词条、警告、Skill 生成及本地引擎快捷控制。 |
| `apps/desktop/src/renderer/components/settings/LocalModelSettings.tsx` | 新增 | 设置内本地模型板块：文件、参数、状态、启停、日志与 AI 设置跳转。 |
| `apps/desktop/src/renderer/components/settings/useLocalLlamaEngine.ts` | 新增 | 设置页/编排页共用状态轮询、启停与模型连接流程。 |
| `apps/desktop/src/renderer/stores/settings/settings-ai-actions.ts` | 修改 | 原子新增/更新本地 chat 模型，持久化后设为文本及视觉默认。 |
| `apps/desktop/src/renderer/components/settings/SettingsPage.tsx`、`stores/ui.store.ts` | 修改 | 注册“本地模型”设置板块与导航契约。 |
| `apps/desktop/src/renderer/components/prompt/usePromptOrchestratorWorkbench.ts` | 新增 | 模型/系列加载、参考图、请求状态、Skill 草稿与确认保存。 |
| `apps/desktop/src/renderer/components/prompt/PromptSkillDraftPanel.tsx` | 新增 | 草稿、参考/建议、保存状态展示。 |
| `apps/desktop/src/renderer/components/prompt/PromptViewContainers.tsx` | 修改 | 注册原生 orchestrator 视图。 |
| `apps/desktop/src/renderer/stores/prompt.store.ts` | 修改 | 新增 `orchestrator` ViewMode 与持久化识别。 |
| `apps/desktop/src/renderer/components/layout/SidebarPromptPanel.tsx` | 修改 | 新增原生导航项。 |
| `apps/desktop/src/renderer/components/layout/useSidebarPromptController.tsx` | 修改 | 打开编排工作区。 |
| `apps/desktop/src/renderer/components/layout/useSidebarShellController.tsx` | 修改 | 复用 workbench 侧栏行为。 |
| `apps/desktop/src/renderer/components/layout/TopBar.tsx` | 修改 | 编排视图复用 workbench 顶栏行为。 |
| `apps/desktop/src/renderer/i18n/locales/{en,zh,zh-TW,ja,fr,de,es}.json` | 修改 | 编排与 Skill 生成的七种界面语言。 |
| `apps/desktop/src/renderer/services/ai.ts` | 修改 | 仅 loopback 允许无 Key 生图，远程仍强制 API Key。 |
| `apps/desktop/src/renderer/services/ai-image-openai.ts` | 修改 | 无 Key 时不发送空 Authorization header。 |

### 3.6 测试、资料与输出

| 路径 | 说明 |
| --- | --- |
| `apps/desktop/tests/helpers/window.ts` | 补齐新 preload API 的 mock 形状。 |
| `apps/desktop/tests/unit/main/prompt-vocab-db.test.ts` | 前序词库层 12 个真实 SQLite 测试，本批继续通过。 |
| `apps/desktop/tests/unit/main/local-llama-engine-config.test.ts` | 本地引擎默认参数、参数数组和非法输入 3 个单测。 |
| `start-prompthub-test.bat` | 打包前原生测试启动器；构建当前代码并使用隔离 profile，不是安装包。 |
| `outputs/prompt-orchestrator-native-test-20261118/` | 编排、反推、实际生图证据，不是产品源码。 |
| `outputs/prompt-skill-generator-test-20261118-final/` | 最终 `SKILL.md`、SQLite 记录与草稿截图，不是产品源码。 |
| `spec/changes/active/prompt-orchestrator-assistant/design.md` | 权威需求与实施状态，已更新。 |
| `spec/changes/active/prompt-orchestrator-assistant/review-handoff.md` | 本评审对接文档。 |

### 3.7 不应计入本功能产品改动的目录

- `.gitignore` 的 graphify 忽略项属于前序理解层工作。
- `.workbuddy/`、`.qoder-credits/`、`.qoder-input-images/` 属于会话资料，不是产品实现。
- 根目录 GGUF 是用户提供的模型文件，未修改。
- `prompt/` 是规则与截图输入资料；代码使用提炼后的规则卡片，不自动加载截图。
- `prompt-kb/` 是 KB 输入资料，未被当作运行时 RAG 使用。
- `spec/knowledge/understanding/` 与 `component-understanding-kb/` 属于前序只读理解层。

## 4. 公共接口与对接方式

### 4.1 Core 编排

- 主服务：`PromptOrchestrator.orchestrate(input)`。
- Skill 生成：`PromptSkillGenerator.generate(input, skillName?)`。
- LLM 端口：可注入 `PromptOrchestratorLlm`；真实运行使用 `OpenAiCompatiblePromptLlm`。
- 完整字段定义以 `packages/shared/types/prompt-orchestrator.ts` 为唯一契约来源。

### 4.2 CLI

示例：

```powershell
pnpm prompthub orchestrate run `
  --prompt "A reader beside an old wooden window at golden hour" `
  --llm-model <local-model-name> `
  --skill moss `
  --format caption `
  --series <series-name>
```

支持八模式、规则卡片、模型/系列、显式/锁定/排除词条、LoRA、随机约束、参考图、候选数及 validated-only。使用 `--help` 查看当前完整参数，不以本文复制内容替代 CLI 帮助。

### 4.3 Desktop IPC

| Channel | 输入 | 输出 |
| --- | --- | --- |
| `prompt:orchestrator:run` | `DesktopPromptOrchestrationRequest` | `PromptOrchestratorIPCReply<PromptOrchestrationResult>` |
| `prompt:orchestrator:generateSkill` | `DesktopPromptSkillGenerationRequest` | `PromptOrchestratorIPCReply<PromptSkillDraft>` |
| `prompt:orchestrator:series` | 无 | `PromptOrchestratorIPCReply<string[]>` |
| `localLlama:config:get/save` | 本地引擎配置 | 持久化后的 `LocalLlamaEngineConfig` |
| `localLlama:status/start/stop/restart` | 无 | `LocalLlamaEngineStatus` |
| `localLlama:selectFile/readLog` | 文件类型 / 无 | 用户选择路径 / 最近引擎日志 |

`llmModelId` 指向 PromptHub 现有 chat 模型配置；省略时使用 `mainText`，再回退到默认/首个 chat 模型。当前只接受 OpenAI 兼容协议。IPC 响应统一为 `{ok:true,data}` 或 `{ok:false,error:{code,message}}`。

Skill 保存不另造文件写入通道，使用现有 `window.api.skill.create`。重名和非法内容由既有 Skill 创建流程处理，不静默覆盖。

### 4.4 原生 UI 流程

- Prompt 工作区侧栏进入“提示词编排助手”。
- 编排结果：初始版、完整改造、fixed/flexible/optional 字段、选定词条与警告。
- Skill 草稿：完整 `SKILL.md`、可展开 `[REFERENCE]`、可选 `[SUGGESTION]`。
- 只有用户点击“保存到技能库”后才执行创建；重复点击受保存状态保护。
- “设置 → 本地模型”管理引擎文件和参数；点击“启动并连接”后，健康检查通过且默认模型持久化完成才视为可用。编排页提供启动、停止和设置入口。
- 打包前测试可双击根目录 `start-prompthub-test.bat`；测试 profile 与正式数据隔离。

## 5. 兼容、失败与恢复边界

- `series/template` 新列在新装 schema 和旧库迁移中同源，迁移在索引创建前执行且可重复运行。
- 迁移事务沿用现有 `initDatabase` 事务；失败按现有数据库初始化失败流程处理。
- LLM 网络错误、空内容、截断和 JSON 结构错误返回 `status="degraded"` 与明确 warnings，不伪装成完整生成。
- 自动选词的层级由 core 决定，不能由 LLM 把系统候选伪装成用户固定要求。
- 仅 `127.0.0.1`、`localhost`、`[::1]` 允许无 Key 生图；远程 provider 仍要求 API Key。
- `skill:create` 使用既有受管包路径和原子发布逻辑，没有第二份 Skill 存储。
- llama.cpp 仅绑定 `127.0.0.1`，以 `shell:false` 参数数组启动，不提供任意命令执行入口；只终止 PromptHub 持有的子进程。外部引擎可连接但停止操作会明确拒绝。
- 模型连接通过 renderer 现有设置持久化完成，不用 core 全量重写配置，因此保留其他供应商和已有 `chatParams`。
- 本次启动的测试引擎均已停止，临时 live 测试文件和不合格旧草稿已清理。

**尚缺直接证据：**一个含既有 `prompt_terms` 数据的真实旧库，在升级后保留词条、关系及验证记录并成功补列。当前测试主要证明新 schema、查询和真实应用启动，不能替代该兼容回归。

## 6. 验证证据

### 自动化与静态检查

| 检查 | 结果 |
| --- | --- |
| `packages/core/tests/prompt-skill-generator.test.ts` | 3/3 通过，真实 SQLite + 假 LLM。 |
| `apps/desktop/tests/unit/main/prompt-vocab-db.test.ts` | 12/12 通过。 |
| `apps/desktop/tests/unit/services/ai-transport.test.ts` | 23/23 通过。 |
| `apps/desktop/tests/unit/main/local-llama-engine-config.test.ts` | 3/3 通过。 |
| `shared/db/core/desktop` TypeScript | 全部通过。 |
| Desktop 测试代码 TypeScript | 通过。 |
| 新增 Desktop 文件定向 ESLint | 通过。 |
| `pnpm.cmd --filter @prompthub/desktop build` | 通过。 |
| `git diff --check` | 通过。 |

### 真实环境工作流

- MOSS 编排：固定要求、合理推导、创意建议和自动词条 provenance 均出现。
- moodyMoss 润色：保留核心字段，移除 `masterpiece / 8k`。
- 手动选择 `prompt/fc388e80facf224fb9cdaeb01fe90870.png` 反推：第二版消除界面计数/评分误导，仍利用外观卡文字字段。
- 原生 Image Workbench 使用 `image-moss-sft-int8-8step__moodymossmix-int8` 成功生成 1 张图；主体、汉服、阅读、木窗、暖光与中景匹配。
- 真实本地 LLM 生成 Skill 后点击保存，SQLite 记录和受管目录 `SKILL.md` 均存在，含 `[REFERENCE]` 与 `[SUGGESTION]`。
- 最终 Skill 工作流为完整句子；Caption 未混入 Layout，建议均为可见视觉细节。
- 本地 LLM 原生 E2E：设置页保存真实 llama-server/IQ4_XS/mmproj 配置，点击启动后状态为运行中，`prompthub-local` 成为默认文本/视觉模型，编排页返回非降级结果，随后停止成功；整轮约 36 秒。

证据目录：

- `outputs/prompt-orchestrator-native-test-20261118/`
- `outputs/prompt-skill-generator-test-20261118-final/`

临时 live E2E 文件未保留，因此上述真实验证以输出证据为准，不宣称拥有可重复的一键 live 测试命令。

## 7. 需要上级重点判定的偏差/风险

### 7.1 八模式是否必须“分别成引擎”

当前为一个 `PromptOrchestrator` 服务内的模式分发：随机有受约束选词，编辑/反推/JSON/LoRA 有专用输入和处理，其他模式由不同指令和排序策略区分。

如果原要求是八个完全独立、可替换的引擎实现，则当前只能记为**部分完成，需要收敛**，不能仅凭八个枚举值验收。

### 7.2 MOSS Layout 的“已编译”要求（原生画布路径已关闭）

`packages/core/src/prompt-moss-layout.ts` 现已提供独立确定性编译器及边界校验。原生画布只把 0–1000 normalized `yxyx` 作为编辑数据，由 core 向外取整并转换为中心原点绝对像素；LLM 仅返回整体与逐框描述，不能决定坐标或精确文字。初始/最终 JSON 和 degraded 回退均走编译器。该项对**原生画布路径**已完成；实际 MOSS 生图质量仍属后续验收。

### 7.3 真实数据覆盖

- 现有 KB 的 `series/template` 尚未批量回填，功能主要由测试词条证明。
- `term_relations` 需要真实关系数据，才能证明生产词库中的互斥排除效果。
- 词条来源与验证状态已保留，但社区词条并未因此自动变成“已验证”。

### 7.4 旧库升级保留

需补真实旧库回归：已有词条、关系、模型档案、验证记录在 `series/template` 迁移后保留且可读取；重复执行迁移不新增重复列或重复数据。

### 7.5 质量与验收范围

尚未执行全量回归、跨平台测试、A/B/C 七项质量评分及多次模型输出稳定性评估。当前结论应限定为“实现及针对性验证完成”，不是发布验收。

### 7.6 明确未扩展的范围

- 未实现 RAG、向量索引、自动 ComfyUI 操作或 LLM ↔ ComfyUI 自动显存交接；本地 LLM 启停是用户后续明确新增的范围。
- 未实现角色档案/写真包的独立持久化模型。
- 未新增 Web/Mobile/Cloudflare 入口。
- 未写入用户正式技能库；保存验证使用隔离 profile。

## 8. 建议上级评审顺序

1. 先确认“八模式独立引擎”是否属于第一版硬性验收；原生 MOSS 布局编译器缺口已关闭。
2. 检查 `packages/db/src/init.ts` 的迁移顺序与旧数据保留回归。
3. 检查 core provenance、模式分发、降级行为是否满足三层创造力契约。
4. 检查 IPC 输入校验、模型选择、错误响应与数据库恢复重绑定。
5. 检查 `skill:create` 复用是否确实生成受管包，而非第二套文件存储。
6. 决定剩余工作是标记 `completed`、`review-pending` 还是 `needs-convergence`，不要直接按全部通过关闭。

## 9. 当前交接状态

- 最新 commit、远程同步与推送结果以 Git 记录为准；提交或推送不等于功能验收或正式发布。
- 没有新增外部服务或正式用户数据写入。
- 测试用 `8080/8190/8288` 监听均已停止。
- 后续若要完成收敛，优先补：旧库迁移回归、真实关系/系列数据、第四轮选材与主题包、独立引擎边界确认及 A/B/C 评估。

## 10. 第二轮用户反馈修正：输入、规则与引导

### 范围与架构

- 仍是 Electron 原生二次开发，没有 Pages、宜搭、外部 HTML 或新服务。
- 图片任务与输出结构分离：JSON 成为 `includePayload`，LoRA 成为高级适配约束；旧 CLI `json/lora` 仅保留兼容。
- 新增 `PromptGuidanceMode`：Agent 强改造或词条驱动 · 人工定稿。词条驱动 · 人工定稿使用显式锁定词条选材，默认不自动加词。
- 新增 H3 视频任务类型，但只生成提示词文本，不执行视频生成，不操作 ComfyUI。

### 主要新增/修改文件

| 文件 | 责任 |
| --- | --- |
| `packages/shared/types/prompt-orchestrator.ts` | 视频任务、引导方式、Token 指标、词库搜索、输出格式与兼容类型。 |
| `packages/core/src/prompt-orchestrator-rule-cards.ts` | 依据三份官方 HTM 更新 MOSS/Krea 2，新增 MiniMax-H3 视频规则。 |
| `packages/core/src/prompt-token-budget.ts` | 确定性 Token 估算、词库预算和 MOSS 软区间警告。 |
| `packages/core/src/prompt-orchestrator-composition.ts` | 分任务消息、视频字段、H3/短剧/MOSS Layout 输出校验及视频降级骨架。 |
| `packages/core/src/prompt-orchestrator-vocabulary.ts` | 自动候选每类默认 2 条、约 900 Token 预算，词条驱动 · 人工定稿默认不自动加词。 |
| `packages/core/src/prompt-orchestrator-llm.ts` | 可选 `/tokenize` 计数；失败回退估算。 |
| `packages/core/src/prompt-orchestrator.ts` | 视频输入校验、媒体类型、Token 指标、任务警告与结构化载荷。 |
| `packages/db/src/prompt-vocab.ts` | 原生词库中英文/模板搜索、分类/系列过滤、废弃条目排除。 |
| `apps/desktop/src/renderer/components/prompt/PromptReferenceImageInput.tsx` | 文件选择、Ctrl+V 粘贴、拖放、预览与首/尾帧标签。 |
| `apps/desktop/src/renderer/components/prompt/PromptVideoFields.tsx` | H3 时长、镜头、动作、运镜、光影、参考用途、声音与实验节拍输入。 |
| `apps/desktop/src/renderer/components/prompt/PromptVocabularyPrefabPanel.tsx` | 词条驱动 · 人工定稿右侧大型词条选材搜索、选择与锁定面板。 |
| `apps/desktop/src/renderer/components/prompt/prompt-orchestrator-catalog.ts` | 任务、输出格式、图片数量与分类目录。 |
| `apps/desktop/src/renderer/components/prompt/usePromptOrchestratorWorkbench.ts` | 分模式状态、视频输入、显式词条、图片文件与结果面板控制。 |
| `apps/desktop/src/main/ipc/prompt-orchestrator.ipc.ts`、preload | 新增 `prompt:orchestrator:vocabulary:search` 类型化通道。 |
| `packages/core/tests/prompt-orchestrator-v2.test.ts` | 词条驱动 · 人工定稿、H3 字段、MOSS 软预算、JSON 输出与非法格式降级测试。 |

### 已确认边界

- MOSS 长度使用用户指定的 Token 软预算，不把实测曲线写成官方规则，不为了 2000 Token 填塞文本。
- 初始场景内深化允许人物外观、姿势、服饰、场景物件与光影；避免无关人物/动物和新剧情。
- Qwen Image 2.1 本轮不接；MiniMax-H3 是视频；卡点是实验草案。
- Token 指标来自连接模型 `/tokenize` 或明确估算，均不冒充 MOSS/MiniMax 官方计数。
- 其他 locale 的新文案使用项目已有英文 fallback；中文与英文说明已完整加入。

### 新验证证据

- Core v2 与格式校验测试：5/5 通过；连同 Skill 生成器共 8/8 通过。
- 真实原生 E2E：反推剪贴板图片成功；H3 文生视频实际返回三个必需字段；词条驱动 · 人工定稿搜索 `golden`、锁定词条选材并完成非降级润色。
- 曾出现本地模型只返回普通一句描述、缺 H3 字段的问题。新增任务级校验后，普通描述不能再冒充完整 H3；强化契约后的真实复测通过。
- 外部启动的 8080 引擎按边界只连接不停止，E2E 没有强行清理用户进程。

### 尚未声称完成

- H3 的首尾帧、多参、长视频、短剧和卡点都有输入与规则，但没有逐一做真实生成质量 A/B 验收。
- 卡点是否满足真实音乐节拍尚未验证；短剧系统 Prompt 的长期稳定性尚未评估。
- MOSS Token 曲线的最优长度仍需同模型同种子实验；当前只提供软提示，不证明 2000 Token 在所有场景最佳。
- 未做底模/LoRA 搭配统计、完全空输入 Skill 兜底、真实视频生成或自动 ComfyUI 操作。

## 11. 第三轮：真实图片链路、Token 与规则隔离

### 用户反馈对应的实际修复

1. **本地图片导入**：原链路在保存数组为空时会无提示失败。现改为隐藏文件输入选择真实文件，
   `FileReader` 直接生成图片数据，不再依赖原生文件对话框和复制/读回路径。
2. **系统剪贴板**：新增 `image:readClipboard` 主进程通道，读取 `clipboard.readImage()`；
   无位图时兼容 Windows 剪贴板文件路径。`Ctrl+V` 在图片区通过键盘事件显式处理，
   不再只依赖不稳定的非编辑区域 `paste` 事件。
3. **Token 指标**：区间提示全部改为观察性描述，允许冗余，不自动减少或提前终结。
   LLM 默认输出上限由 2048 提高至 4096；`finish_reason=length` 仍拒绝半截结果并明确降级。
4. **规则驱动布局**：`taskModesForSkill` 取代混合任务列表。H3 只显示视频任务，
   MOSS/Krea 2 只显示图片任务；结果附带 `skill/outputFormat`，按媒体类型展示。

### 真实验证

- 通过真实 PNG `setInputFiles` 验证图片进入列表，不是虚构 data URL。
- 通过 Windows `Clipboard.SetImage` 和“粘贴剪贴板图片”按钮验证原生位图读取。
- 通过图片区键盘 `Control+V` 验证直接粘贴；三种输入方式最终同时存在 3 张预览图。
- 验证 H3 视频字段显示且无图片高级适配项；MOSS 有 Tags，Krea 2 无 Tags/Layout。
- 新增输出预算单测，确认默认 `max_tokens=4096`；Core 总计 9/9 通过（含 Skill 测试）。

### 评审提醒

之前仅模拟 `ClipboardEvent` 的验收不足以证明真实可用。本轮已用真实文件与 Windows 剪贴板复验，
但没有把 Electron 原生文件对话框自动化成功作为通过条件；当前产品路径已不依赖该对话框。
其他既有范围缺口（H3 各视频模式质量、MOSS Layout 编译、真实 KB 回填等）仍未关闭。

## 12. 第四轮需求与原生海报布局落地（2026-11-19）

> 本节登记最新需求、参考资料和实际影响。权威要求见 [design.md](design.md) 第四轮；
> 原生布局画布已落地，其他第四轮需求仍未声称实现。

### 已确认的新需求

1. “词库预制菜”更名为“词条选材”；普通窗口下重新安排主操作区，避免“开始编排”
   被挤成两行，宽屏三栏与右侧左右对照继续保留。
2. 词条选材升级为多字段、多候选、多选择语义的创作工作台，支持写实、3D、2.5D、
   动漫等素材包，以及动漫可选画师词组。Agent 负责去重、组织、冲突检查和优化，
   不覆盖用户显式选择。
3. MOSS 增加电商/海报主题，并在编排助手中原生实现参考官方 `Create Bounding Boxes`
   语义的布局编辑与确定性 Layout 编译校验；不做 ComfyUI 插件、外部页面或新增端口。
4. 两份本地工具只作为标签、分类、角色、预设和界面密度参考。数据需审核、规范化、
   去重、记录来源与验证状态后导入 SQLite，不迁移其 HTML/EXE/代理/localStorage。
5. 已认可且保存的 Prompt 可拆解为预设或词条，但属于独立的提示词库知识沉淀功能，
   不纳入本轮编排助手直接开发。

### 参考资料核对结果

- 图 2 的 Krea2 生成器用于参考字段池、候选数量、锁定与多套输出，不是要求复制其
  独立应用架构。
- `提示词生成器v3.0` 的说明与内嵌数据证明可复用素材包括分类标签、角色与组合预设。
- SkyLoong 的 `taglib.json` 提供分层标签结构；大型画师表和自动翻译只是原始输入，
  存在审核与去重成本，不能全量盲导或自动标为已验证。
- ComfyUI 官方教程确认 MOSS 布局包含逐框描述、对象/文字框、背景到前景的框顺序、
  角色框编号，以及场景 Caption 与 Layout 共同使用的语义。PromptHub 需要自己拥有
  编辑状态和编译校验，不能只让 LLM 自由生成 JSON 后就算完成。

### 对现有系统的预计影响

| 边界 | 预计影响 | 当前状态 |
| --- | --- | --- |
| Renderer | 选材工作区拆分与普通窗口响应式主操作区 | 待实施；原生海报画布与右侧结果联动已完成 |
| Shared | 风格/主题包与字段选择语义 | 待设计并实施；布局编辑状态与编译结果契约已完成 |
| Core | 选材冲突/归属与预设应用 | 待实施；布局确定性编译和坐标校验已完成 |
| DB | 审核后的标签/预设导入、来源与幂等映射；尽量不改动已稳定的核心 Prompt 表 | 待设计并实施 |
| 其他模块 | 已保存 Prompt 拆解属于独立词库维护主题；图谱联动仍是既有缺口 | 不在本轮实施 |

这些新增需求不改变“原生扩展、规则隔离、Token 只观察、三层来源、右侧左右对照、
系统提示词层和存库/收藏”的既定边界。实现前仍需按实际改动补回归，不以本次文档
归档作为功能通过证据。

## 13. 上游同步与本次源码推送边界（2026-11-19）

- 仓库仅有 `origin`，目标为用户指定的 `ghoustghoust/PromptHub`；没有单独配置的
  `upstream` 远程。`git fetch origin --prune` 后，本地基线与 `origin/main` 均为
  `7e69e6f7`，左右计数 `0/0`，无需 merge 或 rebase，也没有上游代码冲突。
- 本次推送是工作区源码与规格同步，不是版本发布：不修改版本号、稳定下载入口、
  `CHANGELOG.md` 或 `spec/releases/`，不创建 tag、Release 或安装包。
- 对现有产品的影响集中在新增词库 schema/迁移、编排与本地引擎 IPC、Prompt 视图和
  设置入口、结果存库/收藏，以及 loopback 无 Key 生图修复。既有 SQLite、Prompt、
  Skill 和 AI 设置继续由原所有者管理，没有引入第二存储或 renderer 直连数据库。
- `.gitignore` 排除 GGUF、参考项目 `prompt/` 与 `prompt-kb/`、人工验证 `outputs/`、
  会话缓存及可再生图谱。原始参考资料和本机测试证据保留在用户本机，不作为产品源码
  推送；`spec/knowledge/understanding/` 与相关活动设计文档属于可提交的理解/决策记录。
- 截至该次推送，第四轮词条选材、风格/主题包、数据导入和原生海报布局仍为待实施需求。
  原生海报布局的后续落地见第 14 节；旧库升级保留、全量回归、A/B/C 质量评估等既有缺口
  不会因推送或局部功能落地而关闭。

### 本次提交前复核

- Core 定向测试：`prompt-alignment`、`prompt-orchestrator-v2`、`prompt-skill-generator`
  共 3 个文件、12/12 通过。
- Desktop 定向测试：词库、本地引擎参数、左右对照、i18n 与 AI transport 共 6 个文件、
  49/49 通过，其中词库为 13/13、AI transport 为 23/23。
- `shared/db/core/desktop` 及 Desktop 测试代码 TypeScript 检查通过；改动 Desktop
  TS/TSX 文件定向 ESLint 通过；文件行数门禁通过。
- `pnpm.cmd --filter @prompthub/desktop build` 通过；Vite 仅报告既有动态/静态导入
  chunk 提示。`spec:test` 7/7、13 个 change 的追踪校验和 `git diff --check` 通过。
- 本次未重跑全量 core/Desktop 测试、真实本地模型或真实生图；这些边界沿用前文分项
  证据，不以本轮文档与源码同步新增任何实时验收结论。

## 14. 原生 MOSS 布局画布落地（2026-11-19）

### 变更文件

- `packages/shared/types/prompt-moss-layout.ts`：归一化编辑框、模型 JSON 与角色框结果契约。
- `packages/core/src/prompt-moss-layout.ts`：边界校验、0–1000 → 中心原点绝对像素编译、
  单行模型 JSON 序列化；最小边 floor、最大边 ceil，尺寸必须为 16 的倍数。
- `packages/core/src/prompt-orchestrator-composition.ts`：原生画布专用 LLM 描述契约、
  初始/最终编译、固定字段 provenance 和有效 degraded 回退。
- `apps/desktop/src/renderer/components/prompt/useMossLayoutEditor.ts`：独立画布状态。
- `apps/desktop/src/renderer/components/prompt/PromptMossLayoutCanvas.tsx`：原生比例网格、
  拖框/移动/缩放/删除/排序、对象/文字框、角色标记和坐标微调。
- `apps/desktop/src/renderer/components/prompt/PromptMossLayoutResultView.tsx`：目标尺寸、
  框数、角色框序号以及初始/最终格式化 JSON 对照。
- 工作台、共享类型、core 导出、Skill 生成器、存库标签和中英文案完成接线；没有新增
  插件、独立 HTML、外部服务或 ComfyUI 自动操作。

### 验证证据

- Core `prompt-moss-layout` 5/5：覆盖精确文本、角色框序号、16:9 重缩放、非法输入、
  LLM 仅改描述及有效 degraded 回退。
- 真实 Electron 临时 E2E 通过：画框、移动/缩放坐标变化、角色框、16:9、IPC、core 编译、
  右侧 JSON、`character_boxes: 2` 和 SQLite 存库/`layout` 标签。模拟响应只存在于测试
  进程，不是产品新增端口；正式功能仍走用户已配置的本地或云端 chat 模型。
- 最终定向回归：Core 4 个文件 17/17、Desktop 7 个文件 50/50（含九种比例精确性及
  16 倍数校验）；shared/db/core/desktop
  及测试代码 TypeScript 检查、改动 renderer 文件定向 ESLint、Desktop 构建、文件行数、
  `spec:test` 7/7、13 个 change 追踪校验和 `git diff --check` 均通过。
- 截图与结果：`outputs/moss-layout-native-test-20261119/`。尚未验证真实 MOSS 生图质量，
  也未完成第四轮选材、主题包、参考数据导入、全量回归或 A/B/C 评估。
