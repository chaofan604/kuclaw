# Agent Note: Host 级定时任务

Status: implemented

[English](2026-09-16-host-scoped-scheduled-tasks.md) | 中文

## Problem

桌面 App 需要周期性的无人值守工作：运维者选择工程目录、写 Cron 规则和任务 Prompt、选择模型，并期望 Host 按计划在该目录中以该模型运行这段 Prompt，同时为每次触发保留可审计的结果。已有的会话内 [Schedule](../../../../packages/schedule/schedule/README.zh.md) 能力解决的是另一个问题：它的提醒唤醒同一个活跃会话，因此把它复用于周期性工程工作会让每次触发都追加到同一个会话里，导致上下文和 token 成本持续累积、不同日期的工具结果混在一起、一次失败影响下一次，并且没有可供重试或审计的每次触发身份。Host 中没有任何东西拥有持久化 Cron 配置，而 App 页面完全不涉及模型，因此模型工具不是正确的入口。

## Decision

Host 拥有两个新包。[`@deepseek-ai/dsh-scheduled-tasks`](../../../../packages/schedule/scheduled-tasks/README.zh.md) 是 `ctx.scheduledTasks` 服务：它把 `ScheduledTask` 和 `ScheduledTaskRun` 行存入 Host 拥有的 SQLite 文件，依据五字段 Cron 规则加显式 IANA 时区推导 `nextRunAt`，为最早的已启用触发布防一个唤醒计时器，执行每个任务的 `skip | queue` 并发策略，并在加载时应用 `skip | run-once` 补跑策略。[`@deepseek-ai/dsh-api-scheduled-task-controller`](../../../../packages/api/scheduled-task-controller/README.zh.md) 把同一服务以 `scheduledTasks` 命名空间绑定到 Remote 网关，让 App 页面通过既有 Host 传输访问它。桌面组合在 `apps/desktop-host/config/desktop.cordis.patch.yml` 中插入这两行，Shell 的页面通过 IPC 调用 `scheduledTasks/*`；该服务从不作为模型工具暴露。

## 运行身份与隔离

一次触发就是一条 `ScheduledTaskRun` 和一个新 Session。`execute()` 检查工作目录是否为目录，以 `{ cwd }` 创建 Session，并且只在任务保存了显式覆盖值时才传入 `agentPreset`；随后在该 Session 上选择任务模型，把运行记录为 `running` 并写入 Session id，布防最大运行时长取消，再把任务文本作为 Prompt 发送给该 Session。没有覆盖值时，由部署的 Agent Preset 名册解析其已配置的默认值；数据库版本 2 会把版本 1 的隐式 `default` 标记迁移为空的持久化表示。完成状态来自共享的 `agent/status` 与 `agent/error` 事件，按 Agent id 关联，在本 Harness 中 Agent id 即 Session id。由于每次运行都开启全新 Session，历史长度、工具结果、失败和 token 成本都不会跨触发传递，而保留的 Session id 让 App 能打开产生某次结果的确切执行。运行的工作目录和模型路由来自任务，Agent Preset 则来自任务覆盖值或部署默认值。

## Cron 与时区契约

规则有五个字段 —— 分、时、日、月、周 —— 并且总是与时区一起存储；同一条规则没有时区就无法说明 `0 1 * * *` 是北京、UTC 还是主机本地时间。规则在 `create` 和 `update`（配置边界）处校验，而不是在触发时盲目信任，`nextRunAt` 通过 `Intl.DateTimeFormat` 沿该时区的墙钟逐分钟搜索，这使结果在夏令时切换和主机休眠后仍然正确。当日和星期都受限时，二者按 Cron 约定以 OR 组合。持久行保存 epoch 毫秒；时区名和规则是配置，不是派生状态。

## Alternatives considered

**复用会话内 Schedule 能力。** 它的提醒按设计重新进入同一个活跃会话，其持久状态就是所属 Session 的日志。让它启动新 Session，要么为现有消费者改变该契约，要么在一个会话内插件里重复实现启动路径。

**在 Electron 主进程里调度。** App 已经持久化会话并且能拉起 Harness，在那里放计时器代码更少；但它也会把 Cron 状态、派发和运行历史放进 Shell，使 App 成为执行事实的来源，并让 Harness 无法以 headless 方式运行同样的任务。

**暴露模型工具而不是服务。** 运维者填的是表单；创建路径中不存在模型调用，因此工具会让 UI 工作白白绕一圈经过模型。工具仍然是基于同一批服务方法的可选未来 Consumer，而不是第二套实现。

**采用 Cron 库。** 一个受维护的解析器会删掉 `src/cron.ts` 的大部分，但所需子集只是五字段加 IANA 时区，持久格式与校验留在包内，解析器也有确定性测试覆盖；为删掉的这些行给一个 vendored Host 包增加运行时依赖并不划算。

## Consequences

周期性工程工作现在以隔离、可审计的 Session 运行，App 可以创建和观察它而不涉及模型。代价记录在各包 README 中：派发位于 Host 进程内，因此重启会把被中断的运行标记为 `failed` 且带 `host-restarted`，并且无法恢复；补跑最多为每个错过的任务补一次；`maxRuntimeMs` 是硬性取消上限而非单步超时；每个 Remote 方法都是一元调用，因此运行进度需要轮询；还没有桌面组合的端到端测试 —— 包测试覆盖 Cron 数学以及针对假 `sessionController` 的服务生命周期。
