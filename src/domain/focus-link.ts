import { nowIso } from '@/utils/datetime';

import { CompletionRule, TaskStatus, TimeAttribute } from './enums';
import { describePeriodProgress } from './habit-period';
import type { Task, TaskTime } from './task';

/**
 * 任务 ←→ 专注的联动（主文档 5.1：执行型"点击 → 进专注"）。
 *
 * 主流程的「行」这一环此前是断的：任务能安排到日历，但"开始做"没有入口，
 * 专注场次也跟任务毫无关系。这里定义"一次专注结束后，这条任务该变成什么样"。
 *
 * 三条规则，按完成判定分流：
 * - **时长型**：累加投入分钟数，够 `targetMinutes` 才算完成（"写够 2 小时"）；
 * - **频率型**：一次专注 = 今天做过一次，**写一条打卡记录**；本期做满几次由
 *   打卡记录现算（`domain/habit-period`），这里不自己下结论；
 * - **勾选型**：只累计投入时长，完成与否仍由用户自己决定 ——
 *   把"我坐下来干了 20 分钟"直接等同于"这事做完了"，是替用户下结论。
 *
 * 纯函数，不碰数据库：写库由 state 层统一收口。
 */

export interface FocusOutcome {
  /** 要写回任务的字段补丁 */
  patch: Partial<Task>;
  /** 这次专注是否让任务达标完成 */
  completed: boolean;
  /**
   * 这次专注是否要记成"今天做过一次"（频率型）。
   * state 层据此写一条打卡记录 —— 频率的进度来自打卡表，不来自某个计数器。
   */
  countsAsOccurrence: boolean;
  /** 一句反馈，落库后展示给用户 */
  message: string;
}

/** 不到一分钟的专注不记账，避免误触一下就把次数刷上去 */
const MIN_FOCUS_SECONDS = 60;

export function applyFocusToTask(task: Task, seconds: number): FocusOutcome | null {
  const total = Math.max(0, Math.floor(seconds));
  if (total < MIN_FOCUS_SECONDS) return null;

  const minutes = Math.floor(total / 60);
  const accumulatedMinutes = task.progress.accumulatedMinutes + minutes;

  // 频率型：一次专注 = 今天做过一次。
  // 这里**不再自己算达标**，只把"今天做过"这件事交给打卡表 —— 本期做了几次
  // 由 habit-period 从记录里现算，达成与否由 state 层对账（见 habit-period.desiredFrequencyStatus）。
  // 以前在这里 +1 并直接置完成，正是"永远停在做完"的一半原因。
  if (task.completion === CompletionRule.Frequency) {
    return {
      patch: { progress: { ...task.progress, accumulatedMinutes } },
      completed: false,
      countsAsOccurrence: true,
      message: `记下今天这一次，共投入 ${accumulatedMinutes} 分钟`,
    };
  }

  // 时长型：累计够时长才完成（单调累加，没有周期问题，保持原样）
  if (task.completion === CompletionRule.Duration) {
    const target = task.targetMinutes ?? null;
    const done = target != null && target > 0 && accumulatedMinutes >= target;
    return {
      patch: {
        progress: { ...task.progress, accumulatedMinutes },
        ...(done ? { status: TaskStatus.Done, completedAt: nowIso() } : {}),
      },
      completed: done,
      countsAsOccurrence: false,
      message: done
        ? `累计 ${accumulatedMinutes} 分钟，达标完成`
        : `累计 ${accumulatedMinutes}${
            target ? `/${target}` : ''
          } 分钟，还差一点点`,
    };
  }

  // 勾选型：只记账，不替用户勾完成
  return {
    patch: { progress: { ...task.progress, accumulatedMinutes } },
    completed: false,
    countsAsOccurrence: false,
    message: `这次投入 ${minutes} 分钟，累计 ${accumulatedMinutes} 分钟`,
  };
}

/**
 * 任务详情页的进度文案：让"投入了多少"有个显式的落点。
 *
 * 频率型需要调用方把**本期次数**传进来（它来自打卡记录，见 domain/habit-period）。
 * 没传就不猜，退回显示投入时长 —— 宁可少说一句，也不显示一个可能过期的数字。
 */
export function describeProgress(task: Task, countInPeriod?: number | null): string | null {
  const { accumulatedMinutes } = task.progress;

  if (task.completion === CompletionRule.Duration) {
    const target = task.targetMinutes;
    return target
      ? `已投入 ${accumulatedMinutes} / ${target} 分钟`
      : `已投入 ${accumulatedMinutes} 分钟`;
  }

  if (task.completion === CompletionRule.Frequency) {
    if (countInPeriod == null) {
      return accumulatedMinutes > 0 ? `已投入 ${accumulatedMinutes} 分钟` : null;
    }
    return describePeriodProgress(task.repeat, task.targetOccurrences, countInPeriod);
  }

  return accumulatedMinutes > 0 ? `已投入 ${accumulatedMinutes} 分钟` : null;
}

/* ------------------------------------------------------------------ */
/* 专注 → 日历                                                          */
/* ------------------------------------------------------------------ */

/**
 * 把一次专注的起止变成"一段时间"。
 *
 * 专注是本项目里**唯一知道"这件事我实际花了多久"的地方**，而日历记的是"什么时候"。
 * 两者合起来才是一条完整的记录：几点到几点，做了什么。落库之后它会和别的已完成事项
 * 一样出现在日历上（灰掉的那条）。
 *
 * 不到一分钟不落 —— 手滑点开又退出，不该在日历上留下一条垃圾记录。
 * 结束时间不超过"现在"：会话可能被挂了一夜才收尾，那种时长不能当成真实占用。
 */
export function focusSpan(
  startedAt: string,
  actualSeconds: number,
  now: Date = new Date(),
): { startAt: string; endAt: string } | null {
  const start = Date.parse(startedAt);
  if (!Number.isFinite(start)) return null;

  const seconds = Math.max(0, Math.floor(actualSeconds));
  if (seconds < MIN_FOCUS_SECONDS) return null;

  const end = Math.min(start + seconds * 1000, now.getTime());
  // 至少留一分钟，否则日历上会是一条零长度的段
  return {
    startAt: new Date(start).toISOString(),
    endAt: new Date(Math.max(end, start + 60_000)).toISOString(),
  };
}

/**
 * 这次专注该不该给任务补上时间？
 *
 * **只补"还没安排过"的**（`attribute === 'none'`）—— 已经排到日历上的任务，
 * 它自己的时间就是它该有的时间，专注只是投入的时长，不要去改用户的安排。
 */
export function shouldStampFocusSpan(task: Pick<Task, 'time'>): boolean {
  return task.time.attribute === TimeAttribute.None;
}

/** 补时间用的 TaskTime（固定型，只有这一段，不带截止） */
export function focusSpanTime(span: { startAt: string; endAt: string }): TaskTime {
  return { attribute: TimeAttribute.Fixed, startAt: span.startAt, endAt: span.endAt, dueAt: null };
}
