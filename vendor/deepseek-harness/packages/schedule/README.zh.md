---
description: "schedule 组地图：基于会话日志的会话本地持久提醒，以及每次触发都启动新 Session 的 Host 级持久 Cron 任务，供浏览本组的用户与维护者阅读。"
kind: "package-group"
---

# schedule/ — 仅限会话内的提醒

[English](README.md) | 中文

## 概述

本组提供两类定时工作。[`schedule`](schedule/README.zh.md) 为当前会话创建持久提醒，并把到期内容送回该 Session；可选浏览器包展示活动提醒。[`scheduled-tasks`](scheduled-tasks/README.zh.md) 保存带显式时区的 Cron 规则，并为每次触发启动新的项目 Session。会话跟进选择提醒，隔离且可审计的工程运行选择定时任务；两者都不发送邮件、短信或推送通知。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`schedule/`](schedule/README.zh.md) | 会话本地提醒：安排、列出并取消活动记录；发布供 header 目录与列表行标识读取的可选只读 projection；把到期提醒作为会话消息交付 | —（工具只注册在精确的 agent scope 中） |
| [`scheduled-tasks/`](scheduled-tasks/README.zh.md) | Host 级持久任务：存储 Cron 规则及其时区，计算每次触发时间，并按任务的工程目录、模型和 Preset 为每次触发启动新 Session | `ctx.scheduledTasks` |

-----

<a id="related-documentation"></a>
## 相关文档

- [仅限会话内的 Schedule 子系统](../../docs/subsystems/schedule.zh.md)——持久记录、转换、视图与交付约定。
- [生成的工具目录](../../docs/tool-catalog.zh.md#deepseek-aidsh-schedule)——模型接收的 `schedule_create`／`schedule_list`／`schedule_delete` schema。
- [Schedule 用户指南](../../docs/user/guide/schedule.zh.md)——挂载本包的官方配置路径。
- [Web Schedule 目录](../client/ui-schedule/README.zh.md)——活动记录的可选只读浏览器呈现。

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
