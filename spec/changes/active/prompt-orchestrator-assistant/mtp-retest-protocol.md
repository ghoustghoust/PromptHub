# R3 · MTP 控制复测协议

## 一、为什么需要这份协议

现有两份记录互相矛盾：

- `spec/knowledge/understanding/ai-provider/benchmark-results.md` 的控制复测记录为「MTP ngl99 中位 68.3 t/s、无 MTP 56.8、1.20×」。
- design.md 早期记录为「MTP 仅 4.6–5.5 t/s」，另一处表述为「ComfyUI 占用时 5.5 t/s」。

两者测量条件不同（是否加载 ComfyUI、上下文长度、提示长度、flags、是否同一会话），不能直接用其中一个否定另一个。在统一真值之前，不锁定「仅用 MTP」或「仅用非 MTP」。

本协议只规定**怎样测才算数**，不预设结论。

## 二、前置条件

1. **ComfyUI 与任何其他 GPU 任务已停止**，桌面显存占用尽量接近空载。
2. 待测端口（默认 8080）没有被 PromptHub 自己的本地引擎占用；脚本检测到已就绪会自动放弃，不会杀进程。
3. 模型文件支持 MTP 草稿解码；mmproj 可选，纯文本复测不需要。
4. 固定提示：默认使用脚本内置提示；如需与旧记录对齐，用 `--prompt-file` 指向同一份长提示。
5. 每次配置都由脚本单独启动 server，结束后由脚本终止；不要中途手动启停。

## 三、执行命令

仓库根目录：

```
apps\desktop\node_modules\.bin\tsx.cmd scripts\benchmark-local-llm.ts ^
  --exe D:\tools\llama.cpp\llama-server.exe ^
  --model <模型.gguf> ^
  --ctx 8192 --ngl 99 --draft-max 2 ^
  --configs baseline,mtp --runs 3 --n-predict 512
```

- 脚本调用 `buildLocalLlamaArgs`，与桌面端实际启动参数一致；不要在命令里另加 flags，否则测的不是产品路径。
- 输出目录默认 `outputs/mtp-benchmark-<日期>/`，含 `report-<时间>.md`、同名 `.json` 与两份 `*-server.log`。
- 只测已运行服务、不启动进程时：

```
apps\desktop\node_modules\.bin\tsx.cmd scripts\benchmark-local-llm.ts ^
  --attach http://127.0.0.1:8080 --label mtp --runs 3 --n-predict 512
```

attach 模式无法确认服务端 flags，只用于抽查，不作为最终真值。

## 四、判定规则

一次有效的复测必须同时满足：

- 两个配置各 3 次有效生成，`finish_reason` 正常，无 OOM、无 server 退出；
- 同一提示、`temperature=0`、`max_tokens=512`；
- 3 次结果的极差不超过中位的 10%；
- 冷启动与峰值显存两列均已记录。

按生成 t/s 中位比较：

| 比值 | 处置 |
| --- | --- |
| ≥ 1.15，且两组区间不重叠 | 采纳 MTP 为默认，记录增益与额外显存 |
| 1.05–1.15 | 暂不改默认，次日再测一次；两次同向才采纳 |
| < 1.05 | 关闭 MTP 默认，记录反例 |
| 任一配置 OOM | 该配置无效，先降低 ngl 或 ctx，再复测 |

显存约束单独记录：MTP 额外占用超过 600 MiB 时，即使速度达标也要写明“极速档 / 平衡档”的取舍。

## 五、记录与回填

- 复测完成后，把 `report-*.md` 的数字补进 `benchmark-results.md` 新增一节，注明日期、flags、提示、3 次原始值与中位。
- 同时更新 `direction-reference.md` §6 的 R3 行：写明本次使用的 ComfyUI 状态、MTP 开关、结论与未决项。
- 不修改历史记录；矛盾以“同一条件复测”的方式解决，而不是删掉旧数字。

## 六、边界

- 本协议只覆盖生成吞吐与显存，不评估输出质量；质量由 A/B/C 出图对照负责。
- 单次会话内的前缀缓存会让 Prompt t/s 偏高，不能拿来比较冷缓存速度。
- 温度、驱动版本、桌面占用都会影响结果；跨天比较前先看 GPU 与驱动是否变化。
- 峰值显存是 250ms 采样值，不是驱动级峰值；只用于量级判断。
