<p align="center">
  <img src="build-resources/icon.svg" width="96" alt="Kuclaw icon" />
</p>

<h1 align="center">Kuclaw</h1>

<p align="center">
  A local-first desktop coding agent powered by DeepSeek Harness.
</p>

<p align="center">
  <strong>English</strong> | <a href="README.zh.md">中文</a>
</p>

> [!WARNING]
> Kuclaw is in developer preview. Its interfaces and local data format may change before the first stable release.

Kuclaw is a macOS desktop coding agent built with Electron and React. It embeds a pinned DeepSeek Harness runtime and exposes its production Session, Agent, tool, Skill, MCP, context, sandbox, and approval capabilities through a focused desktop experience.

The application does not use the feature-limited `dsh-sdk-client` as its primary integration. Electron launches the real Desktop Host and communicates through the Harness Session, Settings, Credentials, Remote Events, and controller APIs.

## Highlights

- **Real Harness execution** — Agent Loop, model requests, streaming responses, tools, subagents, cancellation, and recovery run inside DeepSeek Harness.
- **Multi-provider models** — configure OpenAI Chat Completions, OpenAI Responses, and Anthropic Messages-compatible endpoints; switch the default model or the current Session model without restarting the Host.
- **Persistent Sessions** — daily conversations and project tasks use separate Harness Session roots while sharing model, credential, Skill, MCP, and memory configuration.
- **Native tool presentation** — terminal commands, file reads, searches, web activity, diffs, edits, failures, and background operations are projected from Harness events into compact conversation rows.
- **Skills and MCP** — Skills are discovered and executed by Harness; MCP connections, reconnection, tool synchronization, and invocation are owned by the Harness MCP client.
- **Context and memory** — Harness owns token accounting and compaction. A bundled SQLite MCP server provides local long-term memory without exposing the database to the Renderer.
- **Sandbox and approvals** — supports Harness `read-only`, `workspace-write`, and `danger-full-access` modes with fail-closed approval and question handling.
- **Scheduled agents** — cron and timezone-based tasks create a new isolated Session and Agent for every run, with pause, resume, run-now, cancellation, and run history.
- **Desktop-ready networking** — inherits explicit or system proxy policy and safely handles TUN/Fake-IP DNS by independently verifying public destinations.
- **Self-contained builds** — production packages include a pinned Node.js runtime, DeepSeek Harness, the Desktop Host profile, and the SQLite memory MCP service.

## DeepSeek Harness integration

Kuclaw vendors DeepSeek Harness at upstream commit [`ddefc45fbc7f8e46dd73185e68295696d1297887`](https://github.com/deepseek-ai/deepseek-harness/commit/ddefc45fbc7f8e46dd73185e68295696d1297887), then adds the desktop-specific integration and services required by the product.

| Capability | DeepSeek Harness implementation | Kuclaw integration |
|---|---|---|
| Agent Loop and streaming | [`agent-loop`](vendor/deepseek-harness/packages/core/agent-loop/src/index.ts) | [`harness-runtime.ts`](src/main/runtime/harness-runtime.ts) projects live and persisted events into serializable UI records. |
| Compatible model providers | [`llm-pi-ai`](vendor/deepseek-harness/packages/llm/llm-pi-ai/src/index.ts) | Model settings write Harness provider profiles, credentials, and `agent-default-model`; `session/selectModel` switches a single Session. |
| Sessions and recovery | [`session-controller`](vendor/deepseek-harness/packages/api/session-controller/src/index.ts) | [`studio-runtime.ts`](src/main/runtime/studio-runtime.ts) owns separate daily and project runtimes while keeping Harness as the source of truth. |
| Files, shell, web, and subagents | Harness tool packages under [`packages`](vendor/deepseek-harness/packages) | The Renderer only displays `tool/call`, `tool/result`, and presentation metadata; it never executes commands or edits the workspace directly. |
| Skills | [`skill`](vendor/deepseek-harness/packages/skill/skill/src/index.ts) | The App imports and enables user Skill files; Harness discovers, loads, and executes them. |
| MCP | [`mcp-client`](vendor/deepseek-harness/packages/mcp/mcp-client/src/index.ts) | [`mcp-manager.ts`](src/main/runtime/mcp-manager.ts) manages product configuration and controlled Host restarts; Harness owns connections and calls. |
| Context and compaction | [`compaction`](vendor/deepseek-harness/packages/compaction/compaction/src/index.ts) | Context status and manual compaction are thin projections of Harness state. |
| Sandbox and approval | [`sandbox-policy`](vendor/deepseek-harness/packages/sandbox/sandbox-policy/src/index.ts) and [`user-approval`](vendor/deepseek-harness/packages/interaction/user-approval/src/index.ts) | Electron supplies the UI answerer over Remote Events and stays fail-closed when no answerer is available. |
| Web safety and Fake-IP | [`web-fetch-http`](vendor/deepseek-harness/packages/web/web-fetch-http/src/index.ts) | Kuclaw extends public-address verification with DNS-over-HTTPS fallback for arbitrary IPv4/IPv6 Fake-IP ranges while keeping private destinations blocked. |
| Scheduled agents | [`scheduled-tasks`](vendor/deepseek-harness/packages/schedule/scheduled-tasks/src/index.ts) and [`scheduled-task-controller`](vendor/deepseek-harness/packages/api/scheduled-task-controller/src/index.ts) | A Host-scoped SQLite scheduler creates a fresh Session and Agent for every occurrence and exposes task/run controllers to Electron. |

### Runtime boundary

```text
React Renderer
  -> serializable preload API
  -> Electron main process
  -> supervised Desktop Host processes
  -> DeepSeek Harness Session / Settings / Credentials / Remote APIs
  -> Agent Loop, tools, Skills, MCP, compaction, sandbox, and persistence
```

The Renderer runs with `nodeIntegration: false`, `contextIsolation: true`, and Chromium sandboxing enabled. File access, Git inspection, process creation, credentials, and Host lifecycle remain in the main process or Harness.

## Requirements

- macOS 13 or later
- Apple Silicon for the current packaged build
- Node.js 24
- pnpm 11

## Development

Clone and install the App dependencies:

```sh
git clone git@github.com:chaofan604/kuclaw.git
cd kuclaw
corepack enable
pnpm install
```

Install and build the vendored Harness workspace once:

```sh
pnpm setup:harness
```

Run Kuclaw with the real Desktop Host:

```sh
pnpm dev:harness
```

The deterministic simulation runtime is available explicitly for UI development:

```sh
pnpm dev
```

## Validation

```sh
pnpm upstream:verify
pnpm typecheck
pnpm test
pnpm build
```

Create an unsigned macOS Apple Silicon directory package:

```sh
CSC_IDENTITY_AUTO_DISCOVERY=false pnpm package:dir
```

The packaged App starts the real Harness runtime by default. Simulation mode is only enabled through an explicit development command; configuration failures never silently fall back to simulation.

## Project structure

```text
src/main/                         Electron main process and IPC
src/main/runtime/                 Desktop Host, Session, MCP, memory, and policy adapters
src/renderer/                     React desktop interface
src/shared/                       Serializable Renderer/Main contracts
vendor/deepseek-harness/          Pinned upstream source plus Kuclaw Harness extensions
scripts/                          Development, packaging, and verification tools
tests/                            App integration and renderer tests
docs/architecture.md              Detailed architecture notes
upstream-lock.json                Harness, protocol, and bundled Node version lock
```

## Current scope

- Native protocols in the first release are limited to OpenAI-compatible and Anthropic-compatible APIs.
- The current release target is unsigned macOS arm64.
- Models, Sessions, tools, Skills, MCP, context, permissions, and scheduled execution treat Harness as the execution source of truth.
- Renderer APIs expose serializable data only and never return API key values, filesystem handles, or process objects.

## Upstream and licenses

DeepSeek Harness is developed by [DeepSeek AI](https://github.com/deepseek-ai/deepseek-harness) and is vendored under its [MIT License](vendor/deepseek-harness/LICENSE). The exact upstream baseline and compatible Node/Desktop Host protocol versions are recorded in [`upstream-lock.json`](upstream-lock.json).

See [`docs/architecture.md`](docs/architecture.md) for implementation details.
