---
description: "The schedule group map: session-local durable reminders over the session log and Host-scoped persistent Cron tasks that launch a new Session per occurrence, for users and maintainers navigating the group."
kind: "package-group"
---

# schedule/ — Session-local reminders

English | [中文](README.zh.md)

## Summary

The group provides two kinds of timed work. [`schedule`](schedule/README.md) creates durable reminders for the current conversation and delivers each due item back into that Session; optional browser packages project active reminders. [`scheduled-tasks`](scheduled-tasks/README.md) stores Cron rules with explicit time zones and launches a fresh project Session for every occurrence. Choose reminders for conversation follow-up and scheduled tasks for isolated, auditable project runs; neither sends email, SMS, or push notifications.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`schedule/`](schedule/README.md) | Session-local reminders: schedule, list, and cancel active records; publish an optional read-only projection for the header catalog and list-row marker; deliver due reminders as conversation messages | — (tools only, in the exact agent scope) |
| [`scheduled-tasks/`](scheduled-tasks/README.md) | Host-scoped persistent tasks: store Cron rules with their time zone, compute each next occurrence, and launch a new Session per occurrence with the task's workspace, model, and preset | `ctx.scheduledTasks` |

-----

<a id="related-documentation"></a>
## Related documentation

- [Session-local Schedule subsystem](../../docs/subsystems/schedule.md) — durable record, transition, view, and delivery contracts.
- [Generated tool catalog](../../docs/tool-catalog.md#deepseek-aidsh-schedule) — the `schedule_create`/`schedule_list`/`schedule_delete` schemas the model receives.
- [Schedule user guide](../../docs/user/guide/schedule.md) — the official configuration path for mounting the package.
- [Web Schedule catalog](../client/ui-schedule/README.md) — the optional read-only browser presentation of active records.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
