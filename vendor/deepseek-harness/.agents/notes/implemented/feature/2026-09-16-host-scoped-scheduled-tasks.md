# Agent Note: Host-scoped scheduled tasks

Status: implemented

English | [中文](2026-09-16-host-scoped-scheduled-tasks.zh.md)

## Problem

The desktop App needed recurring unattended work: an operator selects a project directory, writes a Cron rule and a task prompt, picks a model, and expects the Host to run that prompt on schedule — in that directory, with that model — and to retain an auditable result per occurrence. The existing [session-local Schedule](../../../../packages/schedule/schedule/README.md) capability solves a different problem: its reminders wake the same live conversation, so reusing it for recurring project work would append every occurrence to one conversation, accumulate context and token cost, mix tool results across days, let one failed run contaminate the next, and leave no per-occurrence identity to retry or audit. Nothing in the Host owned durable Cron configuration, and the App's page does not involve a model at all, so a model tool was not the right entry point.

## Decision

The Host owns two new packages. [`@deepseek-ai/dsh-scheduled-tasks`](../../../../packages/schedule/scheduled-tasks/README.md) is the `ctx.scheduledTasks` service: it stores `ScheduledTask` and `ScheduledTaskRun` rows in a Host-owned SQLite file, derives `nextRunAt` from a five-field Cron rule plus an explicit IANA time zone, arms one wake timer for the earliest enabled occurrence, enforces the per-task `skip | queue` concurrency policy, and applies the `skip | run-once` missed-run policy at load. [`@deepseek-ai/dsh-api-scheduled-task-controller`](../../../../packages/api/scheduled-task-controller/README.md) binds the same service to the Remote gateway as the `scheduledTasks` namespace, so the App's page reaches it over the existing Host transport. The desktop composition inserts both rows in `apps/desktop-host/config/desktop.cordis.patch.yml`, and the shell's page calls `scheduledTasks/*` through IPC; the service is never exposed as a model tool.

## Run identity and isolation

One occurrence is one `ScheduledTaskRun` and one new Session. `execute()` checks that the workspace path is a directory, creates the Session with `{ cwd }` plus `agentPreset` only when the task stores an explicit override, selects the task's model on that Session, records the run as `running` with the Session id, arms the maximum-runtime cancellation, and prompts the Session with the task text. An omitted override lets the deployment's Agent Preset roster resolve its configured default; schema version 2 migrates the version-1 implicit `default` marker to the empty stored representation. Completion is observed from the shared `agent/status` and `agent/error` events correlated by Agent id, which is the Session id in this harness. Because each run starts a fresh Session, history length, tool results, failures, and token cost never carry across occurrences, and the retained Session id lets the App open the exact execution that produced a result. The run's workspace directory and model route come from the task, while its Agent Preset is either the task override or the deployment default.

## Cron and zone contract

A rule is five fields — minute, hour, day-of-month, month, day-of-week — and is always stored with its time zone; the same rule without a zone cannot say whether `0 1 * * *` is Beijing, UTC, or host-local. Rules are validated at `create` and `update` (the config boundary) rather than trusted at fire time, and `nextRunAt` is searched minute by minute over the zone's wall clock through `Intl.DateTimeFormat`, which keeps the result correct across DST transitions and after host sleep. Day-of-month and day-of-week combine as an OR when both are restricted, matching Cron convention. The durable rows hold epoch milliseconds; zone names and rules are configuration, not derived state.

## Alternatives considered

**Reuse the session-local Schedule capability.** Its reminders re-enter one live conversation by design, and its durable state is the owning Session's log. Making it launch new Sessions would either change that contract for existing consumers or duplicate the launch path inside a session-local plugin.

**Schedule in the Electron main process.** The App already persists sessions and can spawn the Harness, so a timer there would be less new code. It would also put Cron state, dispatch, and run history in the shell, making the App the source of truth for execution facts and leaving the Harness unable to run the same tasks headless.

**Expose a model tool instead of a service.** The operator fills a form; no model call exists in the creation path, so a tool would have added a round trip through the model for UI work. A tool remains an optional future Consumer over the same service methods, not a second implementation.

**Adopt a Cron library.** A maintained parser would delete most of `src/cron.ts`, but the required subset is five fields with IANA zones, the durable format and validation stay inside the package, and the parser is covered by deterministic tests; adding a runtime dependency to a vendored Host package was not justified by the deleted lines.

## Consequences

Recurring project work now runs as isolated, auditable Sessions, and the App can create and observe it without involving the model. The trade-offs are recorded in the package READMEs: dispatch lives in the Host process, so a restart marks interrupted runs `failed` with `host-restarted` and cannot resume them; catch-up is bounded to one occurrence per missed task; `maxRuntimeMs` is a hard cancellation bound rather than a per-step timeout; every Remote method is unary, so run progress is polled; and there is no desktop-composition end-to-end test yet — package tests cover the Cron math and the service lifecycle against a fake `sessionController`.
