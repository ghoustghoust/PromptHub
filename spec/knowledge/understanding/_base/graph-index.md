# graphify 图谱索引（8 组件图）

> 派生 · 非权威 · 引用权威主题。本文件是理解层的图谱底座索引，数据来自第一批 Task 1 建图实测（graphify 0.9.111，2026-11）。
> 入口见 [understanding/README.md](../README.md)。建图过程与健康诊断的过程记录为临时 SDD 草稿，不随仓库持久保存；所需数据已全量内联于本索引。

## 约定

- **GRAPH(C)**：组件 C 的图位于仓库根下 `graphify-out/C/graphify-out/graph.json`（`--out DIR` 会再追加一层 `graphify-out/`，已实测验证）。
- **零 token**：全部图仅 tree-sitter AST 提取（`--code-only --no-cluster`），无文档语义提取、无 LLM 社区命名。graph.json 顶层确有 `input_tokens` / `output_tokens` 字段，**token 计数恒为 0**（纯 AST）。
- **可再生、不进 git**：`graphify-out/` 已加入 `.gitignore`。图谱是缓存性底座，随时可用下方命令重建；本索引中的节点/边数是建图时快照，重建后可能随代码演进变化。
- **跨组件查询**：功能子系统（如 AI provider）横跨多个组件时，组合多张图分别查询（如 GRAPH(core) + GRAPH(desktop)）再对照读码；图与子系统不一一对应。

## 8 组件图清单（Task 1 实测）

| 组件 C | 扫描路径 | GRAPH(C)（相对仓库根） | 节点 | 边（原始 → post-build） | 健康警告 |
| --- | --- | --- | --- | --- | --- |
| db | `packages/db/src` | `graphify-out/db/graphify-out/graph.json` | 597 | 1249 → 1219 | 折叠边 30；自环 1；1 文件无符号（index.ts，纯 re-export） |
| core | `packages/core/src` | `graphify-out/core/graphify-out/graph.json` | 3749 | 12617 → 12425 | 折叠边 192；自环 33；6 文件无符号（index.ts、plugin-library.ts 等） |
| shared | `packages/shared`（含 tests） | `graphify-out/shared/graphify-out/graph.json` | 1440 | 2418 → 2359 | 折叠边 59；自环 5；8 文件无符号（constants/index.ts、部分 tests）；LICENSE 跳过 |
| desktop | `apps/desktop/src` | `graphify-out/desktop/graphify-out/graph.json` | 10431 | 31280 → 30957 | 折叠边 322；自环 41；30 文件无符号（见下方注意事项）；68 图片 + 3 CSS 跳过 |
| web | `apps/web/src` | `graphify-out/web/graphify-out/graph.json` | 1730 | 4768 → 4585 | 折叠边 183；自环 3；30 文件无符号（多为 tests、client/main.tsx）；index.css 跳过 |
| cloudflare | `apps/web-cloudflare/src` | `graphify-out/cloudflare/graphify-out/graph.json` | 301 | 1087 → 1024 | 折叠边 63；自环 0；5 个 test 文件无符号 |
| mobile | `apps/mobile/src` | `graphify-out/mobile/graphify-out/graph.json` | 172 | 425 → 415 | 折叠边 10；自环 1；1 test 文件无符号 |
| cli | `apps/cli/src` | `graphify-out/cli/graphify-out/graph.json` | 3 | 2 → 2 | 无健康警告；但 CLI 是薄壳（见下方注意事项） |

全部 8 图：悬空边 0、缺失端点边 0、完全重复边 0、unverified_code_nodes = 0。desktop 实测 **1000 个代码文件 / 10431 节点**（计划原估 990 文件，以实测为准），单图约 1 分钟建成，无需细分 main/renderer。

## 重建命令（8 条，零 token）

在仓库根执行；每条均带 `--code-only --no-cluster`（仅 AST、不聚类、无任何 LLM/token 消耗）：

```bash
graphify extract packages/db/src          --code-only --no-cluster --out graphify-out/db
graphify extract packages/core/src        --code-only --no-cluster --out graphify-out/core
graphify extract packages/shared          --code-only --no-cluster --out graphify-out/shared
graphify extract apps/desktop/src         --code-only --no-cluster --out graphify-out/desktop
graphify extract apps/web/src             --code-only --no-cluster --out graphify-out/web
graphify extract apps/web-cloudflare/src  --code-only --no-cluster --out graphify-out/cloudflare
graphify extract apps/mobile/src          --code-only --no-cluster --out graphify-out/mobile
graphify extract apps/cli/src             --code-only --no-cluster --out graphify-out/cli
```

健康诊断（可选，建图后核对悬空/缺失/折叠边）：

```bash
graphify diagnose multigraph --graph graphify-out/db/graphify-out/graph.json
```

## 查询示例（本地纯图计算）

以下 `GRAPH(C)` 替换为上表实际路径，如 `graphify-out/core/graphify-out/graph.json`：

```bash
# 关键词邻域查询（BFS 扩展；--budget 是本地输出截断预算，非计费）
graphify query "ai provider protocol" --graph GRAPH(core) --budget 800

# 两节点间路径
graphify path chatCompletion resolveAIProtocol --graph GRAPH(core)

# 单节点解释（邻居/关系）
graphify explain chatCompletion --graph GRAPH(core)

# 枢纽节点（god nodes）
graphify god-nodes --top 5 --graph GRAPH(core)
```

## 使用注意事项（Task 1 carry-forward，查询前必读）

1. **token 计数恒为 0**：graph.json 顶层有 `input_tokens`/`output_tokens` 字段，值恒为 0（纯 AST 提取）。不要据此误判"图中无 token 字段"。
2. **CLI 图几乎为空（3 节点 / 2 边）**：`apps/cli/src/index.ts` 仅 5 行，转发 `runCli` 到 `@prompthub/core`。**查 CLI 行为用 GRAPH(core) 的 `packages/core/src/cli/`**（agent-command、ai-config-command、mcp-command 等），不要依赖 GRAPH(cli)。
3. **desktop 有 30 个无符号文件**：含 `apps/desktop/src/main/database/{folder,prompt,rule,schema,skill}.ts` 等。这些文件在图中只有文件级节点、无内部符号节点，**查询其内容需回退直接读源码**。其余组件的无符号文件多为 index.ts / tests（见上表）。
4. **折叠边（raw multi-edge 信息有损）**：post-build 图为 DiGraph，同端点的多关系边（如 imports_from + re_exports）被合并为一条（db 30 / core 192 / shared 59 / desktop 322 / web 183 / cloudflare 63 / mobile 10）。做精确关系类型分析时需知悉此损失，必要时回读源码确认关系种类。
5. **shared 扫描范围含 tests**：shared 图扫描整个 `packages/shared`（含测试代码）；其余 7 个组件均限定 `src`。查询 shared 时注意区分测试符号与产品符号。
6. **`query --budget` 是本地输出截断预算，非 API 计费**：命中数可能远大于展示数（实测 "ai provider protocol" 在 budget 800 下命中 180、展示 26）。查不全时用更精确关键词（如 `normalizeProtocol`、`resolveAIProtocol`）、提高 budget 或加 context_filter 收窄。
7. **图谱可再生、已 gitignore**：`graphify-out/` 不进 git；换机器或图谱过期时用上方重建命令再生，无需手工搬运。