# AI Provider / 模型接入 · git 修改历史（history · 占位）

> **派生 · 非权威 · 引用权威主题。** 本文是二开理解层的历史记录占位，不构成需求或实现约定。
> 权威需求与 API 基线见：[AI provider API 矩阵](../../reference/ai-provider-apis.md) · [系统规范](../../context/system.md) · [桌面行为](../../behavior/desktop.md)。
> 设计依据：[component-understanding-kb 设计](../../../changes/active/component-understanding-kb/design.md)（"待决 / 暂缓"节）。
> 现状文档：[flow.md](flow.md) · [architecture.md](architecture.md) · [todo.md](todo.md)。

## 状态：暂缓（明确的计划决定，非遗漏）

按第一批实施计划（[plan.md](../../../changes/active/component-understanding-kb/plan.md) "后续计划"节），**git 修改历史复现暂缓**：本批不回填任何历史条目，后续单独成计划，**按子系统聚合 `git log`**（以本文"范围界定"所列文件为路径过滤），再提炼为时间线与主题线。

在实质内容产出前，本文只保留章节骨架；**不写任何虚构历史**。需要追溯某处现状的来源时，直接对下列文件执行 `git log` / `git blame`，不要引用本文作为历史依据。

## 范围界定（后续聚合 git log 的路径过滤）

AI 模型 provider 线（与 [flow.md](flow.md) §0 划界一致）：

- `packages/core/src/ai-client.ts`、`packages/core/src/ai-config.ts`
- `packages/shared/utils/ai-protocol.ts`、`packages/shared/types/ai.ts`、`packages/shared/constants/ai.ts`
- `apps/desktop/src/main/ipc/ai.ipc.ts`、`apps/desktop/src/main/services/network-proxy.ts`
- `apps/desktop/src/preload/api/ai.ts`
- `apps/desktop/src/renderer/services/ai.ts`、`ai-request.ts`、`ai-chat-stream.ts`
- 后台 AI 功能入口：`packages/core/src/rules-rewrite.ts`、`apps/desktop/src/main/services/skill-safety-scan.ts`

不含 coding-agent 平台适配线（`agent-model-*`、`agent-provider-*`、`agent-qwen-definition*`，属 P1 子系统，历史随其四件套另行聚合）。

## 按时间（骨架，待后续计划填充）

<!-- 后续按 git log 聚合产出：时间段 / 关键提交 / 影响的行为变化 / 证据（commit hash + 文件:行号）。当前为空，不写虚构条目。 -->

（暂无条目——历史复现暂缓。）

## 按主题（骨架，待后续计划填充）

<!-- 候选主题（仅为后续聚合的分类框架，非历史结论）：协议推断与端点归一化 / apiKey 校验与本地端点 / 超时与流式 / 代理与网络边界 / token 参数兼容（#21、#9 等已有 issue 关联）。当前为空，不写虚构条目。 -->

（暂无条目——历史复现暂缓。）