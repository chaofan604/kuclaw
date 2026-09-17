# Harness Studio 开发进度（Phase 3 已完成）

## 已完成
- 启动死锁修复(dist 旧顶层 await);打包修复 + scripts/verify-package.mjs。
- 深色 Codex 风格 UI 第一版(src/renderer)。
- 运行锁释放修复 + 单实例锁(src/main/main.ts)。
- vendor/deepseek-harness 已完整构建(desktop-host lib/index.js 就绪)。
- Phase 1 完成:src/main/runtime/dsh-host-protocol.ts + dsh-host-process.ts(上游 host-process.ts 移植,含 allowLinkedProfile);tests/harness-host.spec.ts 冒烟通过(spawn→握手 v3→fetch 往返→干净退出)。
- Codex 风格桌面信息架构已替换旧聊天 Demo：项目/任务树、无气泡正文、扁平工具活动、固定输入器、项目上下文栏。
- `HarnessHostClient` 已实现 `/api/<endpoint>` 一元 RPC 与 `/.dsh/remote-stream` NDJSON 流。
- `HarnessAgentRuntime` 已实现 Session 列表、创建、冷恢复、prompt、实时助手流、基础工具事件投影和取消。
- `pnpm dev:harness` 可启动固定上游真实 Host；默认 `pnpm dev` 保持模拟模式。
- 本地 DeepSeek 兼容 SSE 假服务端到端测试通过：真实 Agent Loop → prompt → assistant stream → durable message → idle。
- Electron SIGINT/SIGTERM 统一经过运行时清理后退出，修复开发和打包验收中的旧实例残留。
- 模型配置统一走 Harness Application API，不使用功能受限的 stdio SDK。
- 支持 `openai-completions`、`openai-responses`、`anthropic-messages` Provider Profile。
- Provider Profile 通过 `settings/mutate` 写入 `llm-pi-ai.providers`，每个接口使用独立 Harness Credential 引用。
- `llm/discoverModels` 支持端点模型发现；API Key 仅向 Host 单向传输，配置返回值不含密钥。
- `session/modelCatalog`、`session/selectModel` 已接入默认模型与会话模型选择器。
- Codex 风格模型设置页和聊天输入器模型菜单已完成。
- 端到端测试覆盖发现、保存、凭据、会话切换、真实流式调用和删除 Provider。
- 用户设置页简化为协议、接口地址、API Key、最大上下文四项；Provider ID、模型目录和默认模型由应用内部维护。
- macOS 应用菜单增加“设置…”及 `CommandOrControl+,` 快捷键。

## Host 启动要求(冒烟测试已验证的做法)
- 项目 profile:package.json 带 dsh.profile.bundles=['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app']。
- profile/node_modules/@deepseek-ai/* 链接全部第一方包(vendor/{packages/*/*,apps/*,vendor/*});runtimeDir/node_modules/@deepseek-ai/ 至少链 dsh、dsh-desktop-host、dsh-web-frontend。
- argv: node apps/desktop-host/lib/index.js <runtimeDir> <projectDir> --allow-linked-profile;stdio ['ignore','pipe','pipe','pipe','pipe','ipc'];DSH_HOME 注入。
- 注意 symlink 必须用绝对路径!scripts/probe-host.mjs 有完整可运行的组装代码。

## Phase 2 协议结论（已实测）
- 非流式 RPC：`POST /api/<namespace>/<method>`，body 为 `{type:'client-request',rpcId,method,payload:{args}}`。
- 流式：`POST /.dsh/remote-stream`，body 为 `{endpoint,payload:{args}}`，响应是 NDJSON 行流。
- Session endpoint：`session/list`、`session/create`、`session/follow`、`session/prompt`、`session/cancel`。
- generated wire 参数保留方法参数名：例如 list 使用 `{args:{_request:{}}}`，create 使用 `{args:{request:{cwd}}}`。
- 旧 `scripts/probe-host.mjs` 含递归删除临时目录，不符合当前项目安全约束，不应执行。

## 下一步
1. Phase 4：Skill 列表、导入、启用和指定调用。
2. MCP Profile 管理、连接状态和受控 Host 重启。
3. 补齐 tool presentationMeta 的 diff/terminal/search 卡片投影。
4. 接入审批、用户提问、上下文管理与本地 SQLite MCP 记忆。
5. 将固定 Node.js 和 Harness 运行时装入 Electron 发行资源，关闭开发符号链接模式。
