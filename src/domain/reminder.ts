import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';

import { TaskStatus } from './enums';
import { taskAnchor, type Task } from './task';

/**
 * 「这条任务的提醒到底几点响」。
 *
 * 为什么放 domain：判定必须与 entry/notifications.scheduleTaskReminder
 * 用同一套规则（有明确时间、时间在未来、提前量已过退准点），
 * 否则界面显示的会和实际排出去的不是一回事。
 * 更重要的背景：提醒调度有四个**静默失败口**（无时间、已过、权限、环境），
 * 失败时用户收不到任何反馈 —— 这里负责把"排没排上"变成可见的文字。
 */

/** 下一次提醒的触发时刻；null = 这条任务不会响 */
export function nextFireAt(task: Task, now: Date = new Date()): Date | null {
  if (task.status === TaskStatus.Done) return null;
  const anchor = taskAnchor(task);
  if (!anchor) return null;
  const anchorAt = new Date(anchor);
  if (Number.isNaN(anchorAt.getTime()) || anchorAt.getTime() <= now.getTime()) return null;

  const offset = task.reminderMinutesBefore ?? 0;
  const fireAt = new Date(anchorAt.getTime() - offset * 60_000);
  // 提前量时刻已过 → 排程会退回准点，这里显示准点才与实际一致
  return fireAt.getTime() > now.getTime() ? fireAt : anchorAt;
}

/** 提醒状态的一句话说明（详情页「提醒」行下方的状态字） */
export function describeNextFire(task: Task, now: Date = new Date()): string {
  if (task.status === TaskStatus.Done) return '已完成，不再提醒';

  const anchor = taskAnchor(task);
  if (!anchor) return '定个时间才会提醒';

  const anchorAt = new Date(anchor);
  if (Number.isNaN(anchorAt.getTime()) || anchorAt.getTime() <= now.getTime()) {
    return '时间已过，这次不会再提醒';
  }

  const fire = nextFireAt(task, now);
  return `将在 ${format(fire!, 'M月d日 HH:mm', { locale: zhCN })} 提醒你`;
}
