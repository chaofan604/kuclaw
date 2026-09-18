---
description: "Host 级持久化定时任务：用 Cron 规则在每次触发时创建全新 Session 和 Agent，供从桌面 App 创建与审计周期任务的运维者使用。"
kind: "package-reference"
---

# @deepseek-ai/dsh-scheduled-tasks

[English](README.md) | 中文

## 概述

使用 `ctx.scheduledTasks` 保存带显式时区、工程目录、模型和 Prompt 的 Cron 工程任务，并可选覆盖 Agent Preset；未指定时使用部署默认值。每次触发都启动全新 Session，记录状态与 Session id，并且从不复用之前的对话历史。无人值守且需要审计的检查选择本能力；需要回到当前会话的提醒选择会话内 [Schedule](../schedule/README.zh.md)。桌面 App 直接调用该服务，因此不注册模型工具。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在提供 `sessionController` 的 Host 组合中挂载本服务，并把 `databasePath` 放在 Harness home 下：

```yaml
- id: scheduled-tasks
  name: '@deepseek-ai/dsh-scheduled-tasks'
  inject:
    - sessionController
  config:
    databasePath: !!js dshHomePath('scheduled-tasks.sqlite')
    maxRuntimeMs: 86400000
```

`create` 校验名称、工程目录、Prompt、模型路由、Cron 规则和时区，然后安排第一次触发。当规则或时区变化时，`update` 会重新推导下次触发时间。`setEnabled` 暂停和恢复任务而不删除历史；`remove` 删除空闲任务及其运行记录；`runNow` 立即启动一次执行且不移动 Cron 锚点。`cancelRun` 结算排队中的运行而不影响当前执行，或取消运行中记录所拥有的 Session。`listRuns(taskId, limit)` 返回最新在前的运行历史，`onChanged` 把已提交的任务或运行变化通知给 Host 界面。

### 何时选择它

当周期任务需要在工程目录中无人值守地按日历规则运行，并且需要每次执行的审计历史时（例如每日审查或夜间检查），选择本服务。当提醒属于运维者当前会话时，选择会话内 [Schedule](../schedule/README.zh.md)。本包没有外部投递通道：结果保存在所创建的 Session 和运行历史中。

### 可观察的失败

非法规则、时区或必填字段为空会在 `create`/`update` 时拒绝。工程目录不存在或不是目录会让本次运行以 `start-failed` 失败；超过 `maxRuntimeMs` 的运行会被取消并记录为 `timed-out`；Agent 报错记录为 `failed`。Host 重启中断的运行会在服务下次启动时标记为 `failed` 且带 `host-restarted`。任务有活跃运行时 `remove` 会被拒绝。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节 —— 点击展开</summary>

### 设计概念

一个服务同时拥有持久化状态与派发。`scheduled_tasks` 行保存配置和 `next_run_at`；`scheduled_task_runs` 行按每次触发保存一行，含 Session id 与状态。单个唤醒计时器指向最早的已启用 `next_run_at`；触发时 `tick()` 为每个到期任务重新推导下次触发时间、接纳本次运行并重新布防。`admit()` 执行每个任务的并发策略：`skip` 记录一条 `skipped` 运行，`queue` 追加一条 `pending` 运行，等当前运行结束后再启动。

### 执行链路

`execute()` 校验工程目录，使用任务可选的 Preset 覆盖创建绑定该目录的 Session，选择任务模型，把运行记录为 `running` 并写入 Session id，布防最大运行时长计时器，然后把任务文本作为 Prompt 发送给该 Session。持久化 Preset 为空时，创建 Session 不传 `agentPreset`，由部署解析其已配置的默认值。数据库版本 2 会把版本 1 的隐式 `default` 标记迁移为空值。完成状态来自共享的 `agent/status` 与 `agent/error` 事件，按 Agent id（在本 Harness 中即 Session id）关联。因此每次执行都拥有独立的 Session、模型选择、上下文和审计行。

### 源码地图

| 文件 | 职责 |
| --- | --- |
| `src/index.ts` | `ScheduledTasks` 服务：SQLite 存储、派发、生命周期事件 |
| `src/cron.ts` | 五字段 Cron 解析、校验与下次触发搜索 |
| `src/types.ts` | 品牌化 id 以及任务、输入、更新、运行记录 |

**Runtime invariant:** No companion is published. SQLite 的任务行与运行行是持久状态的唯一权威，内存中的派发集合与队列在每次接纳和结算时重新推导，因此独立观察没有可比较的对象；包生命周期测试覆盖这些转换。

</details>

-----

## 模型体验

### 没有模型可见面

#### 模型看到什么

`ctx.scheduledTasks` 服务不注册工具、不注入 Prompt 片段、不产生模型可见事件。模型永远看不到任务列表或调度状态。

#### Token 影响

不会给任何已有 Session 增加 token。每次触发只在它创建的 Session 内消耗 token，其第一条用户消息正是配置的 Prompt。

#### KV 缓存影响

对已有 Session 没有影响：每次运行都开启带独立日志的新 Session，因此这里不可能让其他 Session 的缓存前缀失效。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 运行在 Host 进程内派发。除配置和运行记录外，Host 停机期间没有任何东西存活，运行也无法中途恢复；重启恢复会把它记录为失败。
- 补跑最多为每个错过的任务补一次，由 `missedRunPolicy: run-once | skip` 控制；没有完整回填。
- `maxRuntimeMs` 是硬性取消上限，不是单步超时。
- 服务没有面向模型的工具。聊天驱动的创建流程需要在同一批方法之上再加一个薄 Consumer。
- 还没有桌面组合的端到端测试；包测试覆盖 Cron 数学与针对假 `sessionController` 的服务生命周期。

-----

<a id="dev-note"></a>
### 开发备注

`pnpm run build` 通过 `tsc` 输出 `lib/types`，并通过 `tsdown` 打包 `lib/index.js`。用 `pnpm vitest run packages/schedule/scheduled-tasks` 运行包测试。
