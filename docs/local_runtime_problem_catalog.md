# HOPI 本地运行问题目录

状态日期：2026-07-24

代码快照：`main` / `57045c0a10eb96829d4148b0d3d6d6929e24d57f`

用途：让一个没有聊天背景、但能阅读代码和本地 HOPI 记录的 Agent，能够从症状直接定位到事实记录、责任层和第一批应检查的代码。

这不是原始日志副本，也不是“所有失败都算 HOPI 缺陷”的清单。Reviewer 发现下游业务代码不满足验收条件，本来就是正常工作；供应商网络断流也不等于 Coordinator 有 bug。本文把重复出现的记录归并为问题族，并明确区分：

- **HOPI 缺陷**：编排、上下文、工具、状态、投影或恢复逻辑有问题。
- **下游问题**：被执行 Project 的代码、依赖、凭据或外部审批有问题。
- **外部故障**：模型供应商、网络、浏览器或软件源不可用。
- **历史记录**：Attention 和 Run 是不可变审计事实；旧记录仍存在，不代表当前仍阻塞。

## 1. 证据范围与路径约定

本次读取了当前 Assistant Home 中所有可发现的运行记录，并与 `main` 上 2026-07-11 之后的修复历史和当前源码交叉核对。

| 事实源 | 数量 | 主要内容 |
| --- | ---: | --- |
| Inbox 文档 | 356 | 用户消息、Attention 通知、Reflection handoff |
| Workspace Attention | 32 | Assistant、Project、Provider 级阻塞与处理结果 |
| Goal Attention | 94 | Planner、Generator、Reviewer 对具体 Work 的阻塞、恢复和完成建议 |
| Role Attempt | 489 | Planner 126、Generator 230、Reviewer 133 次执行的上下文和结果 |
| Reflection | 402 | 后台状态判断、handoff 和供应商故障 |
| Assistant Turn | 354 | 对话输入、工具调用、最终回复和失败 |
| Preview Session | 31 | Project prepare、启动日志、surface 和停止状态 |

路径别名：

- `<assistant-home>`：当前 Home 的 `.hopi` 根。先从运行时配置读取真实路径，不要硬编码某个用户名。
- `<managed-root>/<repo>/projects/<project>/integration`：Project × Repo binding 的受管 release 投影。
- `<goal-root>`：primary integration 下的 `.hopi/docs/goals/<goalId>`。
- `<run-root>`：`<assistant-home>/runtime/runs/<runId>`。

完整下钻方式：

- 对话：`<assistant-home>/docs/assistant/inbox/<eventId>.md`
- Workspace Attention：`<assistant-home>/docs/attention/<attentionId>.md`
- Goal/Work/Attention/Evidence：`<goal-root>/{goal.md,work,attention,evidence,inputs}`
- Role Run：`<run-root>/{attempt.json,context.md,prompt.md,result.json,events.jsonl,transcript.log,repos.json}`
- Reflection：`<assistant-home>/runtime/assistant/reflections/<reflectionId>/`
- Assistant Turn：`<assistant-home>/runtime/assistant/turns/<eventId>/`
- Preview：`<assistant-home>/runtime/preview/<projectId>/<previewId>/`

不要从 `transcript.log` 的一句自然语言直接推断根因。优先级是：canonical 文档和 Git > `attempt.json` / `result.json` > 结构化 events > transcript 叙述。

本次检查时 `hopi-auto` 还有另一条工作流留下的未提交修改，主要集中在 Assistant Attention、Workspace 和 Coordinator 文件。下文的“已修复”只以已提交的 `57045c0` 及其祖先为准；那些未提交修改不作为已交付证据。

## 2. 当前仍需处理的事实

以下不是旧 Attention 的残留，而是在快照时仍为 open 或状态不一致的记录。

| ID | 当前事实 | 发生位置 | 首查代码 |
| --- | --- | --- | --- |
| O-01 | 两个 Codex Assistant Turn 因 response stream 断开而失败，Workspace Attention 已通知但未解决。 | `A-event-EV-30e8…`、`A-event-EV-d5eb…`；对应 Turn 目录 | `agent/vendorTransport.ts`、`assistant/workspaceAssistant.ts` |
| O-02 | 一条用户消息携带已经失效的 `replyTo`，同一事件先产生一个已解决 Attention，后又产生一个未解决 Attention。 | `A-event-EV-ed896…-fbf7069b…` | `assistant/assistantAttentionQueue.ts`、`domain/assistantWorkspace*.ts`、`assistant/assistantTools.ts` |
| O-03 | 搜索 E2E Work 已提交候选代码，但当前 Run 没有 `HOPI_FORMAL_RELEASE_PREVIEW_FILE`，所以没有 current-release 浏览器证据。 | MystoreMyBusiness / `G-8db…` / `failure-verify-search-browser-harness-r2…` | `runtime/roleContextStager.ts`、`runtime/previewManager.ts` |
| O-04 | “创建权限” Goal 的正式 Preview 在 primary prepare 阶段失败，后续共享四 surface 不能启动。 | `G-调整消息中心创建权限错误返回与发送放行/attention/recover-primary-prepare-then-shared-preview.md` | Project 的 `scripts/hopi/prepare`，以及 `runtime/projectPreparation.ts` |
| O-05 | “role 通用筛选” Goal 的 Preview Work 与当前 release 在 `scripts/hopi/prepare` 发生合并冲突。 | `G-重构消息中心-role-为通用角色筛选逻辑/attention/sync-expose-four-role-filtering-preview-surfaces-…md` | `runtime/sourceMergePreflight.ts`、`runtime/stableWorktreeManager.ts` |
| O-06 | 一个 2026-07-21 启动的 Reflection manifest 仍为 `running`，但它显然已跨越多次进程重启。 | `RF-704d5cb1-7a2c-4ab3-ba40-420ebc34c342` | `assistant/assistantReflection.ts` 的启动恢复和 manifest 终结 |

O-01 属于外部传输故障加恢复体验问题；O-03～O-05 是当前 Project 工作事实；O-02 和 O-06 是可复现的 HOPI 状态问题。

## 3. HOPI 产品问题族

### 3.1 Agent 执行、工具和权限

| ID | 发生过什么 | 根因/判断 | 状态与证据 | 第一代码位置 |
| --- | --- | --- | --- | --- |
| H-01 | Claude/OpenCode 多次只返回 `exit code 1`，没有 stderr；另有空 Assistant message。Workspace Attention 只能重复说“无错误详情”。 | 供应商进程失败和 transcript 归一化没有保留足够诊断。 | 历史上 22 个 Role 类似失败；Reflection 中 9 次 Claude opaque exit、10 次空消息。`e7acfd4`、`7c67049` 增强诊断和多供应商执行，但外部失败仍可能发生。 | `agent/vendorTranscript.ts`、`agent/vendorAssistantOutput.ts`、`assistant/workspaceAssistant.ts` |
| H-02 | Codex/ChatGPT 出现 502、stream disconnected、sending request 失败；失败会留下 open Workspace Attention。 | 外部流式传输故障；HOPI 可以恢复，但不能假装消息已被处理。 | 17 个 Role issue-like Attempt、80 个 Reflection 失败、2 个 Assistant Turn 失败；当前 O-01 仍 open。 | `agent/vendorTransport.ts`、`runtime/runAttemptStore.ts`、`assistant/workspaceAssistant.ts` |
| H-03 | Generator 被配置为 ChatGPT 账户不支持的 `gpt-4.6-terra`，同一 Work 连续失败。 | 配置可被保存，但启动前没有验证 transport/account/model 组合。 | 历史 2 次；不是代码执行失败。配置入口和运行前校验仍应共同检查。 | `agent/vendorTransport.ts`、`assistant/workspaceAssistant.ts`、Project agent settings |
| H-04 | OpenCode 没成功加载 HOPI MCP 后，模型退化为 shell/curl，并自行猜测 `http://localhost:8333/api/...`；端口无人监听，Goal/Attention 操作没有发生。 | 环境没有暴露正确工具，模型根据旧上下文猜了控制面。`8333` 不是 HOPI authority，只是模型臆造的本地 API 地址。 | 真实证据在 Turn `EV-d465…`、`EV-bcf4…`、`EV-97f7…`、`EV-cda2…`。`e7acfd4` 增加 OpenCode MCP startup 验证。 | `assistant/workspaceAssistant.ts::validateOpencodeMcp`、`assistant/hopiMcpServer.ts` |
| H-05 | OpenCode 把 `step start`、`step finish` 和整行 vendor JSON 投影给用户；模型也长期输出 JSON 而不是完成任务。 | Provider 生命周期事件和协议载荷被当成有意义消息；prompt 又过度强调结构化结果。 | `e7acfd4` 抑制 lifecycle noise，`c7ef3bb` 让 outcome 由适配层确定，`f2f1190` 澄清输出协议。历史原始事件保留在 `EV-3481…/events.jsonl`。 | `agent/vendorTranscript.ts::normalizeOpencodeEvent`、`agent/vendorAssistantOutput.ts` |
| H-06 | Codex、Claude、OpenCode 对 shell、外部目录、依赖安装、ffmpeg 的权限表现不一致；模型把环境限制误判为业务阻塞。 | 权限以前由零散白名单和 vendor 特判决定，环境事实没有统一呈现。 | `6328eac` 删除大量权限特判；`e7acfd4` 引入 Project-scoped full access、OpenCode 校验和有界默认。Project 开关默认关闭，开启后传给 transport。 | `agent/vendorTransport.ts`、`storage/projectAgentAccessStore.ts`、`frontend/lib/projectAgentAccess.ts` |
| H-07 | “放开所有权限”曾被实现为越来越多的规则，而不是一个清晰环境开关；用户难以判断当前 Agent 到底能做什么。 | 权限是执行环境属性，却被散落在 prompt 和命令拼接中。 | 已收敛为 Project 级 `fullAccess`；仍要警惕重新引入工具白名单。 | 同 H-06；设计见 `mvp_assistant.md` 和 `multi_vendor_agent_support.md` |
| H-08 | 责任 Agent 写出空 `result.json`、缺失结果，或进程成功但 HOPI 无法判定 outcome。 | 把协议正确性寄托在模型“记得写 JSON”。 | `c7ef3bb` 改为 transport/runner 确定性收口；Attempt 仍保留旧 `responsibility wrote an empty result.json` 证据。 | `agent/vendorAssistantOutput.ts`、`agent/vendorTransport.ts`、Role runner |
| H-09 | 长命令曾被截断、并行重复启动；一个慢检查会被误认为卡死后再起一份。 | command 生命周期和 Run 生命周期没有一一对应。 | `87db308` 保留长命令，`f68a600` 串行化 responsibility shell，`e9eec00` 阻止重复长校验。 | `agent/vendorTransport.ts`、`scheduler/projectReconciler.ts` |

### 3.2 Assistant 上下文、会话和能力认知

| ID | 发生过什么 | 根因/判断 | 状态与证据 | 第一代码位置 |
| --- | --- | --- | --- | --- |
| H-10 | 单一 Assistant session 在不同 Project 间切换，回答像只看最新一句，前一 Project 语境污染后一 Project。 | Home 级 vendor session 同时承担多个 Project 会话；上下文压缩没有稳定 scope。 | `3915e15` 将 session 按 Project scope 隔离。跨 Project 参考仍可通过显式 Project ID 和 state 工具读取，而不是共享隐式会话。 | `assistant/assistantConversationScope.ts`、`assistant/assistantConversationStore.ts`、`workspaceAssistant.ts` |
| H-11 | 压缩上下文只有摘要，没有全文文件地址；Agent 无法自行复核原始记录。 | 为节省 token 丢掉了可追溯入口。 | `7c67049` 保留完整诊断路径；`a107211` 在 compact state 中保留 candidate preflight。当前 conversation history 仍有字符预算，必须确保被裁剪内容留有文件指针。 | `assistant/workspaceAssistant.ts::boundedConversationHistory`、`assistant/assistantState.ts`、`assistant/assistantTools.ts` |
| H-12 | Assistant 说“已创建 Goal”，但 canonical Goal 实际不存在；或者只有自然语言承诺，没有工具效果。 | 旧创建工具契约没有要求首个 Planning Work，也没有把 effect 回读作为 authority。 | `0b58d9b` 要求创建时显式首 Work；`010db75` 澄清工具；工具结果现在返回 canonical effect。 | `assistant/assistantTools.ts`、`runtime/goalController.ts` |
| H-13 | Assistant 说“环境没有 GitHub/SCM 提 PR 能力”，但责任 Agent 实际可以在 Work 环境中执行通用交付动作。 | 把 conversation sandbox 的能力误当成 Engineering Work 环境能力；prompt 过度列举 Git 操作。 | `4204896` 区分 conversation 与 work 环境，后续 prompt 改为描述通用执行能力而非教具体 Git if/else。 | `assistant/workspaceAssistant.ts`、`runtime/roleContextStager.ts` |
| H-14 | Assistant/Reflection 被大量 playbook 和特判驱动，遇到新问题就机械地 request user、重试或补任务。 | Coordinator 和 prompt 试图替模型做判断，规则超过红线范围。 | `663ac00`、`343c45f`、`a4a1c00` 删除规则并改为“环境、目标、后果”。继续修改 prompt 时应守住这个方向。 | `runtime/roleContextStager.ts`、`assistant/workspaceAssistant.ts`、`scheduler/projectReconciler.ts` |

### 3.3 Attention、Retry、Reflection 和完成通知

| ID | 发生过什么 | 根因/判断 | 状态与证据 | 第一代码位置 |
| --- | --- | --- | --- | --- |
| H-15 | `request_user` 的名字让模型以为“调用后系统会询问并暂停”，但它本质是把一个已存在 Attention 的所有权转给用户；早期调用后调度仍继续。 | 工具名称、持久化 effect 和调度后果不一致。 | 语义在 `865fb6d`、`69ce830`、`cd44824` 中重做；当前源码仍名为 `hopi_request_user`，属于仍可优化的命名债务。 | `assistant/assistantTools.ts`、`assistant/hopiMcpServer.ts`、`domain/canonicalDocuments.ts` |
| H-16 | 旧 Attention 一直存在就被 Reflection 当成当前失败，导致“reprojection still missing”等误判反复出现。 | 历史文档和当前 live diagnostic 混为一体。 | `926b88e` 分离 live diagnostics 与 Attention history，`c7eebd7` 让 Reflection 以当前状态为准，`c6842a7` 去掉 phantom reprojection。 | `assistant/assistantState.ts`、`assistant/assistantReflection.ts` |
| H-17 | Retry 曾触发新的规则分支、重复 Attention 或重复 Work；解决 Attention 后 Work 仍可能不运行。 | Retry 被当成另一个流程，而不是同一 Work authority 的新尝试。 | `69ce830` 统一 retry Attention lifecycle；现在 retry 保留 Work identity，并由 `retryRunId` 表示 pending。 | `assistant/assistantTools.ts`、`domain/canonicalDocuments.ts`、`scheduler/projectReconciler.ts` |
| H-18 | 用户没有回答 Needs you，Agent 却继续执行；另一端又出现 Assistant 自己能修的问题也被标成 Needs you。 | “通知”“用户拥有”“Work 阻塞”曾共用同一个 Attention 状态。 | 当前由 `operatorRequest`、`retryRunId`、target 和 `resolvedAt` 推导不同后果；`request_user` 只应转交真正外部决策。 | `domain/workProjection.ts`、`domain/canonicalDocuments.ts`、`runtime/attentionDelivery.ts` |
| H-19 | Background Reflection 连续 3 次 handoff 不收敛，产生 Workspace Attention；常见底层原因是相同 Planner failure、Chrome/npm 阻塞或脏 integration 被重复叙述。 | Reflection checkpoint 只看全局 digest，Project A 的变化会吞掉 Project B 的通知，也会对同一 scope 反复触发。 | 6 个 Workspace Attention 属于此类；`0f53b3a` 按 conversation scope 隔离 checkpoint。O-06 表明进程重启后的 `running` manifest 终结仍需补齐。 | `assistant/assistantReflection.ts`、`assistant/assistantState.ts` |
| H-20 | Expert Mirror 所有 Work 已 terminal，却没有发 completed；Mystore/NSO completion 会互相影响。 | Reflection 使用 Home 全局 checkpoint，先处理一个 Project 后把另一个 Project 的完成状态一起记为已见。 | `0f53b3a` 已修复并有 scope 回归测试。 | `assistant/assistantReflection.ts::reflectionScopeSnapshots` |
| H-21 | 8 个 Assistant Turn 因“回复没有包含 Evidence artifact 的 operatorUrl”被强制判失败，即使模型的完成判断本身正确。 | 把回复格式当成完成正确性的硬规则，违反“让模型判断”的设计原则。 | `c32fb4e` 删除该完成规则并信任 Assistant judgement；旧 Turn 仍保留失败记录。 | `assistant/assistantTools.ts`、`assistant/assistantState.ts` |
| H-22 | Needs you 数字可见但点了没反应，或数字与 Assistant 面板实际列表不同。 | Header、feed stream 和 Attention query 各自维护投影与 cursor。 | `4473e29` 让数字点击形成精确 reply，`66b0e8d` 统一 Attention 投影。 | `frontend/components/AssistantPanel.tsx`、`frontend/lib/useAssistantFeedStream.ts`、`frontend/lib/assistantContext.ts` |
| H-23 | 新消息错误沿用旧 `replyTo`，被校验为“not an active operator request”；同一事件还可生成重复 Attention。 | UI/queue 把“当前正在回复的 Attention”当成后续独立消息默认上下文，且去重只覆盖已解决实例。 | 当前 O-02，尚不能算已修复。 | `assistant/assistantAttentionQueue.ts`、`domain/assistantWorkspaceDocuments.ts`、`frontend/lib/assistantContext.ts` |

### 3.4 Goal、Work 和 Coordinator 状态

| ID | 发生过什么 | 根因/判断 | 状态与证据 | 第一代码位置 |
| --- | --- | --- | --- | --- |
| H-24 | 后端读取一个只有目录、没有 `goal.md` 的 Goal 时直接抛错，API 打出 `Invalid Goal … goal.md is missing`。 | “不存在”和“包存在但非法”没有类型化区分，路由把前者当服务器错误。 | `4cf2b09` 增加 missing/invalid 区分和 API 测试。 | `domain/goalPackage.ts`、`storage/goalPackageStore.ts`、`mvpServer.ts` |
| H-25 | Planner/Reviewer 提案中的 Work ID、路径、Attention frontmatter 错误会让整个 Project fail closed。 | proposal validation 错误越过 Attempt 边界，污染 canonical Project 状态。 | 真实记录包括 path owns Evidence ID、missing YAML、operatorRequest invalid、Reviewer 写了不允许的文件。后续改为普通 failed/invalid Attempt；canonical 包不受影响。 | `runtime/passOutcomeCoordinator.ts`、`domain/goalPackage.ts` |
| H-26 | `cancelWork` 最初不自动中断正在跑的责任进程；Planner 后来又把 cancelled Work 排回来；取消一个节点还让其他任务看似被文档污染。 | Work 文档状态和 Run 进程是两套 authority，取消语义没有明确依赖闭包。 | `dc6343e` 强化进程组取消；`9a31bd9` 分离 Work/Run authority；现在只取消目标及其**非终态依赖后继**，并逐一 `interruptRuns`，不会删除历史。 | `runtime/goalController.ts::cancelWork`、`assistant/assistantTools.ts::cancelWorkAndSettle`、`scheduler/projectReconciler.ts` |
| H-27 | Planner 完成后重新创建/恢复已取消 Work，或修改已有依赖导致 DAG 非单调。 | Planner 被允许重写历史任务身份和 dependency semantics。 | `923eb77` 明示 dependency monotonicity；`passOutcomeCoordinator.ts` 对 cancellation closure 和 transition 做确定性校验。 | `runtime/passOutcomeCoordinator.ts`、`domain/goalPackage.ts` |
| H-28 | Reviewer `success` 曾被理解为“本轮检查成功”而不是“Work terminal”，导致 Work 提前 done；反过来，完成条件满足时 Coordinator 又因固定规则拒绝 completion。 | result 名称同时承担 pass outcome 与 Work lifecycle。 | `560c9ff` 区分 Generator/Reviewer completion，`afacd5d` 把 Reviewer success 保留给 terminal Work，`c32fb4e` 删除 Assistant completion 兜底规则。 | `runtime/passOutcomeCoordinator.ts`、`scheduler/projectReconciler.ts` |
| H-29 | Coordinator 针对某个失败内置大量自动重排、重试、replan 和补 Work 规则，造成循环和错误外部阻塞。 | 编排层替 Agent 做了语义决策。 | `343c45f` 大幅简化 responsibility boundary，`b0b3b88` 只规定“纠正工作回到 Planning”的 authority 边界。 | `scheduler/projectReconciler.ts`、`scheduler/coordinatorReconciler.ts` |
| H-30 | Run 目录存在就被视为 active，重启后旧目录或旧 snapshot 让 UI/Coordinator 认为任务仍运行。 | 派生缓存覆盖了 Attempt manifest authority。 | `05f3b74` 让 `attempt.json` 成为 Run state authority。Reflection 的 O-06 是相邻但尚未完全覆盖的 manifest 恢复问题。 | `runtime/runAttemptStore.ts`、`scheduler/coordinatorReconciler.ts` |

### 3.5 Repo binding、release 和 worktree

| ID | 发生过什么 | 根因/判断 | 状态与证据 | 第一代码位置 |
| --- | --- | --- | --- | --- |
| H-31 | 不同 Project 不能绑定同一 Git commonDir，Assistant 要求“迁移所有权”；Expert 同时服务 MystoreMyBusiness 与 NSORebateFunding 时创建失败。 | Repo 被建模为 Project 独占资源，release ref 和 integration path 又是 Repo 全局的。 | `00f55b0` 把关系改为多对多 binding：`hopi/project/<projectId>/release` 和 `projects/<projectId>/…` worktree。 | `storage/assistantHomeStore.ts`、`runtime/managedWorktreePaths.ts`、`runtime/stableWorktreeManager.ts` |
| H-32 | HOPI 修改或校验用户 checkout 的 delivery branch；checkout 在 `main` 而预期 `fix/*` 会让 Project blocked。 | 用户 checkout 被误当成交付投影。 | `4e567f5` 先降为 nonblocking，`00f55b0` 的 v4 binding 删除本地 delivery projection。 | `storage/assistantHomeStore.ts`、`runtime/completionVerifier.ts` |
| H-33 | Work 的 `repos` 子集漏掉 RFID；Reviewer 被明确禁止发现未列入 `repos.json` 的 sibling Repo，于是同一 Preview Work反复报 missing RFID。 | Project 已知完整 topology，却让每个 Work 人工维护一个限制性子集。 | `dba52db` 改为每个 Work 获取完整 Project Repo 集合；`dba52db` 之后的文档/代码删除 Work repo 白名单。 | `runtime/roleContextStager.ts`、`domain/projectDocument.ts` |
| H-34 | 同一 Work 的 task checkout、integration 和 release 不在同一 Project namespace；迁移后仍有旧 `/<repo>/work/...` 路径和新路径并存。 | v1-v3 路径是 Repo 级，v4 是 binding 级；本地还保留历史 worktree 以便恢复。 | `00f55b0` 包含幂等迁移。旧目录存在不是当前 authority，应通过 `projects.yml` 和 Git ref 判定。 | `storage/assistantHomeStore.ts::migrateManagedWorktrees`、`runtime/managedWorktreePaths.ts` |
| H-35 | task checkpoint 触发 husky/lint-staged/commitlint，或直接执行仓库依赖的 Yorkie runner，导致 HOPI 内部 checkpoint 失败。 | 内部快照误用了用户仓库的普通 commit hook 环境。 | Workspace Attention 有 NSO commitlint 和 Mystore Yorkie 两例；当前 checkpoint 使用隔离身份并跳过 hooks，诊断由 `7c67049` 保留。 | `runtime/taskCheckpoint.ts` |
| H-36 | managed integration 出现未追踪 E2E 文件后，C1 exact-materialization 校验连续创建多个 Project Attention。 | 受管 release 投影被其他进程写脏，恢复只报告，不自动重建。 | Mystore 有 6 个重复 Project Attention。`b415693` 让 managed repo execution self-recovering；用户 checkout 不参与。 | `runtime/stableWorktreeManager.ts`、`runtime/coordinatorBootstrap.ts` |
| H-37 | 当前 candidate 已经可合并，但 Assistant state 丢失 `candidateIntegration`，Reflection 误报 frontend reprojection missing。 | compact `hopi_read_state` 删除了判断所需字段。 | `e180e7a`、`d2142ef` 暴露 candidate state，`a107211` 保留 compact preflight，`c6842a7` 去掉错误叙述。 | `assistant/assistantState.ts::readCandidateIntegration`、`assistant/assistantTools.ts` |
| H-38 | prepare 在 Generator task root 存在，Reviewer 却从旧 integration adapter 路径查找并说 missing；Repo rebind 后相同问题复发。 | prepare routing 与 binding root 不同源。 | `b415693` 改进修复；`57045c0` 把 rebind 做成透明命令并重物化 binding。历史 `prepare-adapter-routing-mismatch.md` 是代表记录。 | `runtime/projectPreparation.ts`、`storage/assistantHomeStore.ts`、`commands/projectCommandRunner.ts` |

### 3.6 Preview、浏览器与完成证据

| ID | 发生过什么 | 根因/判断 | 状态与证据 | 第一代码位置 |
| --- | --- | --- | --- | --- |
| H-39 | 一个 Project 有发件端、收件端、host 等多个 UI，但 Preview 只有单一 URL，用户点 Preview 看不到其他 surface。 | Preview readiness 只有 `HOPI_PREVIEW_URL` 标量。 | `59e4acb` 支持 `HOPI_PREVIEW_SURFACES`，UI 可选择 surface；保留 primary URL 兼容入口。 | `runtime/previewManager.ts::parsePreviewSurfaces`、`frontend/pages/ProjectHomePage.tsx` |
| H-40 | Expert Mirror Preview 只有静态前端，页面显示 “Authoritative backend unavailable”，没有 rebate/workflow/permission 数据。 | Preview adapter 没启动 RFID authority，也没有可信 bootstrap；早期甚至用 synthetic data 让 UI 看起来可用。 | 这是 Project adapter 缺陷，也是 HOPI completion contract 缺口。后续 NSO Preview 记录显示 frontend + isolated RFID bridge 均返回 200。 | Project `scripts/hopi/preview`；HOPI `runtime/previewManager.ts` |
| H-41 | Preview 看起来“能打开”就被当作完成证据，或者直接用 task candidate/旧浏览器 tab 验收，不是正式 release。 | ready URL、release provenance 和 Goal 行为证据没有绑定。 | `3cebd69` 要求 usable Preview，`d55cf27` 要求 formal release Preview provenance，`5d7e398` 要求证据实际展示 Goal。 | `runtime/previewManager.ts`、`runtime/roleContextStager.ts::validateFormalReleasePreview`、`runtime/completionVerifier.ts` |
| H-42 | 点击 Preview repair 先走 Planning，导致一个纯环境修复生成多余 Planner Work；硬编码“直接 Engineer”又会把未来问题限制死。 | UI/Coordinator 替模型预选修复类型。 | `5584acb` 的长期方案是把 repair facts 交给 Assistant，由 Assistant选择已有 Work、Engineering 或 Planning。 | `mvpServer.ts /api/preview/repair`、`assistant/assistantTools.ts` |
| H-43 | Browser Harness 要求用户打开 Chrome remote debugging；没回答时 Goal 卡住。另一批 Run 又因 Chrome 累积 renderer 或 tab 泄漏超时。 | 用户浏览器和 HOPI 可管理的自动化浏览器没有分层。 | `aa28758` 新增 managed browser 与 operator browser 两种环境；E2E tab ownership/cleanup 记录在 `e2e_test_issues.md`。 | `runtime/browserEnvironment.ts`、`runtime/roleContextStager.ts` |
| H-44 | Preview 启动缺 `HOPI_REPOS_FILE`、`HOPI_RUN_SCRATCH`、`HOPI_CACHE_DIR`；prepare 某 Repo missing；或启动后写缓存污染 source tree。 | adapter 所需环境、可写 runtime 目录和 source-clean 后果没有统一契约。 | 代表记录：Mystore `preview-d1bb…`，NSO `preview-a1e5…`，role Run `R-311229…`。`974ecde` 让 startup feedback 可恢复，后续 formal Preview context 明确 runtime dirs。 | `runtime/previewManager.ts`、`runtime/projectPreparation.ts`、`runtime/roleContextStager.ts` |

## 4. 下游 Project 与外部环境问题

这些问题真实发生过，但修复位置主要不在 `hopi-auto`。接手者应先读对应 Goal 的 design、Work 和 Evidence，不要用 HOPI 规则绕过验收。

### 4.1 game-assets-skill

| Goal | 问题 | 位置/现状 |
| --- | --- | --- |
| 生成 spritesheet | 早期 Assistant 没安排 Engineer、环境权限不足；最终 PNG 经 Reviewer 证明为 8 帧 1024×128，Goal 已完成。 | `<goal-root>/G-生成像素风角色向右移动-spritesheet` |
| spritesheet 转视频 | ffmpeg/子进程曾受环境限制；最终使用本机可解码路径生成 8 sample、12 FPS 的 MOV，Goal 已完成。 | `G-将像素风角色-spritesheet-转成视频预览` |
| 本地 Wan 2.2 Animate | canonical design 缺失；macOS arm64 没有 decord 包；Torch 下载极慢且未完成；模型/依赖 revision 不能猜。 | `G-本地部署测试-wan-2.2-animate/attention/*`，仍未完成 |

### 4.2 MystoreMyBusiness：搜索 E2E

- npm proxy 对 registry 返回 403，Playwright 不能安装；同时自动化 Chrome 未运行。这两个旧外部阻塞后来被已有 Browser Harness 替代。
- Reviewer 还发现过真实业务缺陷：`skip_impl_filter` 未跨 Application → Domain → repository 边界透传，以及搜索投影需要 current release 浏览器验证。
- 当前唯一 open 技术事实是 O-03：正式 release Preview provenance 文件缺失，不能拿旧 tab 或 task candidate 冒充完成证据。

路径：`<goal-root>/G-8db81b26-a9cc-45d1-900f-9dd7120a6955`。

### 4.3 MystoreMyBusiness：role 通用筛选

- Project topology 最初漏掉 MyBusiness 收件后端，Planner 因而连续 10 余次要求用户在 “MyStore only / 两端” 间选择。根因不是产品需求不清，而是 Repo context 不完整。
- 后续加入完整 Repos 后，Reviewer 找到的真实代码问题包括：角色数组对 falsey/超长/control characters 放行、SQL rollback 非无损、Element Plus `update:modelValue` + `change` 双触发使选择回到 All。
- MyBusiness Spring smoke 曾因 Apple Secrets TLS trust 缺失失败；这是环境能力，不应自动升级为产品需求决策。
- Preview 曾缺 Browser/CDP 权限、写 Babel cache 到 source tree、缺 frontend reprojection；前两者分别由 browser environment 和 runtime cache 契约解决，reprojection 是 H-37。
- 当前是 O-05：`scripts/hopi/prepare` 的 release/candidate 合并冲突。

路径：`<goal-root>/G-重构消息中心-role-为通用角色筛选逻辑`。

### 4.4 MystoreMyBusiness：summary 上限

- FrontEnd `dev` 的 `package.json` 与 `pnpm-lock.yaml` 不一致，frozen install 失败。系统多轮错误地把“先合入 lockfile PR”当成唯一外部路径，后来用户接受了组合 PR，旧 Attention 因而全部 superseded。
- primary、ReceiverServer、ExpertAgent、EnchanteAgent、FrontEnd 的 base branch 在 `main`/`dev` 间多次变化；硬编码 delivery branch 会产生假阻塞，这也是 H-32 的直接来源。
- `document-summary-contract` 在多个 Repo 写入 setup-only `scripts/hopi/prepare`，与 release 中真实 adapter add/add 冲突；正确处理是新 Work identity，而不是丢弃累计 delta。
- 发生过 unsupported model、prepare routing mismatch、Yorkie checkpoint、invalid Attention frontmatter。
- Goal 最终以用户选择的 PR heads 和通过的边界测试完成；旧 external-merge Attention 只是历史。

路径：`<goal-root>/G-扩充消息-summary-上限并拒绝超长输入`。

### 4.5 MystoreMyBusiness：创建权限

- Reviewer 找到 `user_list` 授权不是 all-or-nothing 的真实缺陷：只验证成功解析的部分 recipient，却可能发送给原始完整列表。
- 当前业务测试证据仍有效，但正式 Preview 因 primary prepare 失败而为 zero surfaces；O-04 是当前恢复入口。

路径：`<goal-root>/G-调整消息中心创建权限错误返回与发送放行`。

### 4.6 NSORebateFunding：custom resubmit

- 最初的业务歧义是合法的：允许重提的拒绝状态、复用/新建 ticket、审批重启点、可编辑字段和权限边界均无 authority，`A-custom-resubmit-business-contract` 的用户决策有必要。
- Project context 两次漏掉 RFID，Reviewer 无法验证三 Repo prepare；这是 H-33，不是 RFID 源码缺失。
- Reviewer 找到真实业务代码问题：客户端 `user_id` 被当成可信创建人、frontend 跨 session response race、drawer close invalidation、Box URL userinfo/port 边界。
- 第一版 Public Preview 没有 authoritative backend；之后又出现“不能凭空发明 issuer/JWKS/broker/credential/inventory”的正确安全阻塞。最终本地 release Preview 使用隔离 RFID bridge 验证了业务 journey，不能把 synthetic UI 当正式业务数据。
- Goal 已完成，旧 `missing-rfid` 和 `backend unavailable` Attention 是演进历史。

路径：NSO primary integration 下的 `<goal-root>/G-允许重新提交-custom-类型的项目`。

### 4.7 NSORebateFunding：withdraw

- Reviewer 找到 active flow 含合法 `return` action 时 evaluator 错误拒绝，以及 frontend stale generation 的真实缺陷。
- formal Preview manifest 曾缺 release heads；surface JSON 先后出现仅 `name`、`name+url`、`id+name+url`，推动了 H-39/H-41 的契约收敛。
- Work 已有完成 Evidence；若 UI 未发 completed，应按 H-20 检查 Reflection scope，而不是再创建 Engineering Work。

路径：`<goal-root>/G-允许撤回未审批的项目`。

## 5. 哪些记录不是当前 bug

- `attempt.json` 中 `result=reject` 多数是 Reviewer 正常发现下游候选不满足验收，不应改 Coordinator 让它通过。
- `application=stale` 表示 publication 时 release/authority 已变化，正常做法是用新上下文重新判断，不是强行套旧结果。
- `status=interrupted` 多数来自 Coordinator shutdown、新用户输入、cancel 或更高优先级 Run。只有进程仍存活、manifest 不终结或重复发布时才是 bug。
- 已解决 Attention 仍保留是审计要求。判断是否阻塞要看 `resolvedAt`、`operatorRequest`、`retryRunId` 和当前 state，而不是文件是否存在。
- Preview prepare 日志里的第三方 warning、项目自己打印的 `ERROR` 字样不一定让 prepare 失败；以顶层 `Status:`、exit code、ready surface 和 source-clean 结果为准。

## 6. 接手 Agent 的最短检查路径

1. 先读本文的 O-01～O-06，确认问题是否仍存在，不要从 94 个 Goal Attention 猜当前状态。
2. 用 `projects.yml` 找 Project 的完整 Repo topology 和 binding root。
3. 读目标 `goal.md`、最新 Planning Work、所有非终态 Engineering Work，以及 open Attention。
4. 对具体 Run 先读 `attempt.json`、`context.md`、`result.json`、`repos.json`；需要供应商细节时再读 `events.jsonl`/`transcript.log`。
5. 对 Preview 同时核对 release heads、project prepare、`preview.log`、surface probe 和浏览器 Evidence。
6. 只有确认属于 HOPI 层后，才从表中的“第一代码位置”进入源码。下游业务 reject 不要靠放宽 HOPI 校验解决。
7. 修改设计时优先删除规则、补环境事实或补工具职责；只有安全、执行边界和持久化不变量使用确定性红线。

相关权威文档：

- [MVP Assistant](./mvp_assistant.md)
- [MVP Execution](./mvp_execution.md)
- [MVP Multi-Repo](./mvp_multi_repo.md)
- [MVP Document Model](./mvp_document_model.md)
- [E2E Issue Log](./e2e_test_issues.md)
