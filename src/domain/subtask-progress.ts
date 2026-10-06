import { TaskStatus } from './enums';
import type { Task } from './task';

/**
 * 子任务进度（纯逻辑）。
 *
 * 设计取舍：**父任务的完成态由子任务决定，但只在"全部子任务都完成"时才自动完成**。
 * 这与项目里"完成只由明确的勾选触发"的规矩一致 —— 勾最后一个子任务就是那个明确动作；
 * 反过来，只要取消掉一个子任务，父任务就退回待办（不会留下"做完了但还有子任务没做"的脏状态）。
 *
 * 不做递归：子任务只能挂一层（见 domain/task.ts 的 parentId 注释）。
 */

export interface SubtaskProgress {
  total: number;
  done: number;
  /** 0..1，供进度条用 */
  ratio: number;
  /** 是否全部子任务都已完成（total > 0 才有意义） */
  allDone: boolean;
}

export function subtaskProgress(
  children: ReadonlyArray<Pick<Task, 'status'>>,
): SubtaskProgress {
  const total = children.length;
  const done = children.filter((c) => c.status === TaskStatus.Done).length;
  return {
    total,
    done,
    ratio: total === 0 ? 0 : done / total,
    allDone: total > 0 && done === total,
  };
}

/**
 * 根据子任务状态算出父任务应该处于的完成态。
 *
 * 返回 null = "不改父任务"（没有子任务、或还没全完成 —— 半途不该动父任务的状态）。
 */
export function desiredParentStatus(
  parent: Pick<Task, 'status'>,
  children: ReadonlyArray<Pick<Task, 'status'>>,
): TaskStatus | null {
  const progress = subtaskProgress(children);
  if (progress.total === 0) return null;

  if (progress.allDone) {
    return parent.status === TaskStatus.Done ? null : TaskStatus.Done;
  }
  // 全部完成的父任务被"取消一个子任务"打回待办
  return parent.status === TaskStatus.Done ? TaskStatus.Todo : null;
}

/** "3/5" 这种文案，没子任务时返回 null（界面上不显示） */
export function describeSubtaskProgress(progress: SubtaskProgress): string | null {
  if (progress.total === 0) return null;
  return `${progress.done}/${progress.total}`;
}

/** 父任务是否应该显示子任务进度（有子任务才显示） */
export function hasSubtasks(children: ReadonlyArray<unknown>): boolean {
  return children.length > 0;
}
