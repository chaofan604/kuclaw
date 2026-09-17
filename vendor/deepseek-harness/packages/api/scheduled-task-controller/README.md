---
description: "Remote BFF rows for Host-scoped scheduled tasks: the scheduledTasks namespace the desktop App calls to create, edit, pause, run, and audit recurring Agent work."
kind: "package-reference"
---

# @deepseek-ai/dsh-api-scheduled-task-controller

English | [中文](README.zh.md)

## Summary

`dsh-api-scheduled-task-controller` exposes the `ctx.scheduledTasks` service over the Host Remote gateway as the `scheduledTasks` namespace. The desktop App calls one endpoint per operation — `scheduledTasks/list`, `create`, `update`, `remove`, `setEnabled`, `runNow`, `cancelRun`, and `runs` — and this controller forwards each call to the service. It holds no state and makes no scheduling decision: task configuration, persistence, dispatch, and run history all belong to [`dsh-scheduled-tasks`](../../schedule/scheduled-tasks/README.md).

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Compose this controller in the same Host composition as the service it forwards to:

```yaml
- id: scheduled-task-controller
  name: '@deepseek-ai/dsh-api-scheduled-task-controller'
  inject:
    - scheduledTasks
```

The App creates a task by sending the user-authored fields (name, workspace path, Cron, time zone, prompt, model route, preset, and the optional enabled/concurrency/missed-run policies) to `scheduledTasks/create`, then lists tasks and run history to render the management page. Every method returns the committed value from the service, so the App never derives scheduling state itself.

### When to choose it

Choose this controller when a Host surface outside the model must manage scheduled tasks — the desktop App, or another trusted Host client on the same transport. Model-facing creation is deliberately absent: a chat-driven flow would need its own Thin Consumer that calls the same service rather than reusing this Remote surface.

### Observable failures

Faults are the service's: invalid Cron, zone, or required fields reject at `create`/`update`; an unknown task or run rejects; `remove` on a running task rejects; the gateway maps each rejection to a Remote error with the service message. `runNow` returns the run record immediately, including a `skipped` run when the task is already active.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design concept

`ScheduledTaskController` extends `TypertRemoteService`, which registers the Service under the injected `scheduledTasks` binding and binds the same instance to the gateway under the wire namespace `scheduledTasks`. Each public method carries `@Remote`, so the gateway publishes it as `<namespace>/<method>` and the App's transport resolves it by name. Methods delegate to the service and return its values unchanged.

### Source map

| File | Role |
| --- | --- |
| `src/index.ts` | `ScheduledTaskController`: the `@Remote` methods over `ctx.scheduledTasks` |

**Runtime invariant:** No companion is published. Every method forwards to `ctx.scheduledTasks` and returns its committed value, so this package owns no state that an independent observation could compare.

</details>

-----

## Model Experience

### No model-visible surface

#### What the model sees

The `scheduledTasks/*` Remote namespace registers no tool, prompt segment, or event; it is a Host-to-client transport row that the model never observes.

#### Token effect

Zero tokens. Forwarding a call neither reads nor writes any Session.

#### KV Cache effect

None: no Session context is touched.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Every method is unary; there is no stream for live run progress. Surfaces poll `runs` or refresh on service change notifications.
- `runs` takes only a task id and an optional bounded limit; there is no cursor, filter, or cross-task history query.
- The controller trusts its transport for authorization, like the other Remote controllers in this assembly.

-----

<a id="dev-note"></a>
### Dev Note

`pnpm run build` emits `lib/types` through `tsc` and bundles `lib/index.js` through `tsdown`. Run the package tests with `pnpm vitest run packages/api/scheduled-task-controller`.