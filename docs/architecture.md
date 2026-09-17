# Harness Studio 架构

## 目标结构

```text
React Renderer
  -> 类型化客户端适配层
  -> Electron dsh-app 协议处理
  -> 独立上游 Node Host
  -> DeepSeek Harness Session / Settings / Approval API
  -> Agent Loop、模型适配器、工具、Skill、持久化
```

Renderer 保持 `nodeIntegration: false`、`contextIsolation: true` 和 sandbox。它不接触文件系统、进程或凭据，只使用 preload 暴露的产品接口。

生产 Host 使用固定版本 DeepSeek Harness 的 Desktop Host 设计：独立上游 Node.js 进程、带背压的请求/响应字节管道，以及只承载生命周期的 Node IPC。UI、Host、Remote 描述和 Harness 依赖作为一个经过验证的发行组合。

`vendor/deepseek-harness` 是基于固定上游提交的 vendored source，并包含 Kuclaw 所需的 Harness 扩展；`.upstream-commit` 与 `upstream-lock.json` 同时记录上游基线、dsh 版本、Desktop Host 协议和 Node 版本。构建或升级前必须通过 `pnpm upstream:verify`，避免上游基线和发行元数据漂移。

## 当前运行时实现

`AgentRuntime` 运行在 Electron 主进程中。默认开发入口使用 `MockAgentRuntime`；`pnpm dev:harness` 使用 `HarnessAgentRuntime`。两者提供同一组产品操作：会话列表、获取、创建、删除、运行、取消和状态事件。React 只依赖共享契约。真实运行时的删除操作写入 Harness Workspace 归档状态并过滤会话列表，不移除不可变 Session 日志；模拟运行时删除本地记录。

模拟器不访问工作区。它产生确定性的助手增量、读取工具卡片和 Diff 卡片，并把状态原子写入 Electron userData。异常退出后，未完成消息恢复为 interrupted。

真实运行时通过 `HarnessHostProcess` 启动固定上游 Desktop Host。`HarnessHostClient` 封装 `/api/<namespace>/<method>` 一元调用与 `/.dsh/remote-stream` NDJSON 流；`HarnessAgentRuntime` 将 `session/list`、`create`、`follow`、`prompt` 和 `cancel` 投影为产品会话。

`StudioRuntime` 为“日常工作”和“工程开发”各持有一个运行时实例。工程开发沿用原有 Harness Session 根目录并以用户选择的项目文件夹作为工作目录；日常工作使用应用管理的工作目录。两个 Harness Profile 分别把 Session Persistence 指向 `sessions` 和 `daily-sessions`，同时共享 Harness Home，因此模型设置、API Key、Skill、MCP 和记忆配置不需要重复维护。模拟运行时对应写入 `state/sessions.json` 和 `state/daily-sessions.json`。

工程开发的项目检查器通过主进程读取当前 Session 的绝对工作目录。页面只能请求该目录内的相对路径；主进程拒绝路径逃逸和符号链接越界，限制文件预览大小，并以无 Shell 的 Git 子进程读取当前分支、工作区变更和单文件统一 Diff。变更视图和已打开文件按固定间隔重新读取，因此外部编辑产生的内容会持续反映到界面。

模型配置使用 Harness 原生应用接口：`settings` 持久化 `llm-pi-ai` Provider Profile 和默认模型，`credentials` 保存每个接口的独立凭据引用，`llm/discoverModels` 询问兼容端点，`session/selectModel` 切换当前会话。当前会话的权限选项和选中值来自 Harness `permissions` 投影；Studio 通过 Harness `/permission` 命令发起切换，并只在新的投影确认后更新界面。Studio 对官方接口和新增兼容接口统一采用 30 秒模型流空闲上限；超时及其他无回答失败从持久化的 `turn/end` 结果投影为简洁的中文提示，不向 Renderer 暴露底层诊断。Renderer 只接收脱敏状态和模型元数据。

## Harness 接入边界

当前适配器负责：

1. 启动打包在应用中的 Node Host，校验 App、Host、协议和 Harness 版本，并在没有显式代理环境变量时把 Electron 解析的系统 HTTP(S) 代理传给 Host。
2. 将会话操作映射到 Session Controller，而不是功能受限的 stdio SDK。
3. 把 Assistant Stream、持久事件、工具结果和审批转换为共享产品事件；网页抓取保留 Harness 对 URL、IP 字面量和重定向的限制。
4. 使用 Harness 持久化恢复冷会话；生产模式不写 mock 的 `sessions.json`。
5. Host 故障时终止临时流状态，保留持久会话，并向 UI 提供可恢复错误。

开发模式从 vendored Harness 的已构建工作区创建绝对符号链接。发行模式把固定 Node.js、Host、CLI、Web 资源和运行依赖复制到应用资源目录，并关闭 `allowLinkedProfile`。

## 里程碑

- P0/P1：独立工程、Electron 骨架、mock 实时流、会话持久化、取消、构建与测试。
- P2：固定上游构建、独立 Node Host、Session API、真实流、取消和恢复。开发模式已打通并由本地兼容模型端到端测试覆盖。
- P3：模型设置、Harness 凭据存储、OpenAI/Anthropic 兼容接口、模型发现、默认和会话模型切换。已完成。
- P4：真实文件/命令工具卡片、审批、用户提问和 Skill。
- P5：macOS arm64 私测包及无系统 Node 环境验收。
