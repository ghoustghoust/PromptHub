# AI Provider / 本地模型 · 本机实测计划

> **派生 · 非权威 · 引用权威主题。** 本文是二开理解层的实测计划，服务"把本地 Qwen3.5-9B IQ4_XS 在留余量约束下跑到最优"的目标，不构成需求或实现约定。
> 依据：[architecture.md](architecture.md)（混合架构纠正 §2.0.1、引擎选型 §2.1、推荐与留余量张力 §2.2、MTP 专项、二开约束 §3.3）、[todo.md](todo.md)（D7–D10、第 6 节开放问题）、引擎调研报告 [R0]（`C:/Users/ghous/AppData/Local/Temp/prompthub-local-engine-research/report.md`，临时产物，关键结论已摘录进 architecture.md）。
> 模型卡权威来源 [R1]：https://hf-mirror.com/DavidAU/Qwen3.5-9B-The-Defiant-Fable-Uncensored-Heretic-NEO-IMATRIX-MAX-MTP-GGUF
>
> **性质**：这是**引擎侧/硬件侧**的实测计划（外部推理引擎与显卡），不是 PromptHub 代码改动。PromptHub 侧的接入方向仍意图级、不锁接口（见 architecture.md §3）。本文给出引擎侧示例命令仅为可执行参考，**所有性能数字均须本机实测，不采信博客/作者自述为定论**。
> **先不安装、先不跑**：本文是计划，待用户确认后再逐项执行；安装引擎/下载运行包须用户批准。

---

## 0. 实测前提与总约束

- **模型文件**（已在本地，英文路径）：
  - 普通：`G:/program/3.prompt-forge/Qwen3.5-9B-The-Defiant-Fable-Uncnr-Heretic-NEO-MAX-IQ4_XS.gguf`（6,396,325,152 字节 ≈ 6.4GB）
  - MTP：`...-MTP-IQ4_XS.gguf`（6,526,302,432 字节 ≈ 6.5GB，带原生草稿头）
- **硬件**：约 8GB 显存 + 32GB 内存，Windows。**显卡具体型号未知**——实测第一步必须确认（决定 CUDA 包与带宽预期）。
- **架构事实（已核实 [R1][R2]）**：32 层 = 24 GDN（状态恒定）+ 8 全注意力（仅此 8 层产 KV）；KV 头 4 / head_dim 256；q8_0 KV ≈17KB/token（32K≈0.53GB / 128K≈2.1GB / 256K≈4.4GB，推算）。KV 压力约为纯注意力 9B 的 1/4。
- **总约束（用户，贯穿所有测试）**：
  1. **留余量不占满**：显存参考目标总占用 **~6–6.5GB / 8GB**（参考值非硬阈值），RAM 同样扣除系统/应用/页缓存后留余量。**不以占满为目标**。
  2. **ComfyUI 共存（未来）**：同一显卡后续要跑生图，须能卸载 LLM 释放显存+内存、生图后重载。本计划先验证引擎的卸载/重载行为与时延（T6），为后续编排二开提供数据。
  3. **实时 tok/s 可见**：每项测试都记录实时 tok/s（顺带验证各引擎指标面可用性，T7）。
- **证据分级沿用 [R0]**：已验证（一手代码/官方卡）/ 自述（作者/项目宣称）/ 二手（博客）/ 推算。**本计划产出的数字才是本硬件本模型的真值**。

---

## 1. 测试矩阵总览

| 编号 | 测试 | 目的 | 优先级 | 对应约束/开放问题 |
| --- | --- | --- | --- | --- |
| T0 | 硬件基线与选包 | 确认显卡 sm 版本、桌面显存/RAM 占用基线 | 高（前置） | §3.5 显卡未知 |
| T1 | 显存拟合（留余量） | 余量目标内最大稳定上下文 + tok/s，全/部分 offload 取舍 | 高 | D7 / §2.2 张力 |
| T2 | MTP 接受率与净收益 | 普通 vs MTP、n_max 扫描、接受率阈值 | 高 | §2.2 MTP / D2 |
| T3 | KV 量化质量 | q8_0 vs f16 主 KV 的质量/召回差异 | 中 | §2.2 |
| T4 | KVMem 9B 正确性 | identity + 多深度 needle 召回 + 开销 | 高（长上下文前置） | §2.2 9B 验证缺口 |
| T5 | 长上下文性能 | KVMem 64K–256K 的 TTFT/decode/召回 | 中 | D7 长上下文走 RAM |
| T6 | 卸载/重载 handoff | LLM 卸载释放显存+内存、重载时延、状态保持 | 中（ComfyUI 前置） | D8 |
| T7 | 实时 tok/s 指标面 | 各引擎指标可用性 + 采集方式 | 中 | D9 |
| T8 | 提示词前缀复用 | 长系统提示/工具流重复请求 TTFT 收益 | 中 | D10 |
| T9 | 长推理稳定性 | xhigh/thinking 连续 1h，显存碎片/TDR/RAM 压力 | 中 | 稳定性目标 |
| T10 | NInfer 转换（二期） | GGUF→.ninfer 对自定义 merge 兼容性 + identity | 低（二期） | §2.1 NInfer |

执行顺序：T0 → T1/T2/T3（llama.cpp 裸跑基线）→ T4/T5（KVMem 长上下文）→ T6/T7/T8/T9（共存与体验）→ T10（二期）。

---

## T0 · 硬件基线与选包（前置）

- **目的**：确认显卡型号与 sm 版本，选对应 CUDA 预编译包；记录空闲基线。
- **方法**：
  - `nvidia-smi` 记录显卡型号、显存总量、**桌面空闲占用**（WDDM 通常 0.3–1GB）、驱动版本。
  - 据型号定 sm：RTX 20=sm75 / 30=sm86 / 40=sm89 / 50=sm120（NVFP4 内核仅 sm120；int8 路径 sm75+）。
  - 记录系统 RAM 空闲（任务管理器/`systeminfo`）。
- **观测**：型号/sm、空闲显存、空闲 RAM。
- **通过判据**：明确 sm 版本并下载到对应 llama.cpp CUDA 包；得到"可用显存 = 8GB − 桌面占用"的实际值。
- **工具**：nvidia-smi、llama.cpp release 页（按 sm 选包）。
- **注意**：RTX 20/30/40 的 KVMem 预编译包官方"未上卡实测"，T4 须确认能推理。

## T1 · 显存拟合（留余量，非占满）

- **目的**：在 ~6–6.5GB 显存目标内，找最大稳定上下文与 tok/s；量化全 offload vs 部分 offload 的取舍。
- **方法**（llama-server，普通变体先测，MTP 在 T2）：
  - 固定 `-fa on -ctk q8_0 -ctv q8_0`，扫上下文 `-c 8192 / 16384 / 32768 / 65536`。
  - 扫 offload：`-ngl 99`（全）vs 部分（如 `-ngl 28/24/20`，留几层 CPU 换显存余量）。
  - 每组合用 nvidia-smi 记录**峰值显存**，跑固定提示集记录 decode tok/s 与是否 OOM。
  - 示例（仅参考，参数以实测调整）：
    ```
    llama-server -m Qwen3.5-9B-...-IQ4_XS.gguf -ngl 99 -fa on -ctk q8_0 -ctv q8_0 -c 16384 --port 8080 -np 1
    ```
- **观测**：峰值显存、decode tok/s、prefill/TTFT、OOM 与否、CPU offload 层的掉速幅度。
- **通过判据**：找到"峰值显存 ≤ ~6.5GB 且稳定不 OOM"的最大上下文组合；记录全 offload 是否超余量目标、部分 offload 掉速多少。
- **工具**：llama-server、nvidia-smi、server timings（`/slots` 或日志）。
- **关键取舍记录**：权重 6.4GB 全 offload + 缓冲 ~7GB 起 vs 余量目标 ~6.5GB 的张力（architecture.md §2.2）——用数据回答"该全 offload 紧上下文，还是部分 offload 换余量"。

## T2 · MTP 接受率与净收益

- **目的**：验证本 heretic/merge 变体草稿头是否值得用；找 n_max 最优点。
- **方法**：
  - 普通 vs MTP 变体，`--spec-type draft-mtp --spec-draft-n-max 1/2/3` 各测。
  - 提示集分三组：代码/结构化、创作/角色扮演、长推理；每组固定若干提示。
  - 设置：`--temp 0.7~1.0 --repeat-penalty 1.0 -np 1`；**草稿 KV 用 F16**（主 KV q8_0）。
  - 记录 server timings 的 decode tok/s 与**草稿接受率**。
- **观测**：接受率、净 tok/s（相对普通变体）、n_max 收益曲线。
- **通过判据**：接受率 ≥50% 且净加速 >1 的组合保留；**接受率 <50%（2 token 草稿）→ 换普通变体**（[R1] 作者阈值）。预期净收益 1.2–1.6×（自述区间，以实测为准）。
- **工具**：llama-server（新版，旧版静默忽略 MTP 张量）、timings。
- **限制复核**：MTP×`--mmproj`（视觉）、MTP×`-np>1` 在当前版本是否仍互斥（二手说法，须实测确认）。
- **与余量冲突**：MTP 额外 ~0.2–0.4GB 挤压余量——记录"MTP+较小上下文" vs "无 MTP+较大上下文"的实测取舍。

## T3 · KV 量化质量

- **目的**：q8_0 主 KV 相对 f16 的质量损失是否可接受。
- **方法**：同一提示集，`-ctk/-ctv q8_0` vs `f16`，对比 perplexity（如引擎支持）/长文召回/输出一致性；草稿 KV 始终 F16（T2 已证 q8_0 草稿 KV 降接受率）。
- **观测**：perplexity 差、长文关键事实召回率、贪心输出一致性。
- **通过判据**：q8_0 质量损失在可接受范围（具体阈值用户定）；否则长上下文场景用 f16 KV（更占显存，回 T1 权衡）。
- **工具**：llama-server（perplexity 工具如可用）、needle 提示集。

## T4 · KVMem 9B 正确性（长上下文前置，不可跳过）

- **目的**：补官方对 9B 的验证缺口（整模型+MTP 实测只在 4B 完成 [R3]）。
- **方法**：
  - 安装 KVMem Windows 包（llama.cpp 后端，直选 GGUF）——**安装须用户批准**。
  - **identity**：短问答，KVMem-on/off 贪心输出逐 token 一致。
  - **needle 召回**：把关键事实埋进长文档不同深度（如 8K/32K/64K/128K 处），问回，统计命中率。
  - 确认 RTX 20/30/40 包能正常推理（官方未上卡实测）。
- **观测**：identity 一致性、各深度 needle 命中率、检索 miss 率。
- **通过判据**：identity 全同；needle 命中率达标（阈值用户定，retrieval miss 是 GO/NO-GO）；否则长上下文不可用 KVMem。
- **工具**：KVMem 控制台、自建 needle 文档集。

## T5 · 长上下文性能（KVMem）

- **目的**：64K–256K 逻辑上下文在留余量下的 TTFT/decode/召回。
- **方法**：
  - GPU KV 预算 B=8K/16K + 生成预留 R=2K–4K + sink/recent 保留；HostMiB 从 8GB 起（RAM 留余量，不顶格）。
  - 上下文 131072 / 262144；KV q8_0。
  - 示例（参考，先 `-DryRun` 看完整参数）：
    ```
    start-backend.ps1 -Backend llamacpp -Model <...IQ4_XS.gguf> -Context 131072 -Budget 16384 -Reserve 4096 -HostMiB 8192
    ```
  - 记录 TTFT、decode tok/s、stage-in 延迟、RAM 占用、needle 召回（复用 T4）。
- **观测**：TTFT/decode、检索开销、RAM 压力（[R0] 记录过 RAM 压力使 decode 掉到 31.7 tok/s 的案例）。
- **通过判据**：长上下文召回达标 + 速度可接受 + RAM 留余量；对比短上下文确认"短上下文不如 llama.cpp 裸跑"。
- **工具**：KVMem、nvidia-smi、任务管理器。

## T6 · 卸载/重载 handoff（ComfyUI 共存前置）

- **目的**：为 D8 未来编排提供数据——LLM 卸载能释放多少显存+内存、重载多快、会话状态能否保持。
- **方法**：
  - 加载 LLM 跑一段对话 → 停止/卸载引擎 → nvidia-smi/任务管理器确认**显存与 RAM 是否完全释放**。
  - 重新加载引擎 → 记录**重载时延**（冷加载 vs mmap 页缓存热加载）。
  - 验证卸载前会话/上下文能否在重载后恢复（引擎侧会话持久化能力；KVMem 会话缓存进程内有效、重启不恢复 [R0]）。
  - （可选，须用户批准且 ComfyUI 就绪）与 ComfyUI 生图交替运行，观察资源交接是否干净、有无显存残留导致生图 OOM。
- **观测**：卸载后显存/RAM 释放量、重载时延、会话恢复能力、交替运行稳定性。
- **通过判据**：卸载能释放绝大部分显存+RAM；重载时延在用户可接受范围；明确会话状态保持的引擎侧能力边界。
- **工具**：llama-server/KVMem 启停、nvidia-smi、任务管理器、（可选）ComfyUI。
- **意图级边界**：本测试只测**引擎侧**卸载/重载行为；"由谁编排、如何感知生图需求"是 D8 实施决策，不在此预设。

## T7 · 实时 tok/s 指标面（D9）

- **目的**：确认各引擎实时指标可用性与采集方式。
- **方法**：llama-server 的 timings/`/metrics`（Prometheus 面，[S1] 社区来源须实测）、KVMem 控制台速度显示；记录能否拿到实时 decode tok/s、接受率、显存。
- **观测**：各引擎可采集的指标清单与接口形态。
- **通过判据**：至少一条引擎能稳定提供实时 tok/s；明确 PromptHub 侧采集的可行来源（呈现形态属实施决策）。
- **工具**：llama-server `/metrics`/timings、KVMem 控制台。

## T8 · 提示词前缀复用（D10）

- **目的**：验证长系统提示/工具流重复请求的 TTFT 收益。
- **方法**：固定长系统提示（模拟工具流），连续多轮/分支请求，对比首轮 vs 后续 TTFT；KVMem 前缀复用（spread + prompt_cache_key）开/关对照（[R6] 27B 记录 54s→1.2s，须本机复现）。
- **观测**：首轮/后续 TTFT、前缀缓存命中、缓存失效行为。
- **通过判据**：量化前缀复用对本模型的实际 TTFT 收益；明确缓存失效语义（供 D10 实施参考）。
- **工具**：KVMem/llama-server（slot 前缀缓存）、固定提示集。

## T9 · 长推理稳定性

- **目的**：xhigh/thinking 模式长时间运行的稳定性。
- **方法**：thinking 模式（temp 1.0/top_p 0.95/top_k 20，[R1] 建议）连续生成 ~1 小时（长推理任务），监测显存碎片、Windows WDDM TDR、RAM 压力、tok/s 衰减。
- **观测**：是否崩溃/掉速/显存泄漏、TDR 事件。
- **通过判据**：1 小时稳定无崩溃、tok/s 无显著衰减；否则定位（KV 预算/批大小/余量）。
- **工具**：llama-server/KVMem、nvidia-smi 持续采样、事件查看器（TDR）。

## T10 · NInfer 转换（二期）

- **目的**：验证自定义 heretic merge 的 GGUF→.ninfer 转换兼容性。
- **方法**：按 NInfer 转换契约转换本模型 → identity 对齐（与 llama.cpp 输出比对）→ 若对齐再比速度（含 DFlash2 草稿）。
- **观测**：转换是否成功、identity 是否对齐、速度差。
- **通过判据**：转换成功且 identity 对齐才纳入候选；否则维持 llama.cpp 后端。
- **工具**：NInfer 转换工具（上游 iamwavecut/ninfer-all）、KVMem NInfer 后端。

---

## 2. 采样建议（来自模型卡 [R1]，实测时按场景用）

- thinking 通用：temp 1.0 / top_p 0.95 / top_k 20 / min_p 0 / presence 0 / rep_pen 1.0
- thinking 精确代码：temp 0.6 / 其余同上
- instruct（非思考）：temp 0.7 / top_p 0.80 / top_k 20 / presence 1.5 / rep_pen 1.0
- 角色扮演/平滑：KoboldCpp/ooba/SillyTavern 可加 smoothing_factor 1.5
- MTP 友好：temp ≤1、rep_pen 1（高 temp/rep_pen 降接受率）

## 3. 结果记录与决策

- 每项测试记录：硬件/引擎版本/参数/峰值显存/RAM/tok/s/接受率/召回/时延/异常，形成**本硬件本模型的真值表**。
- 实测完成后回填 architecture.md §2.2 推荐（把推算区间替换为实测值）、todo.md 第 6 节开放问题（已验证项收口）。
- 关键决策由实测数据驱动：全/部分 offload 取舍、MTP 是否用、q8_0/f16 KV、KVMem 长上下文 GO/NO-GO、ComfyUI handoff 可行性。

## 4. 边界与未决

- 本计划只测引擎侧/硬件侧；PromptHub 接入二开（免 key/超时/回环放行/生命周期编排/tok/s 呈现/前缀复用配合）仍意图级，待实测数据 + 单独 brainstorm 设计后再落接口。
- 安装引擎/下载运行包/与 ComfyUI 联调均须用户批准后才执行。
- 显卡型号确认（T0）是所有 tok/s 预期的前提；未确认前不给绝对速度结论。