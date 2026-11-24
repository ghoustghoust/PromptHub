# 提示词编排助手 · 方向与决策参考

> 参考文档 · 非权威。权威需求与验收见 [design.md](design.md)；实施交接与变更目录见
> [review-handoff.md](review-handoff.md)。
>
> 本文保留方向来源、采用方案与理由、外部评审重要观点、用户已确认约束、实施脉络与当前缺口，
> 供跨会话与接手 agent 阅读，防止上下文与关键观点丢失。本文不新增需求，不替代 design.md；
> 与 design.md 冲突时以 design.md 为准。

## Product

Desktop

## 1. 产品意图（来源：用户）

- 核心目标：**稳定提高产图质量与效率**。用户给一句话需求，系统生成更易被图像模型正确执行的提示词。
- 本地无审核多模态模型接入 PromptHub 既有框架，承担识图、逆推、扩写、润色；本地运行不受云端审核限制。
- ComfyUI 中提示词-底模-LoRA 互相作用且各有可调参数；提示词相对更可控，社区已积累大量多样性方案
  （JSON 排版生图、自然语言生图、专业摄影 prompt）。
- 已收集大量他人提示词插件/组合/随机/扩写/润色方案，但多数**未验证**（有的限制太少、有的质量太低），
  需要整合提炼而非堆砌。
- "潜台词/超级拼装"：把自然语言中的隐含视觉要求展开为模型可执行的具体描述；参考本机 HTML 字段库
  使选词更可控。
- 定位结论：**知识驱动的提示词编排系统**——不是 RAG 知识库，不是万能扩写器，不是外挂/独立 HTML。

## 2. 外部评审重要观点保留（来源：ChatGPT 两份评审）

以下观点为方向依据，标注采纳状态。原文见用户提供的《评审生成图像.md》《评审生成图像 (1).md》。

### 2.1 《评审生成图像.md》

| # | 重要观点 | 采纳状态 |
| --- | --- | --- |
| 1 | 四类知识资产分离：模板/工作流、结构化词库、模型/LoRA 档案、规则/策略。**模板≠词库≠规则** | 采纳：db 词库 + core 规则卡片 + 模型档案 + Skill 生成器 |
| 2 | 词条不是单个词：需分类/功能/适用任务/适用模型/互斥/来源/验证状态 | 采纳：prompt_terms + term_relations + validation_records + source_assets |
| 3 | 词库六种关系：同义/可组合/互斥/前置条件/模型适配/LoRA 关联 | 部分采纳：relation_type 四类；模型适配用 applicable_models；LoRA 用 model_profiles |
| 4 | 插件先知识提取不直接合并：原始保留→提取→标准化→去重关联→质量评估→入库 | 采纳方向：KB 导入 + source_assets 保留来源 |
| 5 | 四种验证状态：待整理/待验证/已验证/已弃用；**社区流传≠已验证；Krea2 有效≠MOSS 有效** | 采纳：validation_status 四态 |
| 6 | 潜台词三层：直接要求(必满足)/合理推导(补视觉条件)/创意补充(标明建议)，三者不可混 | 采纳：fixed/flexible/optional，core 强制 provenance |
| 7 | 多引擎而非万能扩写器：扩写/专业/润色/反推/编辑/随机/JSON/LoRA 八模式 | 采纳八模式；独立引擎边界待裁定 |
| 8 | 受控随机：先定场景约束，再在允许范围内随机 | 采纳：random.subject/setting 锁定 + seed 确定洗牌；类别池约束待加强 |
| 9 | A/B/C 七项评估：意图保留/主体准确/构图准确/细节质量/风格一致/冲突程度/冗余程度；固定生成条件；比质量不比长度 | 采纳为验收方法，尚未执行 |
| 10 | 实施顺序：先资源标准化再引擎；先人工确认后自动化 | 采纳 |
| 11 | 避免两极端：全交给大模型 / 全变词库堆砌 | 采纳为编排路线理由 |

### 2.2 《评审生成图像 (1).md》

| # | 重要观点 | 采纳状态 |
| --- | --- | --- |
| 1 | 第一版不必须 RAG，且不应以 RAG 为核心架构 | 采纳 |
| 2 | 核心任务=生成/组合/约束，不是知识问答；两类任务技术路线不同 | 采纳 |
| 3 | 镜头/光影/构图/人物/服装/姿势/随机组合/JSON模板/扩写/反推/LoRA触发词 均不需 RAG；底模说明/社区研究/历史案例 可选 | 采纳 |
| 4 | SQLite 优于 RAG 六理由：精确选择/过滤不适用模型/互斥组合规则/触发词与权重/验证状态/来源追踪；RAG 可能检索相似但不适用 | 采纳为选词层理由 |
| 5 | RAG 仅后期可插拔，承载社区经验/模型说明等不宜拆原子词条内容；检索结果只作参考不作已验证规则 | 采纳为后期边界 |
| 6 | 个人知识库 vs PromptHub 是两种系统：检索正确信息 vs 选择正确元素并按目标组织 | 采纳为定位 |

## 3. 采用方案与理由

| 方案 | 理由 | 证据/状态 |
| --- | --- | --- |
| LLM + SQLite 结构化词库 + 技能规则 + 模板引擎；RAG 后期可选 | 任务=选对元素并按目标组织，需精确/互斥/适配/可验证（§2.2） | 已实现 |
| 落在既有包边界：db schema/迁移、core 编排/规则/LLM端口、shared 契约、desktop IPC/UI、CLI 入口 | 复用 skill/IPC/设置/导航，避免外挂与第二存储 | 已实现 |
| 三层创造力由 core 强制 provenance，不信任 LLM 自标 | 保留模型创造性，又不把建议当用户要求 | 已实现 |
| 规则卡片压缩（moodyMoss/MOSS/K2 独立卡片） | token 成本与关键差异保留 | 已实现；是否丢原生审美待 A/B/C |
| 本地非审核 Qwen3.5-9B，OpenAI 兼容，关 thinking；识图 ctx8192 + image-max-tokens2048 | 实测格式遵从/三层/质量词抑制通过，单次 2–3s 可实时 | 实测 |
| 显存共存 D8 自动卸载交接（非同时运行） | 8GB 共享；实测卸载释放 6401MiB、重载 ~4.5s | 实测 |
| 人工确认：不自动操作 ComfyUI；Skill 保存需点击 | 先人工后自动化 | 已实现 |
| 排序策略按模型可选（kb semantic_order 与 K2 风格段最前不一致） | 不能硬编码单一顺序 | 设计约束 |

## 4. 用户已确认约束与偏好（跨会话必须遵守）

- 不自动 commit；提交需用户明确指示。git 走代理 127.0.0.1:12000。
- 不饱和显存，留余量；ComfyUI 端口 8288、无界工作台 3000。
- 理解层（spec/knowledge/understanding）只读，不改产品代码与权威 spec。
- 文档用中文自然语言；自有二开方向写意图级，不锁接口（可能大修）。
- 提示词扩写须给**初始+完整改造**成对、不截断；保留模型原生审美；A/B/C 生图对比验证。
- 不自动跑/停/重启批任务；长任务最后阶段不取消。
- LM Studio 已删除，非候选引擎。
- 结果必须在应用内可见；用用户真实文档验证。

## 5. 实施脉络与因果链

每阶段产出是下一阶段输入：

```
理解层(graphify 只读) → 引擎基准/选型 → KB 建库(kb.json) → demo 验证
  → 方向评审(非RAG/编排) → T25 db 词库 → T26 core 编排(接手扩成全垂直切片)
  → [已完成] 编排单测 + 旧库迁移回归（2026-11-20）→ [当前] MTP 复测 + 数据回填
  → A/B/C 七项评估 → 引擎管理 D8 + provider 本地免key + 模型/LoRA 档案 + 评估体系
```

- 基准→引擎配置与模型文件选择；kb.json→词库导入；词库→选词；规则卡片+词库→组合；
  组合→UI/CLI；Skill 生成→技能库；评估→规则/词库 refinement（反馈闭环）。
- 剩余收敛项是可信评估的前置：单测/迁移回归给回归安全网；MTP 复测给正确引擎默认；
  数据回填给生产选词/互斥效果；A/B/C 反过来裁定规则压缩与引擎边界。

## 6. 当前状态与缺口（评审结论）

已验证：desktop 35/35（词库12+transport23）、core 技能生成器 3/3 单测；真实编排/反推/生图/Skill 落盘；
typecheck/eslint/行数门禁达标。R1/R2 收敛测试于 2026-11-20 补齐：core 编排三件套 33/33（v2 契约 7 + 选词与降级 10 + 动态润色 16），legacy 词库迁移 3 例（prompt-vocab-db.test.ts 该文件 23/23，fixture 按 init.ts 真实顺序构造迁移→索引）。core 全量套件中 storage/migration/canonical/plugin 等模块的失败经 stash 基线对照确认在本批改动前即复现（部分为 git init --initial-branch 的环境性失败），与本批无关；编排器与词库相关文件在全量和聚焦运行中均通过。状态建议 `needs-convergence`，不按 completed 关闭。

| # | 严重度 | 缺口 | 补救/验收 |
| --- | --- | --- | --- |
| R1 | Important | 编排器核心逻辑无单测，真实验证不可重复 | 已补（2026-11-20）：`packages/core/tests/prompt-orchestrator-selection.test.ts`（10 例：模式要求/互斥排除/系列与模型过滤/provenance 固定层/降级回退/随机 seed 确定/输入校验）与 `packages/core/tests/prompt-orchestrator-dynamic-polish.test.ts`（16 例：两轮上限/槽位预算/四策略审计/禁查角色画师 NSFW/冲突拒绝/非法决策修复/边界输入）；core 编排三件套 33/33 通过 |
| R2 | Important | 旧库迁移 + series/template 查询无回归 | 已补（2026-11-20）：`apps/desktop/tests/unit/main/prompt-vocab-db.test.ts` 新增 legacy migration 3 例——缺 series/template/domain 列的旧库原位升级保留词条/关系/验证、重复执行幂等（新增 0/更新 0）、升级后 series/template/domain/search/browse 查询回归；fixture 按 init.ts 真实顺序（迁移→索引）构造，该文件 23/23 通过 |
| R3 | Important | MTP 基准矛盾（见下） | 已控制复测（2026-11-21）：同一 MTP 模型长生成 77.2 vs 60.3 t/s = **1.28×**，两轮会话复现；提示词短输出总体 71.4 vs 60.5 = **1.18×**，5/7 逐字一致。旧 1.20× 混淆了模型变体。MTP 必须配 MTP 变体，非 MTP 模型开 MTP 会直接启动失败。协议见 [mtp-retest-protocol.md](mtp-retest-protocol.md)，数字见 benchmark-results.md |
| R4 | Medium | provenance 强制不完整：无 termId 的 LLM 字段仍可标 fixed | 已补（2026-11-21）：`parseField` 对 `layer=fixed` 且无 `termId` 的 LLM 字段降为 `flexible`，rationale 注明降级原因；单测覆盖“无 id 降级 / 有 id 保留 fixed” |
| R5 | Medium | 规则压缩或丢 MOSS 原生审美 | A/B/C 整文 vs 卡片 |
| R6 | Medium | 受控随机仅锁 subject/setting，类别池不限 | 已补（2026-11-22）：随机模式可选词条类别池（默认全选、空池阻断），输入 `categories` 已限制抽取范围；单测覆盖仅抽取指定类别 |
| R7 | Minor | Layout 无确定性编译器/bbox 校验 | 裁定是否 v1 |
| R8 | Minor | 真实 KB series/relations 空，生产互斥/系列效果未证 | 数据回填 |

**MTP 矛盾专段**：design.md 记"MTP 变体 4.6–5.5 t/s、必须非 MTP"；理解层
[benchmark-results.md](../../../knowledge/understanding/ai-provider/benchmark-results.md)
记控制复测"MTP ngl99 中位 68.3 t/s、无 MTP 56.8、1.20×"。两记录冲突；对方 5 t/s 量级与
"ComfyUI 占显存时 5.5 t/s"的共存特征值吻合，疑为混淆测量。按 AGENTS.md 0.3 不静默选边：
需一次控制复测（ComfyUI 卸载、同 flags 含 --spec-type draft-mtp、固定提示 ≥512 token、×3 中位）
统一真值；在此之前不锁定"仅非 MTP"。

## 7. 后续目标与待裁定项

- 待用户裁定：八模式是否必须独立引擎？MOSS Layout 编译器是否第一版硬验收？
- 推进顺序：R3 → 数据回填 → A/B/C → 引擎管理 D8 / provider 本地免key / 模型LoRA档案 / 评估体系。R1/R2 已于 2026-11-20 由回归测试关闭（见 §6）；同日晚些时候建立了真实查询检索评测基线与双检索面评测套件，裁定输入与发现见 [retrieval-evaluation-results.md](retrieval-evaluation-results.md)。
- 完成前保持 `needs-convergence`；A/B/C 与全量回归未执行前不宣称发布验收。
- D8 部分落地（2026-11-21）：本地引擎支持「空闲 N 分钟自动释放」（`/slots` 活动检测，0=关闭）与启动前显存预检（GPU 被其它进程重度占用时拒绝启动并给出提示）。不做“进入生图自动释放”：PromptHub 无法观察外部 ComfyUI 的生图事件。
- D8 续（2026-11-22）：新增模型档案（路径 + 上下文/ngl/MTP 参数，可保存/应用）、GGUF MTP 能力校验（读 `nextn_predict_layers`，不支持时立即拒绝而不是等启动超时）、“释放并打开 ComfyUI”按钮（只打开 URL，不控制对方进程）；本地 provider 空 key 不再被聊天链路拒绝，且不再发送空的 Authorization 头。R6 随机类别池同步关闭（见 §6）。
- P1 类型路由与实体解析（2026-11-22，core 与界面已落地）：新增 `term_aliases` 与精确别名解析、输入分型（实体/触发词/受约束参数/原子标签/长描述/否定/关系）、`lexical|hybrid|entity-only` 三路径、画师按 anima/kaloscope/moss/k2/h3 路由（MOSS 显式画师保留为不带 `@` 的标签）、`targetPipeline` 输入与 `entityResolutions`/`routePlan`/`artistRoutes` 结果载荷；自动选词剔除 artist，单个普通英文词不再锚定角色。隔离库正式回填 7,511 个身份、18,185 条别名、1,817 个歧义键，重跑 0 新增；结果区“实体”页与条件栏管线选择器完成真实 Electron 点击验收（3 张截图）。真实生图、A/B/C 与 91k 实体命中率评测未做，见 design.md 第五轮。
- 工具化检索（2026-11-22，core 已落地）：`resolve_vocabulary` 与 `search_vocabulary` 两个工具，模型自决查询次数与停止时机；Core 只做类别策略、预算、去重、冲突与格式校验。扩写/专业/润色/反推共用一层，最多 4 轮 6 次调用，超限强制定稿；端点无工具能力或循环失败时回退旧路径并写明原因。9 例循环测试 + 4 例传输测试通过；真实模型兼容性与时延未验证。
- 任务感知重排（2026-11-22，core 已落地）：候选加等价/更窄/更宽/相关/相反标签，逆推只留等价、扩写偏好更窄、润色等价优先、相反一律排除；91k 同套件复测 A/B 数字与上一轮一致（28/27/12、28/26/17），顶部关系分布证明标签生效。结论仍是先做深度/预算实验，不接 Embedding。
- P4 全模式统一决策/溯源 + 结果级反馈（2026-11-22，已落地）：结果始终带 `provenance`（词条/实体/画师/约束 × 状态/结果/来源），模型决策 origin=model，其余模式由 Core 推导 origin=policy，策略对照不再只属于润色；新增 `prompt_orchestration_feedback` 表与 `prompt:orchestrator:feedback` 通道，记录可用/不可用、原因与备注及结果快照，不写词条、不改验证状态。真实 Electron 点击与数据库抽查通过；聚合分析与原因区分度未验证。
- P5 功能键耦合与结果回填（2026-11-22，已落地）：条件栏显示跨模式共享摘要（已选/锁定/排除/档案）并明确切换规则卡不清空；结果区可“回填选材台”，按溯源状态并回选中/锁定/参考/排除，锁定与排除不被覆盖、自动未采用不回填，身份与画师行按标签找回存储行。单元 4 例与真实 Electron 两次截图验收通过；离开编排页后内存选区仍会丢失，未做持久化。
- P6 选材台与档案持久化（2026-11-23，已落地）：新增单行 `prompt_orchestrator_state` 保存选中/锁定/排除词条与 `modelId`/`loraIds`，挂载恢复、400ms 防抖保存、损坏行按空状态处理；本机工作区数据，不进同步/备份。真实 Electron 验证页面重载与应用重启均恢复，验收后清空；多窗口并发写与备份纳入未验证。
- P7 反推/引擎修正（2026-11-23，已落地）：反推新图替换旧图并支持清空；带图反推回到单次组合，纯文本仍走工具；工具轮输出预算 2048、最终 4096；视觉请求关闭提示缓存；`--jinja` 进入引擎参数；`moodyMoss` 更正为 MOSS-Image 的写作规则卡并改 UI 标签；外部引擎退出提示。真实应用实测显存充裕时 67–74 t/s、长提示 3.2k token 仍 69–71 t/s；此前 16 t/s 系 mmproj + 显存挤占驱逐提示缓存。流式输出、加载不阻塞、结果回填改写区仅记录未实施。写作方法层方向已记录：规则卡只保留模型语法契约，moody 等写作文档作为系统提示词预设；当前 `systemPromptLayer` 上限 4000 字符，预设库与导入未实施。
- P8 上下文档位（2026-11-23，已落地）：8K/32K/64K 固定档位；32K 起 q4 KV + `--no-kv-offload`，8K 保持 q8 显存 KV。切换前估算、卸载、复查空闲显存，启动失败恢复上一档；设置页与编排页共用档位控件，检测到系统提示词时提示 32K。隔离真实应用 8K→32K→64K→8K 切换成功，命令行确认参数；256K 在 8 GB 卡实测不可用，不进入档位。2026-11-24 追加 32K+mmproj 真实加载与反推：预检 6,500 MiB、实际引擎约 6,414 MiB，视觉请求 907 prompt token、首字 9.46 秒、75 token、16.2 t/s；64K+mmproj 预检拒绝且旧 32K 引擎未被卸载。

## 8. 第四轮用户确认补充（2026-11-19）

- “词库预制菜”改称“词条选材”；普通窗口下主按钮不能被挤成两行，选材、已选摘要与主操作需要独立可见空间。
- 选材界面参考图 2 的多字段池与本地两份生成器的内容密度，支持写实、3D、2.5D、动漫素材包及动漫可选画师词组；Agent 在用户选择后组织与优化，不擅自覆盖。
- 参考项目只提供待审核的标签、分类、角色和预设。原始自动翻译与大型画师表不能全量盲导，首批偏动漫，写实/写真后续整理；不迁移 HTML、EXE、代理或 localStorage。
- MOSS 另增电商/海报主题。海报布局参考 ComfyUI 官方 Create Bounding Boxes 语义，但必须做成 PromptHub 原生编辑与确定性 Layout 编译校验，不做插件、独立 HTML 或新增端口。
- 已认可并保存的 Prompt 可拆解为预设/词条，但属于独立的提示词库知识沉淀模块，不在编排助手中自动写回全局词库。
- 上述为新增待实施范围，不改变原生扩展、规则隔离、Token 只观察、三层来源、右侧左右对照、系统提示词层和存库/收藏等既有决定。

## 9. 真源与关联

- 权威需求与验收：[design.md](design.md)
- 本轮补充需求：[润色 · 动态检索与四策略对照](polish-dynamic-retrieval-requirements.md)
- 人工驱动补充需求：[词条四态与决策溯源](human-led-term-states-requirements.md)
- 检索评测基线与裁定输入：[retrieval-evaluation-results.md](retrieval-evaluation-results.md)
- MTP 控制复测协议：[mtp-retest-protocol.md](mtp-retest-protocol.md)
- A/B/C 出图对照协议：[abc-image-comparison-protocol.md](abc-image-comparison-protocol.md)
- 实施交接与变更目录：[review-handoff.md](review-handoff.md)
- 本机实测（派生·非权威）：[benchmark-results.md](../../../knowledge/understanding/ai-provider/benchmark-results.md)
- 只读理解层：[spec/knowledge/understanding/](../../../knowledge/understanding/)
- 本文：方向与决策参考，非权威，不新增需求。