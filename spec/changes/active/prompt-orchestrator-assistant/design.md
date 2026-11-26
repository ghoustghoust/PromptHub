# 提示词编排助手（PromptHub 内置能力）

## Product

Desktop

## 状态

review-pending。主链路已实现；未完成项与未验证项统一见 [implementation.md](implementation.md)。
本文只保留现行需求、契约与边界，实施流水、测试数字与截图路径以 Git 历史为准。

## 目的与定位

PromptHub 从“提示词管理工具”扩展为**知识驱动的提示词编排系统**。用户只给一句话意图，
或主动挑选词条与预设；系统结合任务、规则卡、知识模块、参考素材与创作偏好，从结构化词库
精确选材，组织成更易被目标模型正确执行的提示词。

- **不是 RAG**：任务不是从文档找答案，而是选对元素并按目标组织；RAG 只作为后期可插拔模块。
- **不是外挂**：不新增独立 HTML、插件、外部端口或第二套模型配置。
- **只产出文本**：图片与视频由外部模型工具生成，提示词助手不冒充媒体生成能力。

链路固定为 `React → preload → main IPC → packages/core → packages/db / 已配置 chat 模型`。

## 产品边界

- 不做 RAG、向量索引、全库向量化；是否接 Embedding 由真实查询集证明漏召回后再定。
- 不自动操作 ComfyUI，不做 LLM ↔ ComfyUI 自动显存交接；不自动执行导入包内的脚本。
- 不自动识别或推断角色、画师；不因外观相似加载角色属性，不自动注入画师名与风格参数。
- 色卡图片不整库送模型；社区收录不等于已验证。
- 底模/LoRA 搭配统计不在当前范围，LoRA 仅在确有专用激活词时作为可选约束。

## 五层职责（互不合并，只做软引用）

| 层 | 职责 | 生效方式 |
| --- | --- | --- |
| 规则卡 | 输出语法：Caption / Tags / Layout | 决定输出契约，不承载知识 |
| Skill | 执行契约、流程、模式、输出格式 | 选中即整包生效，不可拆成知识条目 |
| 知识库 | 可复用方法论（P/S/H 分层） | 受 token 预算，按模块勾选 |
| 参考库 | 色卡、导演风格等素材 | 按标签检索，限量注入 |
| 词库 | `prompt_terms` 候选词条 | 只给候选，不并入知识包 |

层间只用声明式软引用 `uses / recommends / depends_on / derivedFrom`；目标缺失只警告
“依赖未导入”，不复制正文、不自动拉包、不建硬依赖；合成时按 `content_hash` 去重。

## 已确认契约

### 任务、输出与适配

- 图片任务：扩写、专业编排、润色、反推、编辑、受控随机。JSON 是可选结构化载荷，LoRA 是
  高级适配约束，都不再冒充独立任务模式。
- 视频任务：MiniMax-H3 的文生视频、首尾帧、多参、长视频、短剧 Agent 系统 Prompt 与
  实验性卡点；只生成提示词文本，不生成视频。短剧产出的是系统 Prompt，不是单条提示词。
- 规则卡先选、任务后显：H3 只出现视频任务；MOSS 保留 Caption/Tags/Layout；Krea 2 只有
  Caption。Qwen-Image 2.1 本轮不接。
- 受控随机 = 先定场景约束（`subject` / `setting` / 类别池）再在允许范围内随机，seed 确定；
  空类别池阻断运行。

### 三层创造力

直接要求（必满足）/ 合理推导（可说明依据）/ 创意补充（必须标明是建议）三层不可简化，
由 core 强制 provenance，不信任 LLM 自标：

- 用户显式锁定的词条为 `fixed`；自动选词与推导为 `flexible`；创意建议为 `optional`。
- LLM 字段标 `fixed` 但无 `termId` 时降为 `flexible`，并写明降级原因。
- 自动候选被模型标成用户固定要求时，core 按 provenance 纠正。

### 引导方式与词条四态

引导方式为**编排主导**下的“意图驱动 · 自动编排”与“词条驱动 · 人工定稿”，内部枚举
`agent-led / human-led` 保持不变以兼容 CLI 与既有记录。

人工选词四态（同一词只有一种状态）：

| 状态 | 含义 | 进入提示词 |
| --- | --- | --- |
| 锁定 | 必须逐字保留 | 固定字段，措辞不可改写 |
| 推荐 | 概念要出现，措辞可调 | 固定字段，允许模型改写 |
| 参考 | 只是可用材料 | 仅提供给模型，可复用/借鉴/弃用 |
| 排除 | 本轮不得使用 | 不进入任何列表，模型引用也被拒 |

规则：新选入默认**推荐**；排除优先并产生可读警告；参考不消耗自动词库预算；排除词不参与
“写入选中框”。四态只作用于人工驱动，不改变意图驱动的自动检索与动态润色规则。

### 选材台与结果界面

- 选材台按“一级字段 → 二级分类 → 词条”浏览，词条网格最小 260px，不逐字换行；已选清单、
  锁定、清空、搜索与系列过滤常驻；分类与已选区独立滚动。
- 素材包是现有 `category + subcategory` 的投影，少于 3 条真实命中不渲染；预设取自
  `PG_PRESETS` 26 组，命中不足 6 条整组隐藏；匹配统一走 `resolveTermKey`。词库没有的
  类别不造入口（如不设 2.5D 包）。
- 宽屏三栏“条件栏｜工作区｜结果栏”；结果栏独立、宽 440–640px 可拖；普通窗口改为覆盖式
  抽屉，仍保留左右对照入口。主操作“开始编排”保持单行，不被挤压。
- 结果为左右逐句对照，句级对齐用确定性算法（`prompt-alignment`），不依赖 LLM；未配对句
  标“新增”。结果栏可存库/收藏（`source=prompt-orchestrator`）。
- 系统提示词层（`systemPromptLayer`）作为附加系统指令参与组合，不原样写入最终提示词，
  不覆盖规则卡与用户固定事实。

### 词库与题材域

- `prompt_terms` 承载词条、关系、模型档案、验证记录与来源；`series` 与 `template` 支持
  系列化与长句模板，旧库幂等补列。
- 题材域 `domain`：`shared | anime | real | 3d`；选具体域时同时返回 `shared`。
- 画师只存在于 `artist`（域 `anime`），不进入自动选词文本，不混入真人词条。
- NSFW 为独立分类，保留二级导航与 domain；同词只保留一条可见记录，其余标 `deprecated`。
- 全量浏览走 `browseTerms`：每页 1–200 条、稳定 `en + id` 排序、返回真实总数与分类计数；
  中文状态区分“暂无中文 / 原名 / 中文原文”，不做伪翻译。
- 翻译任务只读导出，排除 `artist`；回传必须先预检（ID、原文、分类、原中文、非废弃），
  单事务只更新 `zh`，冲突全量回滚。

### 检索与实体解析

- 命名实体走精确/别名解析（`term_aliases` + 归一化键），不做模糊、前缀或向量相似度；
  歧义返回候选并标注，不阻塞主流程。纯身份/参数输入走 `entity-only`（0 轮 0 查询）。
- 普通词守卫：不带引号、`@`、系列限定或中文的单个英文词不锚定角色身份。
- 画师按目标管线路由：Anima 输出 `@artist`；Kaloscope 只给节点参数（`artist_name` /
  `bank` / `style_guidance` / `adapter_strength`，底模须 MOSS-Image Base）；Krea2/H3 不写
  画师；MOSS 下用户显式画师保留为不带 `@` 的标签。
- 检索工具化：`resolve_vocabulary` 与 `search_vocabulary`，模型自决查什么、查几次、何时停；
  最多 4 个助手轮次、6 次工具调用，超限强制定稿。Core 只做类别策略、预算、去重、冲突与
  格式校验；零调用、无匹配、整段不用词库都是合法结果。
- 禁查类别：`artist` / `character` / `nsfw` 不进入自动检索（用户显式选择除外）。
- 关系标签（等价/更窄/更宽/相关/相反）与任务策略：逆推只接受等价；扩写偏好更窄；润色
  等价优先；相反在四种文本任务中一律排除。反义表只挡明显反向项。
- 词法检索在表达级已足够；单词片段的 top6 可见度是竞争问题而非漏召回，因此**暂不接
  Embedding 与重排序**，后续提升先做深度/预算的程序化 A/B。

### 精确排版画布

- 与“词条驱动 · 人工定稿”正交；在工作区为独立标签“版面画布”，与“词条选材”并列，
  切换标签不丢选词、框选与画布状态。
- 支持 1:1、2:3、3:2、4:3、3:4、16:9、9:16、21:9、9:21 九种比例与自定义 16 倍数尺寸；
  拖框、移动、缩放、删除、排序；`object / text` 类型；精确多行文字；角色框标记。
- 编辑坐标为 0–1000 归一化 `yxyx`；由 core 确定性编译为中心原点 `abs_centralized`
  绝对像素（最小边 floor、最大边 ceil），角色框单独输出 `characterBoxes`。
- LLM 只优化整体与逐框描述，不得改坐标、顺序、类型与精确文字；初始与最终 JSON 都走
  编译器，失败时返回明确 degraded 的有效 Layout。
- 逐框描述可留空（由助手补齐），精确文字仍是硬要求；从海报反推布局时坐标归一化，
  不确定字符标 `needsReview`，无法识别时返回空草稿且不覆盖画布。
- 画布默认 0 个框；新框按数量右下阶梯偏移 24 归一化单位（最多 8 档）防重叠；“清空画布”
  需确认并同时丢弃反推撤销快照；辅助/运行期间禁用结构编辑。
- 布局门槛：画布边长为 16 的倍数、至少一个框、文本框有精确文案、整体描述非空。

### 写作层与预算

- 写作层可为手写/提示词库载入文本，或写作预设的章节组合；预设支持压缩版/原文、章节勾选、
  行内编辑与导入（.txt/.md/.htm/.html，UTF-8/UTF-16/GB18030，≤8MB）。
- 预算由 `resolveSystemPromptLayerBudget` 统一计算：上下文扣除输出预留、规则卡与契约、
  词库预算、用户输入、图片占位与安全余量。8K 约 2,061 token，32K 约 25.6k，64K 约 57.1k。
  本地引擎运行时锁定引擎档位，云端必须显式选档。
- 超限抛 `SYSTEM_PROMPT_LAYER_OVER_BUDGET`（需要/可用/超出），运输层另设 60,000 字符硬上限
  （`MAX_WRITING_LAYER_CHARS`）；任何情况下不截断、不静默丢模块。UI 超限显示红色并阻塞启动。
- 结果带 `systemPromptLayerMetrics`（tokens/budget/context/outputReserve/contract/safety/
  presetId/referenceTokens），供结果面板计量显示。

### 知识包

- 两张表：`prompt_knowledge_packs`、`prompt_knowledge_modules`；模块含
  `module_key/title/priority/layer/triggers/depends_on/content_hash/tokens/ord/role/groups`，
  包级 `links_json` 存软引用。同一 `sourcePath` 重导入走事务内整包替换，不堆版本。
- 解析：`SKILL.md` frontmatter 优先；模块来源依次为 `知识/` 逐文件 → `index.md` 的 `##` 段
  → `SKILL.md` 的 `##` 段 → 整篇 overview；`##` 切分跳过代码围栏。
- 跳过：`_备份`、`*.bak`、`agents/`、`tools/`、`源/`（原始全文副本）、脚本与非 Markdown；
  单模块 ≤50KB 且 ≤6k token，单包 ≤200 模块，超限拒绝并说明原因。
- 提交前重扫 `sourcePath` 并按 `contentHash` 校验，源文件变动即拒绝；renderer 不能替换正文。
- `role`：`contract`（随包常开、不可勾选）、`knowledge`（进入写作层勾选）、`reference`
  （走独立参考选择器）。分类命中“版本/适用范围/读取顺序/执行入口/铁律/红线/输出格式/
  公共坐标/执行流程/校验清单…”归 contract；色卡/导演风格归 reference；其余 knowledge。
- contract 分组：`script / storyboard / novel`；含分组的包必须选择项目类型，未选阻断运行。
- 模块与写作层共用同一 token 预算与 60,000 字符上限；超限报错不截断。provenance 每模块
  一条 `module:<id>`（locked / injected）。

### 参考库（导演色卡）

- 源为 `色卡-资料包/directorStyleLibrary`，存元数据与源路径，图片留在只读源目录；缩略图压
  320px JPEG 存应用 images 目录，DB 只存文件名（`local-image://` 白名单限制）。
- `prompt_reference_items` 按 `source_path` 替换写入；每轮最多选 3 个，选择存 workspace
  `referenceItemIds`。
- 注入为 system 中独立 “Visual style references” 块，只作色调/光线/构图方向，不整段引用、
  不用导演名堆 prompt；不进入写作层 P/S/H 文本。
- 参考 token 作为独立固定成本 `referenceTokens` 从上下文扣除，写作层预算相应减少；
  provenance 每条 `reference:<id>`（locked / injected）。

### 决策、溯源与反馈

- 结果始终带 `provenance`：词条、实体、画师、约束、知识模块与参考各一行，字段为
  `kind / state / outcome / excerpt / origin`（来源：用户/模型/规则）。
- 有模型决策时 `origin=model`；无模型决策的模式由 core 推导 `origin=policy`，不把规则
  推导冒充模型判断。结果区溯源表只读，不提供自动回写。
- 结果可“回填选材台”：锁定→锁定、参考→参考、排除→排除、自动采用/已解析身份→推荐；
  已存在的锁定/排除不被覆盖，自动未采用不回填。
- 结果级反馈写入 `prompt_orchestration_feedback`（评分、原因、备注、输入/结果摘要与
  `snapshot_json`），快照不含参考图与 Layout 大对象；不写词条、不改验证状态。

### 持久化与可移植

- `prompt_orchestrator_state` 单行 `id='default'`：选中/锁定/参考/排除词条、`modelId`、
  `loraIds`、`systemLayerText`、`mossLayout`、`knowledgePackIds`、`knowledgeModuleIds`、
  `knowledgeContractGroup`、`referenceItemIds`；上限 4MB / 2,000 词条，损坏行按空状态处理。
- 挂载恢复一次，恢复完成前不写库；变更 400ms 防抖保存。该状态是本机工作区数据，
  不进入设置同步、备份或跨设备同步。
- 写作预设支持本地可移植包（`{version:1, exportedAt, presets[]}`，仅用户预设），
  导入事务化创建副本；选择性导出/自建同步/云端同步携带预设需另开任务（含服务端）。

### 引擎与上下文

- **必须使用非 MTP 权重**：同量化下 MTP 变体仅 4.6–5.5 tok/s，标准 IQ4_XS 约 60 tok/s，
  带 `-MTP-` 的文件不用于常规生成。
- 必须关闭 thinking（`-rea off` 或请求侧 `reasoning-budget 0`），否则 `content` 为空。
- OpenAI 兼容端点 `127.0.0.1:8080`；仅 loopback 允许无 Key 生图。
- 视觉请求 `ctx 8192` + `--image-max-tokens 2048`（默认约 3800 token 会导致输出被截断）。
- 上下文档位 8K / 32K / 64K：8K 用 q8 KV 驻显存；32K/64K 用 q4 KV + `--no-kv-offload`。
  切换流程为容量预检 → 卸载 → 复查空闲显存 → 保存并启动 → 失败回滚上一档；
  8 GB 卡上 64K + mmproj 会被预检拒绝。
- 引擎只绑定 `127.0.0.1`，以 `shell:false` 参数数组启动；只结束 PromptHub 自有进程，
  外部引擎卸载需二次确认且进程名含 `llama`。
- 取消：主进程按 `runId` / 通用 `requestId` 保存 `AbortController`；缓冲与 SSE 都合并超时
  与取消信号，取消抛 `CANCELLED`，**不降级**为确定性回退；停止后保留已生成部分结果。
- 流式只发生在最终轮（`tool_choice=none`）；工具轮必须整包以取得完整 `tool_calls`。
  结构进度只统计已出现的顶层字段，不显示伪造百分比。
- 云端与本地共用现有 chat 模型设置；不新建第二套 provider 配置。

## 进行中设计：prompt/new 整合（待确认）

- 不新增与提示词助手并列的“大纲”产品板块；大纲、剧本、分镜是可保存、可版本化、可作为
  后续输入的中间文本，但不扩张为独立剧本平台。
- “流程方案”描述多步文本任务的输入、产出、顺序、依赖与确认点；普通生成、润色、反推
  仍为单步，只有所选方法确有需要才展开多步。
- 所有步骤只产出文本；面向外部 Agent 的完整 Skill 与应用原生流程方案属于不同运行合同，
  资料归属、适配方式与排除范围待逐项确定。
- 第二十二、二十五轮形成的“Skill 扁平拆分为知识包、contract 随包常开”方向进入重评，
  不再作为唯一既定路线；现有实现、数据与 UI 的保留/迁移/撤回范围待整合设计确认。

## 已知缺口

- 生图 A/B/C 出图对照尚未执行；知识包与色卡对成稿质量的影响由用户判断，不宣称已验证。
- 云端端点的流式、取消与 `include_usage` 未实测；需要代理的网络环境未验证。
- 8K + mmproj 反推的上下文余量未实测；64K + mmproj 已被预检拒绝。
- 91k 词库上的实体解析命中率未统计；真实 KB 的 `series` / `term_relations` 仍偏空。
- 图片反推弹窗的“停止”未用视觉模型真实点击；生图在途请求尚未接入取消。
- 反馈只有写入与单条展示，聚合视图与统计口径未做；测试历史无保留策略。
- 结果面板未提供跳转到知识包/模块正文的入口；“另存为写作预设”未做。
- 90k 检索 p95 未测；窄窗交互（chips 与多列溯源表）待真实窗口验收。

## 评估口径

A/B/C 三版对比：A 原始输入、B 普通大模型扩写、C 编排结果。固定底模、LoRA、采样器、
步数、CFG、分辨率与种子，按意图保留、主体准确、构图准确、细节质量、风格一致、冲突程度、
冗余程度七项分评；比较同等成本下的结果质量，不比较长度。样本量小，结论不外推。

## 关联

- 未完成项、阻塞与验证边界：[implementation.md](implementation.md)
- 设计来源（引擎选型与 AI 接入）：[component-understanding-kb](../component-understanding-kb/)
