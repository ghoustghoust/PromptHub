# MOSS-Image 布局画布：ComfyUI 侧集成问题交接

Status: review-pending
Product: Shared

本文件交接的是 **ComfyUI 工作流工程**（另一工程项目）的问题清单，不是 PromptHub 代码缺陷。PromptHub 只负责产出符合官方契约的 Layout JSON；JSON 之后如何进入模型、画布多大、如何采样，属于工作流侧责任。

结论先行：**JSON 正确 ≠ 布局生效。** 线框/HTML 预览只能证明框位，不能证明模型读到了这份 JSON。

## 1. 责任边界

| 环节 | 归属 | 交付物 |
| --- | --- | --- |
| 0–1000 编辑坐标、逐框描述、精确文字 | PromptHub | Layout JSON |
| 中心原点像素换算、`summary/items/bbox_coord_space/bbox_format` | PromptHub（已与官方节点逐字段对齐） | 最终 JSON |
| 模板选择、节点接线、尺寸、采样参数 | ComfyUI 工作流项目 | 可复现工作流 |
| 布局跟随质量、文字渲染、重叠处理 | 模型能力（SFT/Base、步数、CFG） | 验收结论 |

## 2. 官方契约（以本机源码为准）

节点实现：`ComfyUI/comfy_extras/nodes_moss_image.py:34-52`
文档：<https://docs.comfy.org/built-in-nodes/MOSSImageLayoutPrompt>

```python
for i, el in enumerate(element ...):
    label = "text" if el.get("type") == "text" else ("character" if i + 1 in characters else "object")
    item = {"label": label, "caption": el.get("desc", "")}
    if item["label"] == "text":
        item["text"] = el.get("text", "")
    if el.get("color_palette"):
        item["palette"] = el["color_palette"]
    y0, x0, y1, x1 = el["bbox"]
    item["bbox"] = [floor(y0*h/1000)-h//2, floor(x0*w/1000)-w//2,
                    ceil(y1*h/1000)-h//2,  ceil(x1*w/1000)-w//2]
    items.append(item)
if not items:
    return io.NodeOutput(prompt)          # 直通
layout = {"summary": {"caption": prompt.strip()}, "items": items,
          "bbox_coord_space": "abs_centralized", "bbox_format": "yxyx"}
```

三条必须记住的性质：

1. **`element` 为空时节点原样直通**，这是外部 JSON 生效的唯一干净通路。
2. **`element` 有框时，节点会用自己画布里的框重建 `items`**；贴进 `prompt` 的 JSON 只会被塞进 `summary.caption`。
3. 节点输出的 `summary` 只有 `caption`；但**官方 USERGUIDE 的 schema 里 `summary` 还包含 `canvas: "single"`（以及可选 `meta`）**。两者模型都接受，PromptHub 按 USERGUIDE 输出 `canvas: "single"`。

### 2.1 官方推理参数（USERGUIDE_ZH）

| 项 | 官方值 |
| --- | --- |
| 总像素 | 推荐 1M / 1.5M / 2M；可外推 0.25M（512×512）至 4M（2K） |
| 宽高 | **必须是 16 的正整数倍**，手动输入不符会直接报错 |
| Steps | **≥ 50** 最佳 |
| CFG | 默认 3.0，推荐 3.0–6.0；短 prompt 可上调 |
| Shift | 5.0 |
| Sampler | **Euler** |
| SLG | 标准 SLG scale 3 / 0.01–1.0；二次采样 SLG 用 layer **22**（24、26 亦有帮助） |
| 负面词 | `nsfw, worst quality, bad anatomy, watermark, jpeg artifact` |

模板默认的 25 steps / CFG 2.5 / `er_sde` 是提速档，与官方值不同；布局跟随偏弱时先按官方值复现。

关于 16 倍数：`720` 与 `1280` **本身都是 16 的倍数**（16×45、16×80），所以 `720×1280` 并不违反这条规则。它的问题是 `ResolutionSelector` 产不出这组数值（9:16 @1MP = 768×1360），导致画布与 latent 不一致。

模板默认值：

| 项 | `image_moss_image_t2i.json` | `image_moss_image_t2i_bboxes.json` |
| --- | --- | --- |
| `enable_prompt_enhancer` | **true** | false |
| `width` / `height` | 1024×1024 | 1024×1024，且**由 ResolutionSelector 链接驱动**（1 MP、1:1、multiple 16） |
| `character_boxes` | — | `"2"` |
| steps / cfg / sampler | 25 / 2.5 / `er_sde` | 同左 |

## 3. 失败原因清单（按概率排序）

### F1 · 用了普通 Text to Image 模板

该模板 `enable_prompt_enhancer = true`。提示词增强器（Qwen3.5 + 官方 enhancer system prompt）会把输入当作“粗糙想法”重写成英文 caption，官方文档明确写过开启后 **can drop the boxes**。

- 判定：`Preview Any` 里是一段散文，没有 `{`。
- 修复：改用 **MOSS-Image: Layout-Guided Text to Image**，或把 subgraph 的 `enable_prompt_enhancer` 关掉。

### F2 · JSON 贴进了 `prompt`，但 `element` 仍然连着画布框

节点会用模板自己的框重建 items，`summary.caption` 变成一整段 JSON 字符串。

- 判定：`Preview Any` 的 `items` 是模板里的示例框（骑士/花束那套），`caption` 里套着你的 JSON。
- 修复：把 `Create Bounding Boxes` → `MOSSImageLayoutPrompt.element` 的连线**断开**（0 框），让节点直通；或整体旁路该节点，JSON 直接进 `CLIPTextEncode` 的 prompt。

### F3 · 画布尺寸与实际 latent 不一致 — PromptHub 侧已关闭

`bbox` 是**以画布中心为原点的绝对像素**。差 24 px 就会整体偏移。

PromptHub 现在直接复刻 `ResolutionSelector.execute`（`comfy_extras/nodes_resolution.py`）：

```python
total = megapixels * 1024 * 1024
scale = sqrt(total / (w_ratio * h_ratio))
width  = round(w_ratio * scale / multiple) * multiple
height = round(h_ratio * scale / multiple) * multiple
```

`multiple = 16`，`round` 为 Python 的 half-to-even（不是 JS 的 half-up）。实测输出：

| 比例 | 1 MP | 1.5 MP | 2 MP | 4 MP |
| --- | --- | --- | --- | --- |
| 1:1 | 1024×1024 | 1248×1248 | 1456×1456 | 2048×2048 |
| 2:3 | 832×1248 | 1024×1536 | 1184×1776 | 1680×2512 |
| 3:2 | 1248×832 | 1536×1024 | 1776×1184 | 2512×1680 |
| 3:4 | 880×1184 | 1088×1456 | 1248×1680 | 1776×2368 |
| 4:3 | 1184×880 | 1456×1088 | 1680×1248 | 2368×1776 |
| 9:16 | 768×1360 | 944×1680 | 1088×1936 | 1536×2736 |
| 16:9 | 1360×768 | 1680×944 | 1936×1088 | 2736×1536 |
| 21:9 | 1568×672 | 1920×816 | 2208×944 | 3136×1344 |

要点：

- `9:16` 在 1 MP 下是 **768×1360**，不是 768×1344，也不是 720×1280。`720×1280` 已降级为自定义尺寸。
- 节点只提供 8 个比例，**没有 9:21**；PromptHub 预设已同步移除 9:21。
- 百万像素是变量，工作流侧只要把 `width`/`height` 两个 link 的实际值读出来，和 JSON 里的画布比即可判定。
- 推荐区间：官方为 **1 MP / 1.5 MP / 2 MP**，外推区间 **0.25 MP–4 MP**（ComfyUI 教程页转述 OpenMOSS USERGUIDE）。2 MP 以上属于外推，文字更清晰但布局稳定性下降。
- 剩余工作在工作流侧：`Empty Flux 2 Latent` 必须使用同一组数值，不能让 ResolutionSelector 之后再插一层缩放。

### F4 · 采样参数偏弱

模板是 25 steps / CFG 2.5 / `er_sde`（kijai 的提速档）。官方 Base 是 50 steps / CFG 3 / `euler`。布局跟随弱时常表现为“框位大致对但字糊、主体漫出框”。

- 修复：先按 50 / 3.0 / `euler` 出一张基准图，再决定是否回到提速档。

### F5 · 框本身难度过高

已在实测线框中确认：主体框 68%×68% 覆盖了 3、4、7 号三个文字框。重叠是允许的，但“骨架框裹住文字框”会让模型把文字并进主体。

- 修复：主体框收窄到实际轮廓；文字压在主体上时，让文字框与主体框只做部分相交，不要整块包含。

### F6 · 中间还有一层提示词改写

任何 LLM 节点、网关侧“提示词优化”、或 JSON 外面包了 ```json 代码块 / “以下是提示词：”前缀，都会让模型收到非 JSON 文本。

- 判定：直接对比 `Preview Any` 与你产出的 JSON 字符串是否逐字符一致。
- 修复：旁路所有改写节点；JSON 不要包代码块。

### F7 · 文本框缺排版信息或文字没进 `text`

- `text` 是逐字渲染的字符串，换行要用真实 `\n` 或真换行（官方提示：自动断行不一定落在你想要的位置）。
- `caption` 应写字体风格、颜色、载体、可读性；不要把文案抄进 caption 代替 `text`。

### F8 · `character_boxes` 与框号不匹配

模板默认 `"2"`。指向文字框的序号无效。若走节点自建 items 的路线，必须按实际绘制顺序核对；若走直通路线则该项无关。

## 4. 复现与验收

### 4.1 三步判定（先看 `Preview Any`）

| 看到的内容 | 结论 |
| --- | --- |
| 英文散文、无 `{` | F1：增强器开着 |
| 有 JSON，但 `items` 不是你的框 | F2：`element` 未断开 |
| 与你的 JSON 逐字符一致，图仍不对 | F3 / F4 / F5 |

### 4.2 最小复现工作流

1. `MOSS-Image: Layout-Guided Text to Image` 模板。
2. 断开 `element`，把 PromptHub JSON 粘进 `MOSSImageLayoutPrompt.prompt`。
3. `enable_prompt_enhancer = false`。
4. latent 尺寸 = JSON 画布尺寸。
5. 50 steps / CFG 3 / `euler`。
6. Queue，记录 `Preview Any` 文本 + 出图。

### 4.3 验收项

- [ ] `Preview Any` 与产出的 JSON 完全一致
- [ ] 出图尺寸等于 JSON 画布尺寸
- [ ] 每个文字框的字形、字号、位置落在框内，中英文逐字正确
- [ ] 主体框边缘没有把文字吞进主体
- [ ] 同一份 JSON 在 SFT 与 Base 两个 checkpoint 下都能复现（布局跟随差异需记录）
- [ ] 720×1280 与 ResolutionSelector 实际输出两种尺寸各跑一次，确认偏差量

## 5. 已知未验证

- ResolutionSelector 在 1 / 1.5 / 2 / 4 MP 下的输出已逐值实测并锁进单测（8 个比例 × 4 档，均 %16 == 0）。其余小数百万像素（如 0.7、2.5）未实测，但公式与节点一致。
- MOSS SFT 对“文字框整块落在主体框内”这种重叠的容忍度。
- 4K token 上限下，多个长 caption 的 JSON 是否会被截断（当前 9 框远未接近上限，但需长文场景复核）。

## 6. 与 PromptHub 的同步结论

PromptHub 侧已按官方 USERGUIDE 对齐：`summary` 输出 `canvas: "single"` + `caption`，角色框输出 `label: "character"`，`bbox` 采用 `floor/ceil + 中心原点`；画布预设已改为按 `ResolutionSelector` 公式计算（比例 × 百万像素，默认 1 MP），不再硬编码像素。因此后续排查应默认“JSON 与尺寸都正确”，优先检查 F1、F2、F4、F5。