/** Remote API for App-authored Host scheduled tasks. */
import { Context } from '@deepseek-ai/cordis'
import type {
  ScheduledTask, ScheduledTaskId, ScheduledTaskInput, ScheduledTaskRun, ScheduledTaskRunId, ScheduledTaskUpdate,
} from '@deepseek-ai/dsh-scheduled-tasks'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'

declare module '@deepseek-ai/cordis' {
  interface Context { scheduledTaskController: ScheduledTaskController }
}

/** Host owner of the `scheduledTasks` Remote namespace. */
export class ScheduledTaskController extends TypertRemoteService {
  static inject = ['scheduledTasks']

  constructor(ctx: Context) {
    super(ctx, 'scheduledTaskController', { namespace: 'scheduledTasks' })
  }

  /**
   * Return every persistent task.
   * @returns the stored tasks, earliest next occurrence first.
   */
  @Remote
  list(): ScheduledTask[] { return this.ctx.scheduledTasks.list() }

  /**
   * Create one task.
   * @param input - user-authored fields; invalid values reject with the service error.
   * @returns the stored task with its computed next occurrence.
   */
  @Remote
  create(input: ScheduledTaskInput): ScheduledTask { return this.ctx.scheduledTasks.create(input) }

  /**
   * Update one task.
   * @param input - task id plus the fields to replace.
   * @returns the stored task with its re-derived next occurrence.
   */
  @Remote
  update(input: ScheduledTaskUpdate): ScheduledTask { return this.ctx.scheduledTasks.update(input) }

  /**
   * Delete one idle task.
   * @param id - task identity; a task with an active run rejects.
   */
  @Remote
  remove(id: ScheduledTaskId): void { this.ctx.scheduledTasks.remove(id) }

  /**
   * Enable or pause one task.
   * @param id - task identity.
   * @param enabled - whether the task may fire.
   * @returns the stored task after the change.
   */
  @Remote
  setEnabled(id: ScheduledTaskId, enabled: boolean): ScheduledTask { return this.ctx.scheduledTasks.setEnabled(id, enabled) }

  /**
   * Start one independent execution immediately.
   * @param id - task identity.
   * @returns the admitted run, already `skipped` when the task is active under `skip`.
   */
  @Remote
  runNow(id: ScheduledTaskId): ScheduledTaskRun { return this.ctx.scheduledTasks.runNow(id) }

  /**
   * Cancel one live execution.
   * @param id - run identity; a settled run is a no-op.
   */
  @Remote
  cancelRun(id: ScheduledTaskRunId): Promise<void> { return this.ctx.scheduledTasks.cancelRun(id) }

  /**
   * Return bounded run history for one task.
   * @param taskId - task identity.
   * @param limit - maximum rows, bounded to 1..200; defaults to 50.
   * @returns the task's runs, newest scheduled first.
   */
  @Remote
  runs(taskId: ScheduledTaskId, limit?: number): ScheduledTaskRun[] { return this.ctx.scheduledTasks.listRuns(taskId, limit) }
}

export default ScheduledTaskController
