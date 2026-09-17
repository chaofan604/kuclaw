---
description: "Host-scoped persistent scheduled tasks: durable Cron rules that launch a fresh Session and Agent per occurrence, for operators who create and audit recurring work from the desktop App."
kind: "package-reference"
---

# @deepseek-ai/dsh-scheduled-tasks

English | [中文](README.zh.md)

## Summary

Use `ctx.scheduledTasks` to save Cron-based project work with an explicit time zone, workspace, model, and prompt plus an optional Agent preset override. An omitted preset uses the deployment default. Each occurrence starts a fresh Session, records its status and Session id, and never reuses prior conversation history. Choose it for unattended, auditable checks; use session-local [Schedule](../schedule/README.md) when a reminder must return to the current conversation. The desktop App calls this service directly, so no model tool is registered.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Compose this service in a Host composition that provides `sessionController`, and give it a `databasePath` inside the harness home:

```yaml
- id: scheduled-tasks
  name: '@deepseek-ai/dsh-scheduled-tasks'
  inject:
    - sessionController
  config:
    databasePath: !!js dshHomePath('scheduled-tasks.sqlite')
    maxRuntimeMs: 86400000
```

`create` validates the name, workspace path, prompt, model route, Cron rule, and time zone, then arms the first occurrence. `update` re-derives the next occurrence whenever the rule or zone changes. `setEnabled` pauses and resumes without deleting history; `remove` deletes an idle task together with its runs; `runNow` starts one execution immediately without moving the Cron anchor. `cancelRun` settles a queued run without disturbing the active execution, or cancels the Session owned by a running entry. `listRuns(taskId, limit)` returns newest-first history, and `onChanged` reports committed task or run changes to Host surfaces.

### When to choose it

Choose this service when recurring work must run unattended in the project directory, on a calendar rule, with per-run audit history — for example a daily review or a nightly check. Choose the [session-local Schedule](../schedule/README.md) when the reminder belongs to the operator's current conversation. There is no external delivery: results live in the created Session and in the run history.

### Observable failures

Invalid rules, zones, or empty required fields reject at `create`/`update`. A missing or non-directory workspace fails the run with `start-failed`, a run exceeding `maxRuntimeMs` is cancelled and recorded as `timed-out`, and an Agent error is recorded as `failed`. Runs interrupted by a Host restart are marked `failed` with `host-restarted` when the service next starts. `remove` refuses while the task has an active run.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design concept

One service owns durable state and dispatch. `scheduled_tasks` rows hold configuration plus `next_run_at`; `scheduled_task_runs` rows hold one row per occurrence with its Session id and status. A single wake timer targets the earliest enabled `next_run_at`; on fire, `tick()` re-derives the next occurrence for every due task, admits the run, and re-arms. `admit()` enforces the per-task concurrency policy — `skip` records a `skipped` run, `queue` appends a `pending` run that starts when the active run settles.

### Execution chain

`execute()` verifies the workspace directory, creates a Session bound to it with the optional task preset override, selects the task's model, records the run as `running` with the Session id, arms the maximum-runtime timer, and prompts the Session with the task text. An empty stored preset omits `agentPreset` from Session creation so the deployment resolves its configured default. Schema version 2 migrates the version-1 implicit `default` marker to that empty representation. Completion is observed from the shared `agent/status` and `agent/error` events, correlated by Agent id (the Session id in this harness). Each execution therefore owns an independent Session, model selection, context, and audit row.

### Source map

| File | Role |
| --- | --- |
| `src/index.ts` | `ScheduledTasks` service: SQLite storage, dispatch, lifecycle events |
| `src/cron.ts` | Five-field Cron parsing, validation, and next-occurrence search |
| `src/types.ts` | Branded ids and the task, input, update, and run records |

**Runtime invariant:** No companion is published. The SQLite task and run rows are the single authority for durable state, and the in-memory dispatch set and queue are re-derived on every admission and settlement, so an independent observation has nothing to compare; the package lifecycle tests cover those transitions.

</details>

-----

## Model Experience

### No model-visible surface

#### What the model sees

The `ctx.scheduledTasks` service registers no tool, no prompt segment, and no model-visible event. The model never sees the task list or schedule state.

#### Token effect

Zero tokens are added to any existing Session. Each occurrence spends tokens only inside the Session it creates, whose first user message is exactly the configured prompt.

#### KV Cache effect

No effect on existing Sessions: every run starts a fresh Session with its own log, so nothing here can invalidate another Session's cached prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Runs are dispatched inside the Host process. Nothing survives Host downtime except configuration and run rows, and a run cannot resume mid-flight; restart recovery records it as failed.
- Catch-up is bounded to one occurrence per missed task, gated by `missedRunPolicy: run-once | skip`; there is no full backfill.
- `maxRuntimeMs` is a hard cancellation bound, not a per-step timeout.
- The service has no model-facing tools. A chat-driven creation flow would need a Thin Consumer over the same methods.
- There is no desktop-composition end-to-end test yet; package tests cover the Cron math and the service lifecycle against a fake `sessionController`.

-----

<a id="dev-note"></a>
### Dev Note

`pnpm run build` emits `lib/types` through `tsc` and bundles `lib/index.js` through `tsdown`. Run the package tests with `pnpm vitest run packages/schedule/scheduled-tasks`.
