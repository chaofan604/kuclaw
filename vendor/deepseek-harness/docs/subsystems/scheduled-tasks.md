# Host scheduled tasks

English | [中文](scheduled-tasks.zh.md)

Host scheduled tasks are durable Cron jobs owned by the Host process instead of by a Session. Every firing creates a fresh Session and Agent in the task's project directory, so an unattended check leaves its own conversation and audit row rather than interrupting whatever the operator is doing. The session-local [Schedule](schedule.md) seam answers the opposite need: a reminder that returns to the live conversation as an ordinary later turn. The [package README](../../packages/schedule/scheduled-tasks/README.md) owns composition and configuration; this page records the durable shapes, the dispatch rules, and the Remote surface.

## Durable records

[`ScheduledTasks`](../../packages/schedule/scheduled-tasks/src/index.ts) keeps two SQLite tables in the Host home directory. A `scheduled_tasks` row holds the authored configuration — name, project directory, Cron rule, time zone, prompt, model routing, optional Agent Preset, and the concurrency and missed-run policies — together with the derived `next_run_at` and the enabled flag. A `scheduled_task_runs` row records one firing: the task it belongs to, the scheduled instant, the status, the Session id once a Session exists, the finish instant, and the failure code and message.

`ScheduledTaskId` and `ScheduledTaskRunId` are [branded ids](core.md#branded-ids). Database version 2 migrates the implicit `default` Preset marker written by version 1 to the empty value, so an unset Preset means the deployment default.

## Dispatch

One wake timer points at the earliest enabled `next_run_at`. When it fires, `tick()` re-derives the next occurrence for every due task, admits the run, and re-arms the timer. `admit()` applies the task's concurrency policy: `skip` records a `skipped` run, and `queue` appends a `pending` run that starts once the active run settles. `execute()` then validates the project directory, creates a Session bound to it, selects the task's model, records the run as `running` with the Session id, arms the `maxRuntimeMs` timer, and sends the task text as the prompt.

Completion is read from the shared `agent/status` and `agent/error` events keyed by Agent id, which is the Session id in this harness. A run that exceeds `maxRuntimeMs` is cancelled and recorded as `timed-out`; a Host restart marks interrupted runs `failed` with `host-restarted`; an Agent error is recorded as `failed` with the reported code and message. Missed occurrences are governed by `missedRunPolicy`: `run-once` fires at most one catch-up, and `skip` drops them.

## Remote surface

[`ScheduledTaskController`](../../packages/api/scheduled-task-controller/src/index.ts) publishes the service as the `scheduledTasks` namespace on the Host Remote gateway: `list`, `create`, `update`, `remove`, `setEnabled`, `runNow`, `cancelRun`, and `runs`. Every method forwards to the service and returns its committed value, so the client never derives scheduling state. `runs(taskId, limit)` returns newest-scheduled-first history with `limit` bounded to 1..200 and defaulting to 50. The controller owns no state and makes no scheduling decisions; task configuration, persistence, dispatch, and run history all belong to the service. Failures surface as Remote errors carrying the service message: an invalid Cron rule, time zone, or required field rejects at `create`/`update`, `remove` rejects while a task has an active run, and `runNow` returns a `skipped` run when the task is already active.

## Model experience

Neither service registers tools, injects prompt sections, or emits model-visible events. `ctx.scheduledTasks` and the `scheduledTasks/*` Remote namespace are invisible to the model; the only tokens a task spends are inside the Session its own firing creates, whose first user message is the configured prompt.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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
