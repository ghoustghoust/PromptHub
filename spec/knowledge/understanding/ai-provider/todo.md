# AI Provider / 模型接入 · 待办清单（todo）

> **派生 · 非权威 · 引用权威主题。** 本文是二开理解层的派生清单，**不构成需求、不另立权威**。任何要落地的项都应按 [文档路由规则](../../../rules/document-routing-rules.md) 归并到权威主题或 `spec/issues` / `spec/changes`，本文只做"带证据的理解层待办视图"。
> 权威基线：[AI provider API 矩阵](../../reference/ai-provider-apis.md) · [系统规范](../../context/system.md) · [桌面行为](../../behavior/desktop.md)。
> 现状输入：[flow.md](flow.md)（Task 3，已逐节点核对）、[architecture.md](architecture.md)（Task 4，现状 + 引擎选型 + 二开方向）。设计依据：[component-understanding-kb 设计](../../../changes/active/component-understanding-kb/design.md)（"文档语言与抽象层级"节）。
> 证据基线：main @ `7e69e6f7` 工作区；下列每条 `文件:行号` 均经本会话直接读码核对。
> 引擎调研更新（2026-11-16）：architecture.md 第二部分已按调研报告（`C:/Users/ghous/AppData/Local/Temp/prompthub-local-engine-research/report.md`，下称 [R0]）+ Qwen 官方模型卡 [R1] + llama.cpp 上游代码 [R2] 更新（含混合架构纠正，[R#] 来源编号见 architecture.md §2.3）。**LM Studio 已被用户删除，不再是候选引擎**。用户新增四条约束已转为 D7–D10（意图级）。

## 0. 读法与边界

- **分类**：`优化`（现状不一致/局限，可改进）、`修复`（潜在正确性问题，需评估确认）、`二开改动点`（服务"接入本地 Qwen3.5-9B GGUF"目标的方向）。
- **优先级**：`高` / `中` / `低`，按对二开目标与现状稳定性的影响排序。
- **抽象层级**（design 约定）：
  - **现状债务（优化/修复）** 是他人成熟代码的照实记录，**可含具体接口/行号**。
  - **二开改动点只写方向与目标，不预设代码接口、函数签名、参数名或上下级调用结构**；引用现状证据仅作依据，不代表提议的实现。落到具体接口是实施阶段的事。
- **划界（architecture.md §3.4）**：本文把"现状债务"（第 1/2 节）与"本地接入二开改动点"（第 3 节）**分开**。协议推断双实现、两条聊天路径代理差异等是**独立现状债务**，**不与本地接入目标捆绑**；本地接入方向只在需要时引用它们作现状依据。
- **不另造平行清单**：已有 `spec/issues` / `spec/changes` 相关项一律在第 5 节**引用合并**，本文不重复立项、不改其状态。
- **范围**：本文主体是 **AI 模型 provider 线**（PromptHub 自己的聊天测试/改写/翻译/Skill 安全扫描/规则重写）。`agent-qwen-definition.ipc.ts`、`agent-model-*`、`agent-provider-*` 属 **coding-agent 平台适配线**（P1），**非**本地 GGUF 推理接入点（[flow.md](flow.md) §0）。

---

## 1. 现状债务 · 优化

> 现有实现的不一致/局限，独立于本地接入即可评估改进。可含具体接口/行号。

### O1 · 两条聊天路径超时语义不一致（core 写死 300s 不可按调用覆盖）

- **分类**：优化 ｜ **优先级**：中
- **证据**：
  - 统一 deadline `AI_REQUEST_TIMEOUT_MS = 300_000`：`packages/shared/constants/ai.ts:2`。
  - core 路径写死、不接受调用方覆盖：`packages/core/src/ai-client.ts:130`（`timeoutMs: AI_REQUEST_TIMEOUT_MS`）；transport 用该值 `setTimeout → controller.abort()`：`ai-client.ts:31-32`、`finally clearTimeout :47-49`。
  - renderer 路径可按调用覆盖：`apps/desktop/src/renderer/services/ai.ts:104`（`options?.timeoutMs ?? AI_REQUEST_TIMEOUT_MS`）。
  - main 通用 transport 接受正值覆盖、否则回退 300s：`apps/desktop/src/main/ipc/ai.ipc.ts:134-137`。
- **简述**：同一产品里 core 后台 AI（规则重写/Skill 安全扫描）超时不可调，renderer 交互式聊天可调。本地长推理（思考模式、冷加载、长上下文）可能逼近或超过 300s，core 路径会被云端假设的时限误杀。**这是现状不一致债务**；"让超时/流式/取消语义配合本地实际耗时"的二开方向见 D2（意图级），两者不捆绑。

### O2 · 两条聊天路径网络代理行为不一致（core 裸 fetch 在 system 模式不走 Chromium 代理）

- **分类**：优化 ｜ **优先级**：中
- **证据**：
  - 路径 A（renderer→main）经 `fetchWithNetworkProxy`，system 模式走 Chromium `session.defaultSession.fetch`：`apps/desktop/src/main/services/network-proxy.ts:404-409`；调用点 `ai.ipc.ts:144`。
  - 路径 B（main 内 core `chatCompletion`）用自带 `requestWithFetch`（**裸 fetch**）：`packages/core/src/ai-client.ts:30-50`（`fetch(request.url, …) :34-39`），**不经过 ai.ipc.ts**。
  - 仅 manual 模式经 `applyGlobalFetch` 替换 `globalThis.fetch` 才让裸 fetch 间接获得代理：`network-proxy.ts:432-439`（`settings.mode === "manual" :433`）。
- **简述**：system 代理模式下，交互式聊天走 Chromium 代理、后台 AI 功能的裸 fetch 不走，两条路径网络行为不一致。**architecture.md §3.4 明确：此为独立现状债务，不与本地接入捆绑。** 本地端点是否受代理误伤见 O3 与 D3。

### O3 · 本地回环地址无自动代理 bypass（仅按用户配置 bypass 列表匹配）

- **分类**：优化 ｜ **优先级**：中
- **证据**：
  - bypass 判定纯按用户配置规则匹配，无自动回环放行：`packages/shared/utils/network-proxy.ts:129-153`（`shouldBypassProxyForHostname`）；其中 `<local>` 的规则是 `!normalizedHost.includes('.')`（`:139-141`）——覆盖 `localhost` 与一切不含点的主机名（**含 `::1` 及 `[::1]` 形式**），**不覆盖 `127.0.0.1`**（含点）。
  - manual 模式按该判定决定是否走代理：`apps/desktop/src/main/services/network-proxy.ts:101-111`（`getManualProxyUrlForTarget`）；manual（`fixed_servers`）分支的 Chromium bypass 取用户配置：`network-proxy.ts:472-476`（`proxyBypassRules: settings.bypass`）。
  - system 模式仅 `setProxy({ mode: "system" })`（`network-proxy.ts:461-463`），Chromium bypass 来自 **OS 代理配置**，`settings.bypass` 不参与；`settings.bypass` 写入 `NO_PROXY` 的 `:97-98` 仅在 manual 分支执行（system 模式在 `:80-85` 恢复原始环境变量后提前返回），且 `NO_PROXY` 不影响 Chromium `session.fetch`。
- **简述**：manual 模式下，若用户开了代理且 bypass 未含 `127.0.0.1`（`<local>` 不覆盖该形式），指向 `127.0.0.1:<port>` 的本地引擎请求可能被路由进代理而非直连；`localhost`/`::1` 形式在配置了 `<local>` 时即可放行，风险面仅限 `127.0.0.1` 这类含点回环写法。system 模式下回环是否被误路由**取决于 OS 代理 bypass 配置**（以及 Chromium 对回环的隐式 bypass 行为，仓库代码无法证明，未取证，见第 6 节开放问题，不下断言）。这是现状代理逻辑的局限（对本地接入有影响，但属代理边界债务）。本地端点放行的二开方向见 D3（意图级）。

---

## 2. 现状债务 · 修复 / 评估

> 潜在正确性问题，需先评估确认再决定是否立项；不预设结论。

### F1 · 协议推断双实现并存（core 子串匹配 vs shared 全等匹配，别名覆盖不同）

- **分类**：修复（潜在不一致，**需评估**，非已确认缺陷）｜ **优先级**：中
- **证据**：
  - core `normalizeProtocol`：`packages/core/src/ai-config.ts:104-134`，provider/URL **子串**匹配，含 `claude`（`:121`）/`google`（`:128`）别名，兜底 openai（`:133`）；用于**配置归一化**（`normalizeProviderConfig:164`、`normalizeModelConfig:183`）。
  - shared `resolveAIProtocol`：`packages/shared/utils/ai-protocol.ts:23-45`，provider **全等**匹配 `anthropic`/`google`/`gemini`（`:34`、`:38-39`）或官方域名，兜底 openai（`:44`）；用于**运行时聊天**（`ai-client.ts:124`、renderer `ai.ts:100`）。
- **简述与评估要点**：
  - 两份推断兜底都是 openai，但别名覆盖不同（如 provider 名含 `claude`/`google` 子串时 core 判 anthropic/gemini，shared 全等不中则落 openai）。
  - **实际分歧面有限**：core 归一化会把结果写入显式 `apiProtocol` 字段（`ai-config.ts:164/183`），运行时 `resolveAIProtocol` 优先采用显式枚举（`ai-protocol.ts:24-30`）。因此只有**未经 core 归一化、apiProtocol 缺省**的配置（如直接传入的 `SafetyScanAIConfig` 或 UI 侧 config）才可能触发两份推断分歧。是否构成真实缺陷需按此路径取证确认。
  - **对 localhost/自定义端点两者都无特殊分支，一律落 openai 兜底**（`ai-config.ts:133`、`ai-protocol.ts:44`）——这恰是本地 OpenAI 兼容端点能自然接入的现状基础（architecture.md §1.3/§1.5），**不是缺陷**。
  - **收敛须对齐权威方向**：`spec/changes/active/agent-provider-protocol-bridge/` 正在定义 canonical 协议身份（OpenAI Chat / OpenAI Responses / Anthropic Messages / Google Generative AI，见第 5 节）。若收敛双实现，应与该 canonical 方向一致，**不另造竞争实现**。**architecture.md §3.4：此为独立现状债务，不与本地接入捆绑。**

---

## 3. 本地接入 · 二开改动点（意图级 · 不锁接口）

> 服务 architecture.md §3.1 目标：让 PromptHub 自己的 AI 功能用上本机引擎加载的 Qwen3.5-9B IQ4_XS GGUF，完全离线、流畅、稳定、在留余量约束下尽可能最优，且引擎可替换。
> **本节只写方向、目标、约束与取舍，不预设代码接口/函数签名/参数名/上下级调用结构。** 引用的现状证据仅作依据，不代表提议实现。引擎选型与硬件适配依据见 architecture.md 第二部分（日常首选 llama.cpp，长上下文首选 KVMem；LM Studio 已被用户删除，不再是候选）。D7–D10 来自用户新增约束（architecture.md §3.3"用户新增约束"节）。

### D1 · 决策：是否让"本地/免 key provider"免填 apiKey

- **分类**：二开改动点 ｜ **优先级**：高
- **现状依据**：core 与 renderer 聊天入口都强制非空 apiKey，缺失即抛错——`packages/core/src/ai-client.ts:120`、`apps/desktop/src/renderer/services/ai.ts:106-108`。但本地引擎通常不校验 key、**接受任意非空占位 key**（architecture.md §1.5 + 第二部分 [S11][S20][S25][S26]），故现状是**可绕过的 UX 摩擦**（填占位值即可通过），**非硬阻断**。
- **方向与目标**：让"本地/免 key provider"能被自然配置、无需用户手填占位 key；**同时不削弱云端 provider 的 key 要求**——两者要能区分对待，而非一刀切放开或一刀切强制。
- **约束/取舍**：如何在配置与校验上区分"本地免 key"与"云端强制 key"，既满足本地易用又不削弱云端安全，是**实施决策**（architecture.md §3.5 开放问题），本文不预设接口。

### D2 · 方向：超时/流式/取消语义配合本地长推理

- **分类**：二开改动点 ｜ **优先级**：高
- **现状依据**：固定 300s deadline（`packages/shared/constants/ai.ts:2`），core 路径不可按调用覆盖（`ai-client.ts:130`），renderer 可覆盖（`ai.ts:104`）；core 客户端恒非流式（`ai-client.ts:76`）。详见 O1。
- **方向与目标**：让本地请求的超时/流式/取消语义能配合本地推理的实际耗时（思考模式、冷加载、长上下文可能逼近或超过现状时限），不被云端假设的时限误杀；并让用户能感知/中断长推理。
- **约束/取舍**：具体如何提供可配置时限、是否让后台 AI 路径也支持流式/取消，是实施决策。**与 O1 的现状一致性收敛是两件事**：O1 是独立债务，本项是本地适配方向，不互相捆绑。

### D3 · 方向：本地回环端点在代理/SSRF/CORS 边界被正确放行，且两条路径行为一致

- **分类**：二开改动点 ｜ **优先级**：高
- **现状依据（已读码取证，见第 4 节取证结论）**：
  - AI provider 聊天线**无 SSRF/主机名校验**：`apps/desktop/src/main/ipc/ai.ipc.ts:129-154`（`performRequest` 仅 multipart 校验 + `fetchWithNetworkProxy`，无地址拦截）；core 裸 fetch 同样无校验（`ai-client.ts:30-50`）。→ 本地回环端点在聊天线**不会被 SSRF 防护阻断**。
  - manual 模式代理 bypass 仅按用户配置，`<local>` 覆盖 `localhost`/`::1` 等不含点主机名、不覆盖 `127.0.0.1`（O3，`shared/utils/network-proxy.ts:129-153`）；system 模式 Chromium bypass 取决于 OS 代理配置（`network-proxy.ts:461-463`），回环是否被误路由未取证（第 6 节开放问题）；system 模式两条路径代理行为不一致（O2，`network-proxy.ts:404-409/432-439`）。
  - 对照：coding-agent 连通性探测线**显式放行回环**（`apps/desktop/src/main/services/agent-provider-connectivity.ts:56-64` `isLoopbackHost`、`:100-117` 回环跳过 `isBlockedHostname`/`isPrivateAddress` 且仅回环允许 http）——说明仓库已有"回环放行"先例，但**不在聊天线**。
- **方向与目标**：确保指向本机回环的本地引擎端点在系统代理、SSRF 防护、CORS 等边界上被正确放行、直连而非被代理误路由；并让两条聊天路径对本地端点行为一致。
- **约束/取舍**：具体放行策略（是否自动 bypass 回环、是否给聊天线引入与探测线一致的回环判定、CORS 如何处理）是**实施决策**（architecture.md §3.3/§3.5），本文不预设接口。O2/O3 的现状收敛是独立债务，本项只取"本地端点不被误伤"的目标。

### D4 · 方向：本地 model 名可被正确指定/发现，与引擎实际报告一致

- **分类**：二开改动点 ｜ **优先级**：中
- **现状依据**：端点拼装支持任意 base 与 `#` 显式端点（`packages/shared/utils/ai-protocol.ts:70-95`），model 名原样透传（`ai-client.ts:58/73`、renderer `ai.ts:103/159`）。已知接入陷阱：model 名须与引擎报告完全一致（如 `ollama list` / llama-server 加载名，architecture.md [S26]）。
- **方向与目标**：让用户能正确指定或发现本地引擎实际报告的 model 名，避免因名称不匹配而连接失败。
- **约束/取舍**：是否提供模型列表发现（引擎多有 `/v1/models`）、如何呈现，是实施决策；不预设接口。

### D5 · 方向：思考模式 / token 参数的本地适配

- **分类**：二开改动点 ｜ **优先级**：中
- **现状依据**：renderer 已对 Qwen/DashScope 注入 `enable_thinking`（`apps/desktop/src/renderer/services/ai.ts:237-254`，非流式强制 false `:245-250`）、按模型名选 `max_completion_tokens` vs `max_tokens`（`:148-155`）。相关已有记录 #9（enable_thinking 非流式须 false）、#21（max_tokens 兼容）见第 5 节。
- **方向与目标**：让本地 Qwen 的思考模式与 token 参数行为正确工作（本地引擎对思考/采样/token 参数的支持可能与云端 DashScope 不同）。
- **约束/取舍**：如何判定本地模型能力、是否/如何注入思考与 token 参数，是实施决策；不预设接口，不硬绑某引擎私有参数（见 D6）。

### D6 · 方向：引擎可替换，不硬绑私有特性；是否内置引擎生命周期管理（开放问题）

- **分类**：二开改动点 ｜ **优先级**：中
- **现状依据**：候选引擎（llama.cpp / KVMem / Ollama / KoboldCpp）都暴露 OpenAI 兼容 `/v1/chat/completions`，与现状 openai 分支契合度都高（architecture.md §2.0/§2.1；LM Studio 已被用户删除，不再列为候选）；现状协议面停留在通用 openai 契约（`ai-protocol.ts:80-95`）。
- **方向与目标**：接入面停留在候选引擎共有的 OpenAI 兼容契约上，使 llama.cpp / KVMem / Ollama / KoboldCpp 之间切换不改变 PromptHub 侧接入方式；引擎特有调优旋钮（offload 层数、KV 量化、批大小、KV 分层预算等）属引擎侧。
- **约束/取舍（开放问题，不预设答案）**：是否由 PromptHub 管理本地引擎的启动/健康/生命周期，还是纯外置由用户自管？引擎调优旋钮是否在 PromptHub UI 暴露？（architecture.md §3.2/§3.5）本文不预设接口与上下级结构。**ComfyUI 共存场景（D8）使生命周期问题有了具体场景牵引**：D6 是一般性归属问题，D8 是该问题下的具体共存约束，两者不重复立项。

### D7 · 约束：显存/内存留余量，不占满（预算化加载与上下文）

- **分类**：二开改动点 ｜ **优先级**：高
- **依据**：用户新增约束（architecture.md §3.3 约束 1）。技术依据：权重 6.4GB 全 offload + CUDA/计算缓冲 0.5–0.9GB 已 ~7GB 起，Windows WDDM 桌面再占 0.3–1GB（architecture.md §2.0.1 预算表，[R0][R1] 推算）；KVMem 文档记录过 32GB 机器 RAM 压力使 decode 掉速的案例（[R0] §5，项目记录）。混合架构纠正后 KV 压力约为纯注意力 1/4（q8_0 KV 32K≈0.53GB，推算），为收紧预算留出空间。
- **方向与目标**：引擎加载与上下文/KV 预算默认给系统和其他应用留余量，**不以占满 8GB 显存/32GB 内存为目标**（显存参考目标总占用 ~6–6.5GB，参考值非硬阈值）；长上下文靠把 KV 历史放 RAM（KVMem 方向）解决，而不是挤占显存余量；RAM 侧预算同样扣除系统/应用与页缓存后再定。
- **约束/取舍**：留余量与"权重全 offload"存在张力，须在部分层 offload（decode 掉速）/更紧上下文/关 MTP 之间取舍；具体预算值与组合由本机 nvidia-smi 实测确定（第 6 节），本文不预设接口与参数。

### D8 · 方向：与 ComfyUI 生图共存——LLM 自动卸载/重载的生命周期编排（未来）

- **分类**：二开改动点（未来方向） ｜ **优先级**：中
- **依据**：用户新增约束（architecture.md §3.3 约束 2）：未来同一张 8GB 显卡既要跑本地 LLM 又要跑 ComfyUI 生图。本项无现状代码证据（属未来场景），现状关联是 D6 的引擎生命周期开放问题与 architecture.md §2.0 的单卡前提。
- **方向与目标**：生图需要资源时，自动卸载 LLM、释放其显存与内存占用给生图让路；生图完成后再把 LLM 加载回来恢复可用。目标是用户无感或低感知的资源交接，而非手动停启引擎。
- **约束/取舍（开放问题，不预设答案）**：由谁编排（PromptHub / 引擎侧 / 外部协调）、如何感知生图需求、卸载/重载期间会话与上下文状态如何保持、重载延迟如何被用户感知与接受，均为实施决策。**只定意图，不预设具体接口、调用链或进程管理方案**（architecture.md §3.3/§3.5）。与 D6 的关系见 D6 末注。

### D9 · 方向：运行时实时 tok/s 等推理指标可见

- **分类**：二开改动点 ｜ **优先级**：中
- **依据**：用户新增约束（architecture.md §3.3 约束 3）。现状依据：renderer 流式路径已存在（`apps/desktop/src/renderer/services/ai.ts:131,246-247`，architecture.md §1.4/§1.5），但 PromptHub 侧是否已有任何引擎速度指标展示**未取证，不预设**。引擎侧指标可用性因引擎而异：llama-server 有 timings/指标面（[S1]，社区来源）、KVMem 有控制台（[R3]），均须实测确认。
- **方向与目标**：运行时要能看到实时 tok/s 等指标，让用户感知本地推理的速度与健康状况，而非黑盒等待；也为 D7 的预算取舍与 MTP 接受率实测提供观测手段。
- **约束/取舍**：采集哪些指标、从引擎侧还是请求侧推算、如何呈现，是实施决策；不预设接口，不硬绑某引擎私有指标端点（与 D6 一致）。

### D10 · 方向：工具流/提示词加载性能优化（前缀复用/预热）

- **分类**：二开改动点 ｜ **优先级**：中
- **依据**：用户新增约束（architecture.md §3.3 约束 4）。现状依据：两条聊天路径均按请求发送完整消息体（core `buildChatBody`：`packages/core/src/ai-client.ts:52-79`；renderer 编排：`apps/desktop/src/renderer/services/ai.ts:93` 起，architecture.md §1.4），未见跨请求前缀复用/预热协调机制。引擎侧已有前缀复用能力先例：KVMem 61k 前缀第二轮 54s→1.2s（[R6]，项目自测、须本机实测）。
- **方向与目标**：降低加载工具流与长系统提示的首 token 延迟，方向包括前缀复用、预热等；让重复/多轮/分支场景的提示词加载尽可能快。
- **约束/取舍**：PromptHub 侧提示词组织如何与引擎前缀缓存配合、是否/何时预热、缓存失效语义如何定义，是实施决策；不预设接口。引擎侧收益数字为项目自述，须本机实测后才可作为决策依据。

---

## 4. localhost / SSRF 取证结论（应 brief 要求，先读码再下断言）

针对 architecture.md §3.3/§3.5 留的开放问题"本地回环是否被面向云端的防护/代理逻辑误伤"，本会话已读码取证，结论如下（均有行号）：

1. **AI provider 聊天线没有 SSRF/主机名拦截**。`ai.ipc.ts:129-154` 的 `performRequest` 只做 multipart 输入校验（`buildMultipartBody :143`）后直接 `fetchWithNetworkProxy(request.url, …) :144`，对 url 无 `new URL`/主机名/私网判定（全文 grep `isPrivate|isBlocked|localhost|127\.|SSRF|hostname|new URL|loopback` 无命中）。core 路径 `ai-client.ts:30-50` 为裸 fetch，同样无校验。→ **本地回环端点在聊天线不会被 SSRF 防护阻断**；"被云端 SSRF 防护误伤"的担忧在聊天线**不成立**。
2. **SSRF 防护存在于别的线**：coding-agent 连通性探测（`agent-provider-connectivity.ts:10-15` 导入 `isBlockedHostname`/`isPrivateAddress`/`resolvePublicAddress`，来自 `skill-installer-remote.ts:8-15` re-export）以及 Skill/图片下载线。探测线**显式放行回环**：`agent-provider-connectivity.ts:56-64`（`isLoopbackHost` 认 `localhost`/`*.localhost`/`127.0.0.1`/`::1`）、`:100-117`（回环跳过 `isBlockedHostname`、跳过私网解析、且仅回环允许 http）。
3. **真正的本地接入风险在代理边界，而非 SSRF**：manual 模式 bypass 纯按用户配置（`shared/utils/network-proxy.ts:129-153`），`<local>` 规则为 `!normalizedHost.includes('.')`（`:139-141`），覆盖 `localhost` 与不含点主机名（含 `::1`/`[::1]`），**不覆盖 `127.0.0.1`**；Chromium `proxyBypassRules: settings.bypass` 仅在 manual（`fixed_servers`）分支执行（`network-proxy.ts:472-476`），system 模式仅 `setProxy({ mode: "system" })`（`:461-463`），bypass 取决于 OS 代理配置。manual 模式开了代理且 bypass 未含 `127.0.0.1` 时，该形式的本地请求可能被误路由（O3）；system 模式回环是否被误路由未取证（Chromium 隐式回环 bypass 行为仓库代码无法证明），列为第 6 节开放问题。两条路径代理行为还不一致（O2）。
4. **结论**：D3 的方向应聚焦"代理 bypass / 两路径一致性 / CORS"，而非"给聊天线加 SSRF 放行"（聊天线本就无 SSRF 拦截）。是否给聊天线引入与探测线一致的回环判定属实施决策，本文不预设。

---

## 5. 合并 / 引用的已有权威记录（不另造平行清单）

> 下列项已存在于 `spec/issues` / `spec/changes`，本文**只引用、不重复立项、不改其状态**。它们是相关现状债务/二开点的已有权威记录或上下文。

### 5.1 AI 模型 provider 线（P0 相关，均已修复/本地完成）

| 记录 | 主题 | 与本文关联 | 状态（据快照） |
| --- | --- | --- | --- |
| [#21](https://github.com/legeling/PromptHub/issues/21) | openai `max_tokens` 无法配置，建议兼容 | D5 / renderer token 参数回退现状（`ai.ts:145-155` 注释即引用 #21） | closed（`github-closed.md:199`） |
| [#9](https://github.com/legeling/PromptHub/issues/9) | `enable_thinking` 非流式须 false | D5 / Qwen 思考模式现状（`ai.ts:245-250`） | closed（`github-closed.md:210`） |
| [#19](https://github.com/legeling/PromptHub/issues/19) | 默认 API 地址错误无法连通 | F1 / 端点归一化现状（`ai-protocol.ts:47-95`） | closed（`github-closed.md:201`） |
| [#24](https://github.com/legeling/PromptHub/issues/24) | 设置添加 AI 模型无法获取 Gemini 模型 | F1 / gemini 协议与 models 端点（`ai-protocol.ts:97-120`） | closed（`github-closed.md:196`） |
| [#43](https://github.com/legeling/PromptHub/issues/43) | 优化模型添加功能 | D1/D4 / 模型添加 UX 现状 | closed（`github-closed.md:178`） |
| [#112](https://github.com/legeling/PromptHub/issues/112) | web 版添加 AI 模型提示失败 | 多端 provider 接入（P4 范畴，划界引用） | closed（`github-closed.md:123`） |
| [#116](https://github.com/legeling/PromptHub/issues/116) | 测试功能支持多模态附件 | `ai.ipc.ts` multipart 校验现状（`:53-96`） | closed（`github-closed.md:119`） |
| [#245](https://github.com/legeling/PromptHub/issues/245) | Settings→AI Configuration provider 删除/CRUD | provider 配置 CRUD 现状（Model Services，`model-services-provider-crud` 合同） | open / local_done（`local-github-status.md:178/192`） |

> 这些是已交付/本地完成的记录，本文相关债务与二开点引用它们作现状依据，**不重新立项**。#245 的 provider CRUD 与 agent provider profile 是**独立记录**（见 5.2 划界）。

### 5.2 coding-agent 平台适配线（P1，**超出 P0 范围**，仅划界引用）

| 记录 | 范围 | 与本文边界 |
| --- | --- | --- |
| [agent-provider-protocol-bridge](../../../changes/active/agent-provider-protocol-bridge/proposal.md)（`FR-PROTOCOL-001`） | 为 **Agent provider** 流量做主进程内本地协议桥接（OpenAI Chat / OpenAI Responses / Anthropic Messages / Google Generative AI），含本地 listener、凭据托管、生命周期/回滚 | 属 **coding-agent 线**，**不是** PromptHub 自身 AI 功能聊天线、**不是**本地 GGUF 推理接入。本文 F1 若收敛协议推断须与其 canonical 协议方向对齐，不另造竞争实现；其"本地 listener 扩大安全边界"风险（proposal.md Risks）是 D3 本地端点安全的相关先例，但范围不同 |
| [#246](https://github.com/legeling/PromptHub/issues/246) | claude 导入第三方模型配置格式错误 | coding-agent 配置适配（`agent-model-config`），非本地推理；open/in_progress（`local-github-status.md:179`） |
| [ISS-20260825-002](../../../issues/active/ISS-20260825-002-provider-profile-duplicate-name-contract.md) | agent provider profile 重名唯一索引合同冲突 | 属 `agent-management-workbench` 的 **agent provider profile**，与 AI provider 线的 Model Services provider（#245）是独立记录；local_done |

> 划界依据：[flow.md](flow.md) §0、architecture.md §3.4。本地 GGUF 推理接入**不在**上述 coding-agent 线找接入点。

---

## 6. 开放问题 / 实施前需验证（非断言，不预设答案）

> 这些是 architecture.md §3.5 留的待验证项，**不是已确认待办**，列此以免被误当结论。具体本机实测步骤见 [benchmark-plan.md](benchmark-plan.md)（T0–T10，含留余量显存拟合、MTP 接受率、KVMem 9B 召回、ComfyUI 卸载/重载 handoff、实时 tok/s、前缀复用）。

- **本机实测性能（含留余量预算）**：8GB 显存跑该确切 IQ4_XS 文件（根目录 `Qwen3.5-9B-…-IQ4_XS.gguf`，实测 6,396,325,152 字节），**在留余量目标（~6–6.5GB，D7）内**可用上下文与 tok/s 是多少？架构纠正后 KV 压力约为纯注意力 1/4（q8_0 KV 32K≈0.53GB，推算 [R1][R0]），但全 offload + 缓冲与余量目标存在张力，部分 offload/上下文/MTP 开关的取舍须 nvidia-smi 实测定（architecture.md §2.0.1/§2.2）。显卡具体型号/sm 版本须先确认。
- **MTP 变体投机解码**：引擎支持**已核实**——llama.cpp 原生 `--spec-type draft-mtp`、KVMem llama.cpp 后端支持（architecture.md §2.2 [R2][R3]）；旧版 llama.cpp 会静默忽略 MTP 张量，须用新版。剩余待实测：本 heretic/merge 变体草稿头**接受率与净收益**（预期 1.2–1.6×，全部自述/项目自测）、n_max 最优点（1→3 扫描）、MTP×mmproj 与 `-np>1` 限制现状；**接受率 <50%（2 token 草稿）换普通 IQ4_XS 变体**（用户两个文件各司其职）；草稿 KV 用 F16、temp≤1、rep_pen=1（architecture.md §2.2 MTP 专项）。
- **KVMem 9B 正确性验收**：官方对 9B 仅形状/数值/状态级验证，整模型 + MTP 验收只在 4B 完成（[R3]）。须自测 identity 短问答、多深度 needle 召回、检索 miss 率、B=8K/16K 开销；RTX 20/30/40 预编译包"未上卡实测"（architecture.md §2.2）。
- **引擎生命周期 / 调优旋钮暴露**：见 D6 开放问题；**ComfyUI 共存的卸载/重载编排**（归属、生图需求感知、会话状态保持、重载延迟体验）见 D8，均不预设答案。
- **tok/s 指标可用性与提示词前缀复用**：各候选引擎的实时指标面、前缀缓存/预热能力须实测确认（D9/D10；[S1][R3][R6] 为社区/项目自述来源）。
- **（二期）NInfer 转换兼容性**：自定义 merge 的 GGUF→.ninfer 转换契约与 identity 对齐未知（[R5]，architecture.md §2.1/§3.5）。
- **system 模式回环是否被误路由**：system 模式 Chromium bypass 来自 OS 代理配置（`network-proxy.ts:461-463`），用户 `settings.bypass` 不参与；Chromium 对回环地址是否存在隐式 bypass（使回环免代理）属引擎行为，仓库代码无法证明，本会话未取证。须实测或查 Chromium 行为后再下断言（关联 O3/D3），当前只确认"取决于 OS 代理 bypass 配置"。
- **免 key 与强制 key 的区分策略 / 本地端点放行策略**：见 D1/D3 约束，属实施决策。

---

## 附：本文证据核对清单（本会话直接读码）

- `packages/core/src/ai-client.ts`：`:30-50` requestWithFetch（裸 fetch + AbortController）、`:52-79` buildChatBody（按请求组装完整消息体，D10 依据）、`:76` stream:false、`:120-122` 强校验、`:124` resolveAIProtocol、`:130` 写死超时。
- `packages/shared/constants/ai.ts:2`：`AI_REQUEST_TIMEOUT_MS = 300_000`。
- `packages/shared/utils/ai-protocol.ts`：`:23-45` resolveAIProtocol（全等）、`:47-58` getBaseUrl、`:70-95` resolveProtocolBase/buildChatEndpointFromBase、`:97-120` gemini/models 端点、`:122-144` buildHeadersForProtocol。
- `packages/core/src/ai-config.ts`：`:104-134` normalizeProtocol（子串，含 claude/google 别名）、`:164/183` 写入显式 apiProtocol。
- `apps/desktop/src/renderer/services/ai.ts`：`:100` resolveAIProtocol、`:104` 超时覆盖、`:106-116` 强校验、`:148-155` token 参数（#21）、`:237-254` enable_thinking（#9）。
- `apps/desktop/src/main/ipc/ai.ipc.ts:129-154`：performRequest（`:134-137` 超时覆盖、`:143` multipart、`:144` fetchWithNetworkProxy；无 SSRF/主机名校验）。
- `apps/desktop/src/main/services/network-proxy.ts`：`:101-111` getManualProxyUrlForTarget、`:404-409` system→Chromium、`:432-439` applyGlobalFetch（仅 manual）、`:461-463` system 仅 setProxy(mode:"system")、`:472-476` proxyBypassRules=settings.bypass（仅 manual/fixed_servers 分支）、`:74-99` applyProxyEnvironment（NO_PROXY 写入 `:97-98` 仅 manual 分支；system `:80-85` 恢复原始环境变量后返回）。
- `packages/shared/utils/network-proxy.ts:129-153`：shouldBypassProxyForHostname（`<local>` 规则 `!normalizedHost.includes('.')` `:139-141`，覆盖 localhost/::1/[::1] 等不含点主机名，不覆盖 127.0.0.1）。
- `apps/desktop/src/main/services/agent-provider-connectivity.ts`：`:10-15` SSRF 导入、`:56-64` isLoopbackHost、`:100-117` 回环放行；`skill-installer-remote.ts:8-15` re-export。
- 已有记录快照：`spec/issues/active/github-open.md`、`local-github-status.md`、`archive/github-closed.md`；`spec/changes/active/agent-provider-protocol-bridge/proposal.md`；`spec/issues/active/ISS-20260825-002-…md`。