# Host 级定时任务

[English](scheduled-tasks.md) | 中文

Host 级定时任务是 Host 进程持有、而非某个 Session 持有的持久化 Cron 作业。每次触发都在任务所属的工程目录中创建全新的 Session 和 Agent，因此无人值守的检查会留下自己的会话与审计行，而不会打断操作者正在进行的工作。会话内的 [Schedule](schedule.zh.md) 满足相反的需求：把提醒作为后续普通对话轮次送回活跃会话。组合方式与配置由[包 README](../../packages/schedule/scheduled-tasks/README.zh.md) 负责；本页记录持久化结构、派发规则和 Remote 面。

## 持久化记录

[`ScheduledTasks`](../../packages/schedule/scheduled-tasks/src/index.ts) 在 Host home 目录下维护两张 SQLite 表。`scheduled_tasks` 行保存作者填写的配置——名称、工程目录、Cron 规则、时区、Prompt、模型路由、可选 Agent Preset，以及并发与补跑策略——连同推导出的 `next_run_at` 和启用标志。`scheduled_task_runs` 行记录一次触发：所属任务、计划时刻、状态、Session 创建后的 Session id、结束时刻，以及失败码与消息。

`ScheduledTaskId` 与 `ScheduledTaskRunId` 是[品牌化 id](core.zh.md#branded-ids)。数据库版本 2 会把版本 1 写入的隐式 `default` Preset 标记迁移为空值，因此未设置的 Preset 表示使用部署默认值。

## 派发

单个唤醒计时器指向最早的已启用 `next_run_at`。触发时 `tick()` 为每个到期任务重新推导下次触发时间、接纳本次运行并重新布防计时器。`admit()` 执行任务的并发策略：`skip` 记录一条 `skipped` 运行，`queue` 追加一条 `pending` 运行，等当前运行结束后再启动。随后 `execute()` 校验工程目录、创建绑定该目录的 Session、选择任务模型、把运行记录为 `running` 并写入 Session id、布防 `maxRuntimeMs` 计时器，最后把任务文本作为 Prompt 发送。

完成状态来自共享的 `agent/status` 与 `agent/error` 事件，按 Agent id（在本 Harness 中即 Session id）关联。超过 `maxRuntimeMs` 的运行会被取消并记录为 `timed-out`；Host 重启会把中断的运行标记为 `failed` 且带 `host-restarted`；Agent 报错记录为 `failed` 并带上报的码与消息。错过的触发由 `missedRunPolicy` 控制：`run-once` 最多补跑一次，`skip` 直接丢弃。

## Remote 面

[`ScheduledTaskController`](../../packages/api/scheduled-task-controller/src/index.ts) 把该服务以 `scheduledTasks` 命名空间发布到 Host Remote 网关：`list`、`create`、`update`、`remove`、`setEnabled`、`runNow`、`cancelRun` 和 `runs`。每个方法都转发给服务并返回其已提交值，因此客户端从不自行推导调度状态。`runs(taskId, limit)` 返回最新计划在前的历史，`limit` 限定在 1..200，默认 50。控制器不持有状态、不做调度决策；任务配置、持久化、派发和运行历史都属于该服务。故障以带服务消息的 Remote 错误暴露：非法 Cron 规则、时区或必填字段在 `create`/`update` 时拒绝；任务有活跃运行时 `remove` 拒绝；任务已活跃时 `runNow` 返回一条 `skipped` 运行。

## 模型体验

两个服务都不注册工具、不注入 Prompt 片段、不产生模型可见事件。`ctx.scheduledTasks` 与 `scheduledTasks/*` Remote 命名空间对模型不可见；任务消耗的 token 只发生在它自己触发所创建的 Session 内，该 Session 的第一条用户消息正是配置的 Prompt。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxscheduledtaskcontroller--scheduledtaskcontroller"></a>

### `ctx.scheduledTaskController` — `ScheduledTaskController`

Host owner of the `scheduledTasks` Remote namespace.

```ts cordis-catalog
/**
 * Return every persistent task.
 * @returns the stored tasks, earliest next occurrence first.
 */
@Remote list(): ScheduledTask[]

/**
 * Create one task.
 * @param input - user-authored fields; invalid values reject with the service error.
 * @returns the stored task with its computed next occurrence.
 */
@Remote create(input: ScheduledTaskInput): ScheduledTask

/**
 * Update one task.
 * @param input - task id plus the fields to replace.
 * @returns the stored task with its re-derived next occurrence.
 */
@Remote update(input: ScheduledTaskUpdate): ScheduledTask

/**
 * Delete one idle task.
 * @param id - task identity; a task with an active run rejects.
 */
@Remote remove(id: ScheduledTaskId): void

/**
 * Enable or pause one task.
 * @param id - task identity.
 * @param enabled - whether the task may fire.
 * @returns the stored task after the change.
 */
@Remote setEnabled(id: ScheduledTaskId, enabled: boolean): ScheduledTask

/**
 * Start one independent execution immediately.
 * @param id - task identity.
 * @returns the admitted run, already `skipped` when the task is active under `skip`.
 */
@Remote runNow(id: ScheduledTaskId): ScheduledTaskRun

/**
 * Cancel one live execution.
 * @param id - run identity; a settled run is a no-op.
 */
@Remote cancelRun(id: ScheduledTaskRunId): Promise<void>

/**
 * Return bounded run history for one task.
 * @param taskId - task identity.
 * @param limit - maximum rows, bounded to 1..200; defaults to 50.
 * @returns the task's runs, newest scheduled first.
 */
@Remote runs(taskId: ScheduledTaskId, limit?: number): ScheduledTaskRun[]
```

Source: [`packages/api/scheduled-task-controller/src/index.ts`](../../packages/api/scheduled-task-controller/src/index.ts)

<a id="ctxscheduledtasks--scheduledtasks"></a>

### `ctx.scheduledTasks` — `ScheduledTasks`

SQLite-backed Host service for App-authored recurring Agent tasks.

```ts cordis-catalog
/**
 * List tasks ordered by next occurrence.
 * @returns every stored task, earliest next occurrence first.
 */
list(): ScheduledTask[]

/**
 * Create one persistent task and arm its first occurrence.
 * @param input - user-authored fields; invalid rules, zones, or required fields throw.
 * @returns the stored task with its computed next occurrence.
 */
create(input: ScheduledTaskInput): ScheduledTask

/**
 * Update one task without changing its identity or creation time.
 * @param update - task id plus the fields to replace.
 * @returns the stored task with its re-derived next occurrence.
 */
update(update: ScheduledTaskUpdate): ScheduledTask

/**
 * Enable or pause one task.
 * @param id - task identity.
 * @param enabled - whether the task may fire.
 * @returns the stored task after the change.
 */
setEnabled(id: ScheduledTaskId, enabled: boolean): ScheduledTask

/**
 * Delete one idle task and its retained run history.
 * @param id - task identity; a task with an active run is refused.
 */
remove(id: ScheduledTaskId): void

/**
 * Start one independent run immediately without moving its Cron anchor.
 * @param id - task identity.
 * @returns the admitted run, already `skipped` when the task is active under `skip`.
 */
runNow(id: ScheduledTaskId): ScheduledTaskRun

/**
 * Cancel one running scheduled execution.
 * @param id - run identity; a settled run is a no-op.
 */
cancelRun(id: ScheduledTaskRunId): Promise<void>

/**
 * List retained run history newest first.
 * @param taskId - task identity.
 * @param limit - maximum rows, bounded to 1..200; defaults to 50.
 * @returns the task's runs, newest scheduled first.
 */
listRuns(taskId: ScheduledTaskId, limit: number = 50): ScheduledTaskRun[]

/**
 * Observe committed task or run changes.
 * @param listener - called after a task or run row is committed.
 * @returns the disposer that stops the observation.
 */
onChanged(listener: ChangedListener): () => void
```

Source: [`packages/schedule/scheduled-tasks/src/index.ts`](../../packages/schedule/scheduled-tasks/src/index.ts)
<!-- END GENERATED cordis-surface -->
