import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';

import { TaskStatus, TimeAttribute } from './enums';
import type { TaskKind } from './enums';
import { taskAnchor, type RepeatRule, type Task } from './task';

/**
 * 「这条任务的提醒到底几点响」。
 *
 * 为什么放 domain：判定必须与 entry/notifications.scheduleTaskReminder
 * 用同一套规则（**有没有设提醒**、有明确时间、时间在未来、提前量已过退准点），
 * 否则界面显示的会和实际排出去的不是一回事。
 * 更重要的背景：提醒调度有四个**静默失败口**（没设、无时间、已过、权限、环境），
 * 失败时用户收不到任何反馈 —— 这里负责把"排没排上"变成可见的文字。
 *
 * ## 提前量的三种状态（2026-10-08 用户拍板）
 *
 * `reminderMinutesBefore`：**`null` = 不提醒**（默认就是它）、`0` = 准点、`>0` = 提前 N 分钟。
 *
 * 以前 `null` 和 `0` 是一回事（都当准点响），于是"没点过提醒那一格"的人也照样被提醒，
 * 而且 chip 上显示成灰的「提醒」、行为上却会响 —— 界面说没设，实际设了。
 * 现在 `null` 有明确含义，而且与**课表**的同一个字段名取得了一致（那边一直是 null = 不提醒）。
 */

/** 下一次提醒的触发时刻；null = 这条任务不会响 */
export function nextFireAt(task: Task, now: Date = new Date()): Date | null {
  if (task.status === TaskStatus.Done) return null;
  // 没设提醒 = 不打扰。先于"有没有时间"判：没设就不该响，跟时间无关
  if (task.reminderMinutesBefore == null) return null;
  const anchor = taskAnchor(task);
  if (!anchor) return null;
  const anchorAt = new Date(anchor);
  if (Number.isNaN(anchorAt.getTime()) || anchorAt.getTime() <= now.getTime()) return null;

  const offset = task.reminderMinutesBefore;
  const fireAt = new Date(anchorAt.getTime() - offset * 60_000);
  // 提前量时刻已过 → 排程会退回准点，这里显示准点才与实际一致
  return fireAt.getTime() > now.getTime() ? fireAt : anchorAt;
}

/** 提醒状态的一句话说明（详情页「提醒」行下方的状态字） */
export function describeNextFire(task: Task, now: Date = new Date()): string {
  if (task.status === TaskStatus.Done) return '已完成，不再提醒';

  const anchor = taskAnchor(task);
  if (!anchor) return '定个时间才会提醒';

  if (task.reminderMinutesBefore == null) return '还没有提醒，想要就挑一个提前量';

  const anchorAt = new Date(anchor);
  if (Number.isNaN(anchorAt.getTime()) || anchorAt.getTime() <= now.getTime()) {
    return '时间已过，这次不会再提醒';
  }

  const fire = nextFireAt(task, now);
  return `将在 ${format(fire!, 'M月d日 HH:mm', { locale: zhCN })} 提醒你`;
}

/**
 * 「提了提醒、但没说提前多久」时，这件事该提前多久。
 *
 * 分类型给，而不是一律准点（准点对"要出门的事"等于没提醒）：
 * - **截止型**（"12:00 前交请假条"）：提前 1 小时 —— 截止要留出"把它做完"的时间，
 *   准点提醒等于通知你"已经晚了"。
 * - **重复 / 习惯型**（"每天 8 点吃药"、"每周三次跑步"）：准点 —— 到点就该做，
 *   提前 10 分钟没有额外价值。
 * - **其余**（开会、活动、约好的事）：提前 10 分钟 —— 你需要的是"该动身了"。
 *
 * 只用在"用户提了提醒但没给量"（"记得提醒我"）那一处。**没提就是不提醒**。
 */
export function defaultReminderMinutes(ctx: {
  kind: TaskKind;
  attribute: TimeAttribute;
  repeat?: RepeatRule | null;
}): number {
  if (ctx.attribute === TimeAttribute.Deadline) return 60;
  if (ctx.repeat || ctx.kind === 'habit') return 0;
  return 10;
}

/**
 * 这次记录最终该不该提醒、提前多久 —— **一个函数收口**。
 *
 * 界面（chip 上显示什么）与落库（存进 `reminderMinutesBefore` 的值）必须走同一条，
 * 否则会出现"chip 写着提前 10 分钟、库里存的是不提醒"这种两套口径。
 *
 * 优先级：**手动的压过识别的**（用户在 chip 里点过就以他为准，点了「不提醒」也是他点过），
 * 其次用文字里写明的提前量，只有"提了提醒没给量"才落到类型默认，其余一律不提醒。
 */
export function resolveReminderMinutes(args: {
  /** 用户当场在 chip 里设的值；**undefined = 没动过**，null = 明确不要提醒 */
  manual?: number | null;
  /** 文字里写明的提前量（0 = 准点） */
  parsed?: number | null;
  /** 文字里提了提醒但没写提前多久 */
  parsedUnspecified?: boolean;
  kind: TaskKind;
  attribute: TimeAttribute;
  repeat?: RepeatRule | null;
}): number | null {
  if (args.manual !== undefined) return args.manual;
  if (args.parsed != null) return args.parsed;
  if (args.parsedUnspecified) {
    return defaultReminderMinutes({
      kind: args.kind,
      attribute: args.attribute,
      repeat: args.repeat,
    });
  }
  return null;
}
