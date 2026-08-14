# HOPI 后端核心代码导读

状态：当前实现导读
更新时间：2026-08-14

HOPI 后端只有两类判断：Assistant 做语义判断，确定性内核执行受约束的状态变化。理解
代码时先守住这条边界，不要寻找 Planner、Generator、Reviewer 或 Kanban 阶段；它们已不
属于当前模型。

## 端到端主线

```text
用户 / 系统事件
  -> Inbox（持久化）
  -> Project Assistant（读状态、理解、调用工具）
  -> Goal / Work / Attention / Run 命令
  -> Publication Coordinator（CAS + 整包校验）
  -> Scheduler 只启动已显式排队的 Run
  -> Worker 在受控 workspace 中执行并写 Report
  -> Attempt settled
  -> Wake Assistant 判断下一步
```

Assistant 的回复、Worker 的 Report 都是文本；只有身份、DAG、claim、生命周期、workspace
和发布边界使用结构化数据。

## 领域权威

- [`canonicalDocuments.ts`](../packages/backend/src/domain/canonicalDocuments.ts)：Goal、Decision /
  Engineering Work、Input、Attention、Evidence 的 schema 与 Markdown 编解码。
- [`goalPackage.ts`](../packages/backend/src/domain/goalPackage.ts)：整包不变量、DAG、生命周期、
  新 Goal 的首个 Work 与可选 Map。
- [`workProjection.ts`](../packages/backend/src/domain/workProjection.ts)：从权威文档、Attempt 和
  Attention 派生 `ready / queued / running / needs_user / waiting_assistant / blocked`。
- [`goalPackageStore.ts`](../packages/backend/src/storage/goalPackageStore.ts)：文件路径、整包读取和
  原子发布入口。

Work 只有 `decision | engineering` 和 `open | done | cancelled`。依赖关系存成 id 数组，校验
时对图做环检测；Route 布局、焦点和历史折叠都只是投影，不写回文档。

## Assistant 与 Wayfinder

- [`workspaceAssistant.ts`](../packages/backend/src/assistant/workspaceAssistant.ts)：Project 级可轮换
  会话、上下文重建、原生 fork/compaction，以及尽量保持原文的 Wayfinder 行为提示。
- [`assistantToolSchemas.ts`](../packages/backend/src/assistant/assistantToolSchemas.ts)：最小语义工具面。
- [`assistantToolExecutor.ts`](../packages/backend/src/assistant/assistantToolExecutor.ts)：工具到受控命令
  的映射；它不替模型决定下一步。
- [`assistantState.ts`](../packages/backend/src/assistant/assistantState.ts)：给 Assistant 的有界状态投影。

Map 只是 `design/index.md` 的低分辨率索引。Decision 的完整问题和 Resolution 在 Work 文档；
Engineering 是明确可执行边界。Assistant 先创建 Work、再连依赖，显式请求 Run，Run 结算后
再判断是否完成、重试、review、改图或提 Attention。

## Run 与 Worker

- [`runRequest.ts`](../packages/backend/src/runtime/runRequest.ts)：不可变请求，只有 workspace mode、
  指令和引用。
- [`projectReconciler.ts`](../packages/backend/src/scheduler/projectReconciler.ts)：Run admission、队列
  启动、结算、Engineering 完成入口；不自动生成语义后续动作。
- [`runAttemptStore.ts`](../packages/backend/src/runtime/runAttemptStore.ts)：Attempt manifest、事件、
  Report、诊断和恢复。
- [`workerContextStager.ts`](../packages/backend/src/runtime/workerContextStager.ts)：冻结当前 Goal / Work、
  Repo manifest、引用和执行边界。
- [`WorkerRunner.ts`](../packages/backend/src/agent/WorkerRunner.ts)：Codex / Claude / OpenCode / process
  的统一执行器。

`workHash` 是 Work assignment 的 SHA-256。排队、启动、结算和 Route 投影都用它判断 Report 是否
仍对应当前权威；契约或依赖变化后，旧 Attempt 只保留为历史证据。

## Git 与 C1

`isolated_write` 为每个 Engineering Work 准备稳定 task worktree。Run 结束先 checkpoint 候选
源码，但这还不是正式交付。Assistant 接受证据并调用完成后，
[`c1Integrator.ts`](../packages/backend/src/runtime/c1Integrator.ts) 校验当前 Work hash、task head 和
Project release，把多 Repo 源码与 `Work open -> done` 放进一个可恢复的 C1 边界。

主 release ref 移动前的冲突是普通拒绝；移动后的故障根据可达 C1 恢复，不能伪装回滚。

## 从哪里调试

1. 读 Goal、Work、Map 和 Attention，确认 canonical authority。
2. 读 Attempt manifest 的 `workHash / status / termination / reportMarkdown`。
3. 比较当前 `workAssignmentHash`，判断旧 Report 是否已失效。
4. 读 Run 的 `prompt.md`、`context.md`、`transcript.log` 和诊断。
5. 若 Engineering 完成失败，再查 task heads、C1 marker 和 Project release ref。
6. UI 不一致时查 [`goalPresenter.ts`](../packages/backend/src/api/goalPresenter.ts) 的 Route 投影，
   不要向 Work 文档补展示字段。

## 核心不变量

- 新 Goal 恰好带一个首个 Work；Decision-first 必须有 Map，Engineering-first 不得有 Map。
- Work id、kind、createdAt 与终态历史不可改；开放 Work 的依赖必须仍是 DAG。
- 旧 contract revision 的 Work 不会被静默改投。
- 一个活跃 Attempt 或一个 Work Attention 才构成 claim。
- settled Run 永不自动完成 Work，也不自动重试。
- Decision completion 与 Map gist 更新原子发布；Engineering completion 必须经过 C1。
- provider session、Route 坐标、进度动画和摘要都不是权威。
