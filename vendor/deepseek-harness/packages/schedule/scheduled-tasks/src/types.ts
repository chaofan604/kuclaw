import type { Branded } from '@deepseek-ai/dsh-brand'

/** Stable Host-wide scheduled-task identity. */
export type ScheduledTaskId = Branded<'scheduled-task-id'>
/** Stable identity of one scheduled execution. */
export type ScheduledTaskRunId = Branded<'scheduled-task-run-id'>

/** Model route selected for every execution of a task. */
export interface ScheduledTaskModel {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string
}

/** Whether an occurrence that lands on an active task is dropped or queued. */
export type ScheduledTaskConcurrency = 'skip' | 'queue'
/** Whether occurrences missed while the Host was down are skipped or replayed once. */
export type ScheduledTaskMissedRunPolicy = 'skip' | 'run-once'
/** Lifecycle of one scheduled execution, from admission to its settled outcome. */
export type ScheduledTaskRunStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'timed-out' | 'skipped'

/** Durable Host-level task configuration. */
export interface ScheduledTask {
  readonly id: ScheduledTaskId
  readonly name: string
  readonly workspacePath: string
  readonly cron: string
  readonly timeZone: string
  readonly prompt: string
  readonly model: ScheduledTaskModel
  readonly preset: string
  readonly enabled: boolean
  readonly concurrency: ScheduledTaskConcurrency
  readonly missedRunPolicy: ScheduledTaskMissedRunPolicy
  readonly nextRunAt: number
  readonly createdAt: number
  readonly updatedAt: number
}

/** User-authored fields accepted when a task is created. */
export interface ScheduledTaskInput {
  readonly name: string
  readonly workspacePath: string
  readonly cron: string
  readonly timeZone: string
  readonly prompt: string
  readonly model: ScheduledTaskModel
  readonly preset?: string
  readonly enabled?: boolean
  readonly concurrency?: ScheduledTaskConcurrency
  readonly missedRunPolicy?: ScheduledTaskMissedRunPolicy
}

/** Partial mutation of one existing task. */
export interface ScheduledTaskUpdate extends Partial<ScheduledTaskInput> {
  readonly id: ScheduledTaskId
}

/** Durable result of one scheduled occurrence. */
export interface ScheduledTaskRun {
  readonly id: ScheduledTaskRunId
  readonly taskId: ScheduledTaskId
  readonly scheduledAt: number
  readonly sessionId?: string
  readonly status: ScheduledTaskRunStatus
  readonly startedAt?: number
  readonly finishedAt?: number
  readonly errorCode?: string
  readonly errorMessage?: string
}
