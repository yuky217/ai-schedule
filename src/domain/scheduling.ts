import { CompletionRule, TaskStatus } from './enums';
import type { Task, TaskProgress } from './task';

/**
 * 排程与完成判定 —— 纯函数。
 *
 * 主文档 5.3：「优先级决定'谁先被排、谁被挤掉'，是自动填充的输入」。
 * 这段逻辑不碰数据库，输入任务数组、输出顺序，想验证行为时随时可以单测。
 */

export const isOpen = (t: Pick<Task, 'status'>) => t.status !== TaskStatus.Done;

/** 可推进：待办或进行中。等待中的不算（卡在别人身上） */
export const isActionable = (t: Pick<Task, 'status'>) =>
  t.status === TaskStatus.Todo || t.status === TaskStatus.Doing;

const HOUR = 36e5;

/**
 * 紧迫度打分：分越高越该先做。
 * 优先级是主项（权重 10），时间临近额外加权。
 */
export function urgencyScore(task: Task, now: Date = new Date()): number {
  const base = (3 - task.priority) * 10; // P0 = 30 → P3 = 0

  // 已到期 / 已开始的任务，用 ddl 优先，否则用开始时间
  const anchorIso = task.time.dueAt ?? task.time.startAt ?? null;
  let timeBonus = 0;
  if (anchorIso) {
    const hours = (new Date(anchorIso).getTime() - now.getTime()) / HOUR;
    if (hours <= 0) timeBonus = 25;
    else if (hours <= 24) timeBonus = 20;
    else if (hours <= 72) timeBonus = 12;
    else if (hours <= 24 * 7) timeBonus = 6;
  }
  return base + timeBonus;
}

/** 按"该先做谁"排序，已完成的排到最后 */
export function sortForScheduling(tasks: Task[], now: Date = new Date()): Task[] {
  return [...tasks].sort((a, b) => {
    if (isOpen(a) !== isOpen(b)) return isOpen(a) ? -1 : 1;
    return urgencyScore(b, now) - urgencyScore(a, now);
  });
}

/** 自动填充的输入：今天该先排哪一件 */
export function pickNextToSchedule(tasks: Task[], now: Date = new Date()): Task | null {
  return sortForScheduling(tasks.filter(isActionable), now)[0] ?? null;
}

/**
 * 够时长 / 够频率自动完成（主文档 5.1）。
 * 手动勾选的任务永远返回 false —— 必须由人来点。
 *
 * 频率型的次数**必须由调用方传进来**（`countInPeriod`），它来自打卡记录：
 * `habit-period.occurrencesInPeriod(dayKeys, task.repeat)`。
 * 以前这里读的是存在 progress 里的计数器，那个字段已经废弃，别再加回去。
 */
export function isCompletionSatisfied(
  task: Pick<Task, 'completion' | 'targetMinutes' | 'targetOccurrences'>,
  progress: TaskProgress = { accumulatedMinutes: 0 },
  countInPeriod = 0,
): boolean {
  if (task.completion === CompletionRule.Duration) {
    return task.targetMinutes != null && progress.accumulatedMinutes >= task.targetMinutes;
  }
  if (task.completion === CompletionRule.Frequency) {
    return task.targetOccurrences != null && countInPeriod >= task.targetOccurrences;
  }
  return false;
}

/** 时长型完成度 0~1，用于进度条 */
export function durationProgress(task: Pick<Task, 'targetMinutes' | 'progress'>): number {
  if (!task.targetMinutes || task.targetMinutes <= 0) return 0;
  return Math.min(1, task.progress.accumulatedMinutes / task.targetMinutes);
}

/** 频率型完成度 0~1。次数同样由打卡记录派生后传进来 */
export function frequencyProgress(
  task: Pick<Task, 'targetOccurrences'>,
  countInPeriod = 0,
): number {
  if (!task.targetOccurrences || task.targetOccurrences <= 0) return 0;
  return Math.min(1, countInPeriod / task.targetOccurrences);
}
