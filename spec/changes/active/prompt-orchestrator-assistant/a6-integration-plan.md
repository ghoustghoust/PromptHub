# 提示词助手全链路审计与 A6 落地计划

状态：已审计、待实施（2026-11-24）。本文件是后续批次的执行依据，权威需求仍以
[design.md](design.md) 为准；两者的冲突以 design.md 的既有契约优先。

## 1. 范围与证据

本轮审计覆盖“整个提示词助手”，不只编排工作台：

- 239 个 prompt 相关源文件（约 2.0 MB）：shared 类型、db、core、main、preload、renderer。
- 15 张表：prompts / prompt_versions / folders / prompt_relations / output_format_items /
  prompt_test_runs / prompt_orchestration_feedback / prompt_orchestrator_state /
  prompt_writing_presets / prompt_terms / term_aliases / term_relations / model_profiles /
  validation_records / source_assets。
- 4 条 AI 调用链：编排、内联提示词测试、测试弹窗（含多模型对比）、图片反推/生图。
- 135 个 prompt 相关测试文件（103 unit + 21 e2e + fixtures）。
- 隔离 profile 只读查询：prompt_terms 90,596；term_aliases 18,185；writing_presets 5；
  orchestrator_state 1 行；feedback 1 行；prompts 0；test_runs 0。

审计方式：静态读代码 + 隔离库只读查询。未做运行时复现，未逐行读完 239 个文件。

## 2. 分层结论

### 2.1 契约层（shared）

- 72 个 prompt 相关类型集中在 `packages/shared/types/prompt*.ts`，IPC 与 core 共用同一套，
  没有 renderer 私有协议。
- 缺口：没有“知识包/模块/选择”的类型；`PromptOrchestratorWorkspaceState` 没有画布字段。
- preload 对 `prompt` API 基本不写泛型，renderer 依赖断言；类型漂移只能在运行时暴露。

### 2.2 存储层（db）

- prompt 创建/更新/加版本已用事务（`packages/db/src/prompt.ts:173,404,581`）；
  初始版本与 Prompt 同事务，早期 F06 已修。
- 问题：
  - `prompt_orchestrator_state` 把 `systemLayerText` 静默 `slice(0, 20000)`
    （`prompt-orchestrator-state.ts:26,105`），而 64K 档写作层可达约 57k token。
  - 状态是全局单行 `id="default"`，不区分项目/提示词库。
  - `prompt_test_runs` 无保留策略，快照含完整输入输出。
  - `prompt_orchestration_feedback` 只有写入路径，`list()`（:185）全仓库无调用。
  - 词库没有应用内导入/更新入口；生产写入者只有 `packages/db/scripts/*`。

### 2.3 业务层（core）

- 编排入口 `PromptOrchestrator` + `PromptOrchestratorLlm` 接口，工具/流式/计数均为可选能力，
  可替换；每次 run 新实例，无跨请求单例状态。
- 统一 token 估计（`shared/utils/prompt-token-estimate.ts`），预算超限抛
  `SYSTEM_PROMPT_LAYER_OVER_BUDGET`，不静默截断。
- 缺口：`PromptOrchestratorOptions.vocabulary` 是具体 `PromptVocabDB`，没有词库读取接口；
  新知识源只能进同一张词库表。
- 取消在阶段边界 + LLM 信号上生效；布局辅助此前把取消吞成 degraded，已修为 CANCELLED。

### 2.4 主进程（main）

- service 负责参数校验、模型解析、DB 生命周期；IPC 统一 `{ok,data|error}` 信封。
- 两套取消登记：`prompt-orchestrator.ipc.ts` 的 `activeRuns` 与 `ai.ipc.ts` 的
  `activeRequests`。当前不冲突，但新入口要各接一次。
- 生图批次取消只把槽位标为 cancelled（`generation-library.ts:369`），在途图片请求不中断。

### 2.5 渲染层（renderer）

- 状态源：`prompt.store`（列表/筛选/视图）+ workspace hooks + 局部 state；大部分是单向，
  但 AI 测试结果、画布、编排结果各自为政。
- 4 条 AI 链路、3 套流式调度（rAF）实现：编排 hook、内联 runner、测试弹窗。
- 只有编排和布局辅助有停止按钮；测试/对比没有，生图停止不彻底。
- 布局辅助期间画布仍可增删/排序，结果却按数组下标回填。

## 3. 缺陷清单

### P0（正确性/数据）

1. 写作层 20k 静默截断，重启后长度变化（`prompt-orchestrator-state.ts:26,105`）。
2. 补描述按 `captions[index]` 回填（`usePromptOrchestratorWorkbench.ts:848-852`），
   assist 期间结构可改 → 文案落错框。
3. 主编排与布局辅助无互斥：`canRun`（:656）/`run`（:726）不看 `isAssistingLayout`；
   `refine`（:822）/`reverse`（:882）不看 `isRunning`。
4. 反推 `setBoxes` 直接覆盖（:910），无确认、无撤销。
5. 词库/知识没有应用内导入入口，新素材只能靠脚本。

### P1（功能/一致性）

6. 提示词测试与多模型对比无停止；`AiTestModal` 只取消 rAF（:261-276），
   未传 `requestId`。
7. 生图批次取消不中断在途 HTTP。
8. 反馈只写不读，无评估闭环。
9. 测试历史无保留策略；内联测试不入历史，测试弹窗入历史。
10. 布局草稿不持久化；workspace 状态全局单行。
11. 渲染层无统一 AI run 控制器；preload 类型弱。
12. 每个 Prompt 的 AI 状态在内存 map 中只增不减，删除 Prompt 不清理。

### P2（死代码/维护面）

13. 真无引用：`MAX_QUERIES_PER_CALL`（`prompt-vocabulary-retrieval.ts`）、
    `PromptListView.tsx`（仅 barrel 导出）、`PromptFeedbackDB.list()`。
14. core `prompt-*.ts` 有 20+ 个只在本文件/测试使用的导出，暴露面偏大。
15. `CreatePromptModal`（40KB）与 `EditPromptModal`（49KB）表单结构重复；
    `PromptDetailModal` 与详情面板是两套详情 UI。
16. 说明：`prompt.search/copy/insertDirect/syncWorkspace/...insertDirect` 虽不被桌面
    renderer 调用，但被 Web/安装桥使用，不算死代码。

## 4. prompt/new 资产清单与接入点

共 5,802 文件（1,931 md / 2,990 jpg / 439 png / 316 json）。按“资产类型 → 产品位置”分类：

| 目录 | 资产性质 | 接入位置 | 首批 | 备注 |
|---|---|---|---|---|
| Skill-Film-v2.00.1 | 完整 Skill + 5 条产线 + schema/tools/知识/模板 | 知识包（模块化）+ Skill 预览 | 是 | 唯一有机器规格：frontmatter 五字段、七段、P/S/H、32k、≤50KB/6k token |
| 压缩包版本+老唐电影级分镜skill-s9 | Seedance 分镜 Skill | 知识包/Skill | 是 | 与 Skill-Film 分镜部分重叠，按“中文电影分镜/通用影视”分流，不重复注入 |
| 斯坦尼斯拉夫斯基表演体系skill | 表演体系知识库（Kimi/DeepSeek/豆包三版 + 备份） | 知识包 + 写作预设候选 | 是 | 只选一版为规范版；其余标变体；`_备份` 默认跳过 |
| moss-prompt | MOSS-Image Skill | Skill + 写作预设候选 | 是 | 与内置 `builtin-moss-writing-core` 交叉引用；不重复灌同一段规则 |
| r18-novel-h3 | 小说→视频 Skill + 12 个 py 脚本 + 8 个备份 | Skill（文本只读） | 否 | 脚本不自动执行；R18 需显式开关；只取 SKILL.md 与 references |
| ai分镜实战 | 总控命令 v9（md 50KB + docx） | 写作预设（单文档） | 是 | docx 只抽正文，不入 HTML；作为“整段预设”而非模块 |
| 色卡-资料包 | 10 类 × 20 导演图片库 + 风格说明 | 参考素材库 | 否 | 需缩略图、最多 3 份、不整库进 prompt |
| R2VA加强版提示词模板.md | 单文件视频模板 | 写作预设 | 是 | 直接导入为自定义预设 |

接入原则：

- **知识包 ≠ 规则卡 ≠ 词库 ≠ Agent Skill**。规则卡决定输出语法（caption/tags/layout）；
  知识包提供方法论模块；词库提供候选词条；Agent Skill 是可执行工作流。四者只做交叉引用，
  不合并协议。
- 知识包默认只读、只注入文本，不执行脚本、不加载图片、不写词库。
- 变体与备份必须显式选择；内容哈希去重；导入前预览“将导入/跳过/冲突”。
- 交叉引用点：
  - 规则卡 → 推荐知识包（moss → MOSS-Image 包；h3 → 分镜包）。
  - 知识包 → 触发词命中词库类别时给“可用词条”提示，不自动选词。
  - 写作预设 → 可由知识包模块“另存为预设”（单向导出）。
  - Agent Skill → 可“提取为知识包”（复制文本，不建立运行时依赖）。

## 5. 知识包数据模型（拟）

新增三张表，JSON 字段沿用现有风格：

```sql
CREATE TABLE prompt_knowledge_packs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,           -- skill | knowledge | preset | reference
  source_path TEXT,
  source_hash TEXT NOT NULL,
  version TEXT,
  variant TEXT,
  status TEXT NOT NULL,         -- ready | needs-review | disabled
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE prompt_knowledge_modules (
  id TEXT PRIMARY KEY,
  pack_id TEXT NOT NULL REFERENCES prompt_knowledge_packs(id) ON DELETE CASCADE,
  module_key TEXT NOT NULL,
  title TEXT NOT NULL,
  category TEXT,
  scope TEXT,
  priority TEXT,                -- P0 | P1 | P2
  layer TEXT,                   -- P | S | H
  triggers_json TEXT,
  depends_on_json TEXT,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  tokens INTEGER NOT NULL,
  ord INTEGER NOT NULL
);
CREATE INDEX idx_knowledge_modules_pack ON prompt_knowledge_modules(pack_id, ord);
CREATE UNIQUE INDEX idx_knowledge_modules_key ON prompt_knowledge_modules(pack_id, module_key);
```

选择状态不建表：跟 `PromptOrchestratorWorkspaceState` 增加
`knowledgePackIds: string[]`、`knowledgeModuleIds: string[]`，随 workspace 持久化；
结果 provenance 增加模块 id，供结果面板显示来源。

解析规则：

1. 读 `SKILL.md` frontmatter（name/description/version…）；模块来源优先 `index.md` +
   `知识/`，其次按 `##` 标题切分。
2. 七段骨架映射：Definition/Rules/Quantified Thresholds/Boundaries → P；
   时间码/轴线/shot/转场/音效 → S；LUFS/CPM/预算/拍摄日 → H；其余默认 H（只读）。
3. 尺寸红线：单模块 ≤ 50KB 且 ≤ 6k token；单包模块 ≤ 200；超限拒绝并报“文件/大小”。
4. 去重：`content_hash` 相同只留一份；同 pack 同 module_key 冲突时让用户选。
5. 跳过：`_备份*`、`*.bak`、`agents/`、`tools/` 默认不入库；脚本永不执行。
6. 预算：注入时复用 `resolveSystemPromptLayerBudget`；超限报“需要/可用/超出”，
   不截断、不静默丢模块。

## 6. 分阶段计划

### Phase 0：文档（本次）

- 新增本文件；design.md 增加“第十九轮”索引；implementation.md 增加链接。
- 不改代码、不跑测试。

### Phase 1：P0 正确性（先做，独立可测）

1. 写作层落库：去掉 `slice`，上限提高到与运输上限一致（或 200k 字符）；
   超限明确抛错；补 DB 单测（保存→重开→长度不变）。
2. 补描述按 `box.id` 回填：请求前快照 ids，响应按快照映射；框已删除则跳过；
   assist 期间禁用增删/排序（或允许但结果不覆盖）。
3. 互斥：`canRun`/`run` 增加 `!isAssistingLayout`；`refine`/`reverse` 增加 `!isRunning`；
   UI 按钮同步禁用。
4. 反推覆盖确认：画布非空时弹确认；保存上一版 boxes 支持撤销。
5. 画布持久化：workspace state 增加 `mossLayout`，限制体积；重启恢复。

验收：DB 单测、hook 单测、真实窗口 e2e（并发禁用、错框、覆盖确认、重启恢复）。

### Phase 2：知识包最小闭环

1. shared 类型 + db 三表 + 导入服务（扫描/解析/预览/写入）。
2. IPC：importPreview / importCommit / list / modules / remove；preload 泛型化。
3. Core：`knowledgeModules` 输入 → 预算内拼接到写作层；provenance 记录模块。
4. UI：写作层新增“知识包”来源；选包→选模块→token 计量→超预算提示。
5. 首批导入 Skill-Film、老唐 s9、斯坦尼（各选规范版），生成导入报告。

验收：解析单测（frontmatter/七段/P-S-H/去重/上限）、导入 e2e、真实一次编排并显示来源。

### Phase 3：死代码、布局与交互舒适度

1. 清理：删 `MAX_QUERIES_PER_CALL`、`PromptListView`；`PromptFeedbackDB.list()` 改为
   反馈面板使用（不删功能）。
2. 统一 AI 运行状态条：阶段点 + 首字 + tok/s + 停止；首字前用不确定进度，
   首字后按 token 估算，不伪造百分比。
3. 结果区：完成后自动切到“完整提示词”，对比保留角标；窄窗下 chips 最小宽度与横向滚动，
   不挤压文字。
4. 画布：选中框属性面板固定、键盘微调、撤销/重做、框列表与画布联动。
5. 写作层：分区 chip 带 token、预算条、来源 badge、超限就地提示。
6. 保存：目标文件夹/标签内联选择，记住上次目标。

验收：900/1100/1440 三档真实窗口截图；窄窗 chips 不逐字换行；键盘操作可用。

### Phase 4：编排与其它功能联动

1. 存库：选择文件夹/标签，按内容哈希去重，保存后跳转；版本备注记录 runId。
2. 测试：结果一键送入测试弹窗并写入测试历史；测试评分回写 feedback。
3. Skill 库：只读选择器；“用作知识包”走导入复制，不建立运行时依赖。
4. 生图：结果送入图像生成工作台，带尺寸/参考图/LoRA。
5. 反馈：新增反馈列表/统计视图，读取 `list()`；不自动改词库。
6. 历史/版本：保存生成版本，支持回滚到编排结果。

验收：每条联动一条 e2e；不新增端口/服务/依赖。

### Phase 5：稳定、兼容、流畅

1. 词库 90k 检索：测量 p95；必要时加 FTS/索引，不动 LIKE 语义前先证明缺行。
2. 保留策略：test_runs 每 Prompt 保留最近 N 条；feedback 保留上限；提供清理入口。
3. 取消审计：生图在途请求接入 `requestId` 取消；统一取消登记说明。
4. 内存：删除 Prompt 时清理 AI 状态；map 设上限。
5. 错误：统一错误码/文案；IPC 不把原始异常直接抛给 UI。
6. 兼容：Windows 路径、GB18030、代理、DeepSeek/OpenAI/Gemini 协议回归。
7. 性能预算：搜索 p95、首字、流式帧率、启动不回归。

验收：基准脚本 + 真实窗口；只报告“不新增失败”，基线 6,744/145/44。

## 7. 非目标

- 不引入向量检索/Embedding（未证明 LIKE 缺行前）。
- 不执行任何导入包里的脚本。
- 不把色卡图片整库送模型。
- 不新增端口、后台服务或运行时依赖。
- 不改 prompt/new 源文件（只读导入）。

## 8. 风险

- 32k/57k 写作层落到 SQLite JSON 后体积变大；需确认状态行上限与读写耗时。
- 知识包解析面对 1,931 个 md，格式不统一；首批只保证 3 个规范包，其余报“不可解析”。
- 互斥可能改变现有操作习惯（辅助中不能改结构），需要文案说明。
- 反推确认会增加一步；提供“不再询问”开关需谨慎（默认每次确认）。
- 联动涉及 store/IPC 多处，必须逐条 e2e，避免“保存了但列表不刷新”。

## 9. 当前状态

- P5（云端 DeepSeek 实跑 + 流式/取消）已完成并验证。
- 本文件与 design.md 索引已提交；代码未动。
- 下一步：Phase 1 的 5 个 P0 修复。