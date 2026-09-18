---
description: "Host 级定时任务的 Remote BFF 行：桌面 App 通过 scheduledTasks 命名空间创建、编辑、暂停、运行并审计周期 Agent 任务。"
kind: "package-reference"
---

# @deepseek-ai/dsh-api-scheduled-task-controller

[English](README.md) | 中文

## 概述

`dsh-api-scheduled-task-controller` 把 `ctx.scheduledTasks` 服务以 `scheduledTasks` 命名空间暴露到 Host Remote 网关上。桌面 App 每个操作调用一个端点 —— `scheduledTasks/list`、`create`、`update`、`remove`、`setEnabled`、`runNow`、`cancelRun` 和 `runs` —— 本控制器把每次调用转发给服务。它不持有状态、不做调度决策：任务配置、持久化、派发和运行历史都属于 [`dsh-scheduled-tasks`](../../schedule/scheduled-tasks/README.zh.md)。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

把本控制器挂载到与它所转发服务相同的 Host 组合中：

```yaml
- id: scheduled-task-controller
  name: '@deepseek-ai/dsh-api-scheduled-task-controller'
  inject:
    - scheduledTasks
```

App 通过向 `scheduledTasks/create` 发送用户填写的字段（名称、工程目录、Cron、时区、Prompt、模型路由、Preset，以及可选的启用/并发/补跑策略）来创建任务，然后列出任务和运行历史以渲染管理页面。每个方法都返回服务中已提交的值，因此 App 自己不推导调度状态。

### 何时选择它

当模型之外的 Host 界面需要管理定时任务时选择本控制器 —— 桌面 App，或同一传输上的其他受信任 Host 客户端。这里刻意不提供面向模型的创建入口：聊天驱动的流程需要自己的薄 Consumer 调用同一服务，而不是复用这个 Remote 面。

### 可观察的失败

故障来自服务：非法 Cron、时区或必填字段在 `create`/`update` 时拒绝；未知任务或运行会拒绝；对运行中的任务执行 `remove` 会拒绝；网关把每次拒绝映射为带服务消息的 Remote 错误。`runNow` 立即返回运行记录，当任务已活跃时返回的是一条 `skipped` 运行。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节 —— 点击展开</summary>

### 设计概念

`ScheduledTaskController` 继承 `TypertRemoteService`，后者在注入的 `scheduledTasks` 绑定下注册 Service，并把同一实例以线上命名空间 `scheduledTasks` 绑定到网关。每个公开方法都带 `@Remote`，于是网关把它发布为 `<namespace>/<method>`，App 的传输按名称解析。方法委托给服务并原样返回其值。

### 源码地图

| 文件 | 职责 |
| --- | --- |
| `src/index.ts` | `ScheduledTaskController`：基于 `ctx.scheduledTasks` 的 `@Remote` 方法 |

**Runtime invariant:** No companion is published. 每个方法都转发给 `ctx.scheduledTasks` 并返回其已提交值，因此本包不拥有可供独立观察比较的状态。

</details>

-----

## 模型体验

### 没有模型可见面

#### 模型看到什么

`scheduledTasks/*` Remote 命名空间不注册工具、Prompt 片段或事件；它是 Host 到客户端的传输行，模型永远观察不到。

#### Token 影响

零 token。转发调用既不读取也不写入任何 Session。

#### KV 缓存影响

没有：不触碰任何 Session 上下文。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 所有方法都是一元调用；没有实时运行进度的流。界面通过轮询 `runs` 或响应服务变更通知来刷新。
- `runs` 只接受任务 id 和一个可选的有界 limit；没有游标、过滤或跨任务历史查询。
- 与本程序集中的其他 Remote 控制器一样，本控制器信任其传输层的授权。

-----

<a id="dev-note"></a>
### 开发备注

`pnpm run build` 通过 `tsc` 输出 `lib/types`，并通过 `tsdown` 打包 `lib/index.js`。
