# AI Provider / 本地模型 · 本机实测结果（滚动记录）

> **派生 · 非权威。** 本文件记录本机实测真值，回填 [architecture.md](architecture.md) §2.2 推算与 [benchmark-plan.md](benchmark-plan.md) 各测试项。
> 实测日期：2026-11-17。所有数字为**本机实测**（非博客/自述），但单次测量、提示集有限，正式结论需多轮复测。

## T0 · 硬件与引擎基线（已测）

- **GPU**：NVIDIA GeForce RTX 5060 Ti，**8123 MiB（~8GB）**，**sm_120（Blackwell）**，驱动 621.24。
- **桌面占用波动**：空闲显存在 ~6327–7013 MiB 间波动（桌面占 ~1.1–1.6GB）。**留余量预算须以实时 nvidia-smi 为准**。
- **引擎**：llama.cpp **build 12445（v1.0.0-dev, commit ef3848f9d）**，CUDA **13.5** x64（sm_120 需 CUDA 12.8+，12.4 不支持），Clang 20.1.8。安装于 `D:\tools\llama.cpp`（英文路径）。
- `--list-devices` 正确识别 CUDA0 RTX 5060 Ti。`--spec-type draft-mtp` 在此 build 存在（MTP 原生支持确认）。
- 模型：IQ4_XS 4.25 bpw，text modality，**默认开思考模式**。

## T1 · 显存拟合（c8192, q8_0 KV, FA on, np1, temp0.7, rep_pen1.0）

普通 IQ4_XS 变体，部分 offload 扫描：

| ngl（GPU层/32） | 峰值显存 MiB | 占用率 | Prompt t/s | Generation t/s |
| --- | --- | --- | --- | --- |
| 99（全 offload） | 7138 | 89% | 177.1 | **56.5** |
| 28 | 6564 | 81% | 88.2 | 30.8 |
| 24 | 6067 | 75% | 64.4 | 22.7 |
| 20 | 5594 | 69% | 52.3 | 18.0 |
| 16 | 5116 | 63% | 39.7 | 15.0 |

**结论**：全 offload 最快（56.5 t/s）但峰值 7.1GB（89%），超留余量目标 ~6.5GB。移 4 层到 CPU（ngl28）速度近乎减半（CPU 层每 token 走 PCIe 代价大）。

## T2 · MTP 投机解码（MTP 变体, --spec-type draft-mtp, n_max2, 草稿 KV F16, 主 KV q8_0）

| 配置 | 峰值显存 MiB | 占用率 | Generation t/s | MTP 增益 |
| --- | --- | --- | --- | --- |
| ngl99 + MTP | 7529 | 93% | **70.3** | 1.24×（vs 56.5） |
| ngl28 + MTP | 6808 | 84% | **42.5** | 1.38×（vs 30.8） |
| ngl24 + MTP | 6315 | 78% | **26.4** | 1.16×（vs 22.7） |

**结论**：
- MTP 净增益 1.16–1.38×，落在调研预测 1.2–1.6× 区间；**接受率 >50%（值得用 MTP 变体）**，本 heretic/merge 草稿头工作正常。
- MTP 额外显存 ~391 MiB（全 offload 7138→7529）。
- **MTP 在部分 offload 下收益更大**（ngl28 1.38× > 全 offload 1.24×）：CPU 层慢，MTP 并行验证摊薄 CPU 成本。
- 全 offload+MTP 最快（70.3 t/s）但峰值 7.5GB（93%，仅剩 ~594MiB），最挤。

## 留余量与速度的权衡（待用户决策）

| 取向 | 推荐配置 | 速度 | 峰值显存 | 空闲 |
| --- | --- | --- | --- | --- |
| 严格留余量（≤~6.5GB/78%） | ngl24 + MTP | 26.4 t/s | 6315 MiB | ~1.8GB |
| 平衡（~1.3GB 空闲） | ngl28 + MTP | 42.5 t/s | 6808 MiB | ~1.3GB |
| 极速（LLM 独占，ComfyUI 靠卸载） | ngl99 + MTP | 70.3 t/s | 7529 MiB | ~0.6GB |

注：ComfyUI 共存按 D8 为**自动卸载交接**（非同时运行），故 LLM 运行时无需为 ComfyUI 预留显存；留余量主要为系统稳定。上下文均 c8192；混合架构 KV 便宜（q8_0 32K≈0.53GB 推算），部分 offload 配置可再加上下文。

## T2 补充 · n_max 扫描与上下文扩展（ngl99 + MTP, 草稿 KV F16, 主 KV q8_0）

| n_max | ctx | 峰值显存 MiB | Generation t/s | 备注 |
| --- | --- | --- | --- | --- |
| 1 | 8192 | 7458 | 64.2 | |
| 2 | 8192 | 7529 | 70.3 | n_max 最优 |
| 3 | 8192 | 7547 | 64.6 | 长草稿收益递减 |
| 2 | 16384 | 7643 | 79.5 | 不 OOM；速度异常偏高（噪声） |
| 2 | 32768 | 7640 | 28.9 | 不 OOM；速度异常偏低（⚠️ 待复测） |

**用户选定：极速档 ngl99 + MTP（n_max2）**，ComfyUI 共存靠 D8 自动卸载交接。

## 可靠复测（固定提示 + -n512 + 多次重复，c8192, ngl99）

固定提示"详细解释 Transformer 注意力机制…"，-n 512：

| 配置 | run1 | run2 | run3 | 中位 |
| --- | --- | --- | --- | --- |
| MTP n_max2 | 69.5 | 66.4 | 68.3 | **68.3 t/s** |
| 无 MTP（对照×1） | 56.8 | — | — | 56.8 t/s |

**可靠结论**：极速档短上下文 **~68 t/s**（区间 66.4–69.5，±2 稳定）；**MTP 稳定 1.20×**（68.3/56.8），接受率 >50% 确认。此前 70.3/79.5 为单次短生成噪声，以本复测中位为准。

## 满上下文实测（长提示填满 KV，ngl99+MTP n_max2, q8_0 KV, 草稿 F16）

用 llama-tokenize 标定的长提示文件（单段 93 token）：

| ctx | 提示 token | Prompt t/s | Generation t/s | 峰值显存 MiB | 占用率 |
| --- | --- | --- | --- | --- | --- |
| 16384 | 14880（160段） | 3217.0 | **62.6** | 7449 | 92% |
| 32768 | 30690（330段） | 1129.3 | **23.2** | 7664 | 94%（剩~459MiB） |

**关键结论**：
- **速度随上下文长度显著下降**：c8192 ~68 → c16K满 62.6 → c32K满 23.2 t/s。混合架构省 KV **内存**（q8_0 32K≈0.5GB），但**注意力算力仍随 context 增长**，长上下文生成变慢。
- 批量 prompt processing 很快（c16K 3217 t/s），长提示首 token 延迟低。
- c32768 满上下文峰值 7664 MiB（94%），不 OOM 但极紧；桌面占用高时有 OOM 风险。
- 满上下文为单次测量（长提示固定，比短提示扫描可靠，但仍建议复测确认 c32K 的 23.2）。

### ⚠️ 测量方法局限（部分已改善）

1. **单次短生成噪声大**：以上为单次 `-n 128` 短生成、各次提示词不同 → MTP 接受率随提示词波动、连续多跑可能热节流，导致 c16384=79.5 / c32768=28.9 这类反常值。**不可作为定论**；正式结论需固定提示集 + 较长生成（≥512 token）+ 多次重复取中位 + 控制 GPU 温度。
2. **短提示未填满上下文**：峰值显存 ~7.5–7.6GB 主要是权重+缓冲+少量 KV，**未反映满上下文 KV 占用**。c32768 的真实满 KV 显存须用长提示（填满 32K token）实测；混合架构 q8_0 KV 便宜（32K≈0.53GB 推算），但须验证。
3. **桌面占用波动**：空闲显存随桌面负载在 ~6.3–7.0GB 间变，极速档（峰值 7.5GB）在桌面占用高时可能 OOM；须监测。
4. n_max2 在 c8192 稳定优于 1/3（70.3 vs 64），此结论相对可靠（同提示集趋势一致）。

## T6 · 卸载/重载 handoff（llama-server, ngl99+MTP n_max2, c8192, port8080）

- 冷加载到 `/health`=200：**~4456 ms（~4.5s）**；MTP draft context 正常创建（server.log `common_speculative_init_result`）。
- 桌面基线 802 MiB → 加载后 7203 MiB（模型占用 ~6401 MiB）。
- **停止 server 后显存回到 802 MiB，释放 6401 MiB，无残留**。
- **结论（D8 ComfyUI 交接可行）**：停 LLM server 可完全释放显存给 ComfyUI；重启冷加载 ~4.5s（mmap 页缓存热加载应更快）。进程退出同时释放 committed RAM（mmap 文件页转为可回收 standby 缓存）。
- 待补：RAM 释放定量测量、热重载时延、卸载期间会话/上下文状态保持（KVMem 会话缓存进程内有效、重启不恢复 [R0]；llama-server 会话状态须另测）。

## KVMem 长上下文（T4/T5，源码构建 llama.cpp 后端，9B 实测）

### 构建与部署（已完成）
- 工具链：CMake 4.4.4 + VS BuildTools 2022（MSVC 14.44）+ ninja 1.13.2 + **CUDA 13.5（nvcc V13.5.37）**，均 winget/CDN 安装。
- 源码：github git 协议被重置 → 经**本地代理 127.0.0.1:12000** clone 成功；子模块 llamacpp 固定提交 `cd959bae`。
- 坑：Windows `core.autocrlf=true` 致工作树 CRLF 化、prepare-backends 树哈希校验失败 → 子模块设 autocrlf=false + 删跟踪文件 + `checkout-index -f -a` 恢复 LF 后通过（cd959bae + 6 补丁）。
- 构建坑：① bash 展开 `$env:PATH` 致 PATH 未设、误用 VS 自带 CMake 3.31（不认 CUDA 13.5）；② CUDA_PATH 安装后写注册表、进程环境快照早于安装致 `$env:CUDA_PATH` 空。修复：.ps1 helper 里 Enter-VsDevShell 后置 CMake 4.4.4 于 PATH 最前 + 从注册表读 CUDA_PATH 传 -CudaPath。
- `build-backends.ps1 -Backend llamacpp -CudaArchitectures 120a`：**443/443 步成功**，产物 `llama-kvmem-server.exe`（91MB），部署到包 `workers/llamacpp/`。

### T4/T5 实测（普通 IQ4_XS，Context 131072 / GPU Budget 16384 / Reserve 2048 / Sink 8192 / Recent 1024 / HostMiB 8192 / KV q8_0）
- 服务器就绪：kvmem=1 method=retrieval，n_ctx=131072，GPU KV 预算 16384（其余分层 RAM）。
- 短提示贪心：连贯回答，decode ~51 t/s（首请求 cache miss）。
- **needle 召回（关键）**：~20294 token 长上下文（>16384 GPU 预算），唯一代号「紫晶-789」埋于 ~18600 token 深处 → **正确召回（NEEDLE_HIT=True）**，decode 47 t/s / prompt 1908 t/s / 耗时 11s，cache_reuse=own/continuation（前缀复用生效）。
- **显存锁定**：20K 上下文下峰值 **7299 MiB**（剩 593），GPU 占用被预算锁住、KV 历史在 RAM——**补上调研指出的"9B 仅形状级验证"缺口，9B 整模型 needle 召回实测通过**。

### KVMem vs standalone 长上下文对比
| 引擎 | 上下文 | decode t/s | 峰值显存 | 机制 |
| --- | --- | --- | --- | --- |
| standalone llama.cpp | 32K 满 | 23.2 | 7664 MiB(94%) | 全 KV 进显存，逼近 OOM |
| **KVMem llama.cpp 后端** | 20K（可扩 131K） | 47.0 | 7299 MiB | GPU 预算 16K，其余 KV 分层 RAM，needle 召回正确 |

**结论**：长上下文场景 KVMem 显著优于 standalone——显存被预算锁住（不随上下文涨）、decode 更快、needle 召回正确。代价：检索/回填开销（短上下文不如 standalone 裸跑）、会话缓存进程内有效（重启不恢复）。日常短中上下文用 standalone 极速档（~68 t/s），长文档/长推理用 KVMem。

## R3 · MTP 控制复测（2026-11-21，同模型、逐配置独立进程）

测量条件：RTX 5060 Ti 8GB、llama.cpp build 12445、c8192 / ngl99 / FA on / KV q8_0 / np1、固定中文提示、n=512、temperature 0、3 次取中位；ComfyUI 未运行；纯文本（未挂 mmproj）。由 `scripts/benchmark-local-llm.ts` 使用与桌面端相同的 `buildLocalLlamaArgs` 启动。

| 模型变体 | 配置 | 生成 t/s（3 次） | 中位 | 峰值显存 MiB |
| --- | --- | --- | ---: | ---: |
| MTP 变体 | 无 MTP | 60.3 / 60.3 / 60.2 | 60.3 | 7201 |
| MTP 变体 | MTP n_max2（首轮会话） | 64.5 / 64.0 / 64.7 | 64.5 | 7454 |
| MTP 变体 | MTP n_max2（复测会话 ×2） | 77.2 / 77.1 / 77.3；77.2 / 77.3 / 77.1 | **77.2** | 7472–7496 |
| 非 MTP 变体 | 无 MTP | 57.4 / 57.5 / 57.5 | 57.5 | 7219 |
| 非 MTP 变体 | MTP | 启动失败（模型无 MTP 层） | — | — |

**结论**：
1. **同一 MTP 模型上，MTP 稳态增益 1.28×**（77.2 / 60.3），两个独立会话复现，组内极差 <1%；首轮 64.5（1.07×）是离群，可能与紧接失败模型加载后的显存状态有关。
2. **旧记录 1.20× 混淆了模型变体**：68.3 是 MTP 模型启 MTP，56.8 接近非 MTP 模型的基线（本次 57.5）。同模型对照的真值是 1.28×；跨模型比较不成立。
3. **MTP 开关与模型必须匹配**：当前 profile 指向非 MTP 变体，开启 MTP 后 server 日志报 `model doesn't contain MTP layers` 并退出，表现为“启动超时”。这不是速度问题，是配置错误。
4. **显存代价约 +271–295 MiB**（7136 → 7472/7496），冷启动热缓存约 3.9–4.6 s；首次冷加载可到 44.9 s，属页缓存冷启动，不应与热启动并列比较。
5. Prompt t/s 不可比：同一会话内预热请求已命中前缀缓存，后续只处理 4 个新 token。

### 提示词维度对比（2026-11-21，MTP 开启 vs 关闭）

条件：同一 MTP 变体模型、纯文本（不挂 mmproj）、temperature 0 / seed 42 / max_tokens 260、每维 3 次取中位；profile 已切到 MTP 变体并开启 MTP。

| 维度 | 基线 t/s | MTP t/s | 提速 | 输出逐字一致 |
| --- | ---: | ---: | ---: | --- |
| 人物 + 场景 | 60.7 | 77.1 | 1.27× | 否（尾部措辞） |
| 专业摄影 | 60.7 | 65.7 | 1.08× | 否（尾部措辞） |
| 光影与材质 | 60.4 | 67.4 | 1.12× | 是 |
| 镜头与构图 | 60.2 | 74.9 | 1.24× | 是 |
| 动漫 Tags | 59.9 | 90.8 | 1.51× | 是 |
| 提示词润色 | 60.4 | 71.4 | 1.18× | 是 |
| 文字反推 | 60.8 | 60.7 | 1.00× | 是 |
| **总体中位** | **60.5** | **71.4** | **1.18×** | **5/7** |

- 提速与输出长度相关：Tags、构图等短输出维度增益 1.24–1.51×；文字反推（147 字符）几乎无增益。
- 两个维度出现尾部差异，均为等价措辞替换（`8k` → `8k resolution`；`natural skin tones` → `natural color grading`），token 重合度 92.9–95.2%；温度 0 下不保证逐字一致，但未观察到语义漂移。
- 显存（纯文本）：基线峰值 6522 MiB，MTP 6909 MiB（+387）；冷启动 4.0 s / 4.3 s。
- 连续启动必须等显存回落：一次未等待的测试出现显存不足，MTP 速度掉到 28 t/s；脚本现已内置 GPU 清理等待。

### 启动验证（profile 切换后）

- 隔离 profile 已改为 `...MAX-MTP-IQ4_XS.gguf` 且 `mtpEnabled: true`；原配置备份在仓库根 `local-llama.json.bak-20261121`。
- 用该 profile 启动（含 mmproj）：日志出现 `creating MTP draft context`，不再出现 `model doesn't contain MTP layers`；128 token 生成 65.7 t/s，峰值显存 7796 MiB（8 GB 卡上余量约 355 MiB）。
- 含 mmproj 的 MTP 配置显存很紧，桌面占用升高时有 OOM 风险；纯文本场景可不挂 mmproj（峰值 6909 MiB）。

## 待测（后续）

- T3 KV 量化质量（q8_0 vs f16）、T4 KVMem 9B identity+needle、T5 长上下文、T6 卸载/重载 handoff、T7 tok/s 指标面、T8 前缀复用、T9 长推理稳定性。
- MTP 接受率精确值与 n_max 1/2/3 扫描（当前仅 n_max2，增益已证 >50% 接受率）。
- 选定配置下的上下文扩展（c16384/32768）显存与速度。