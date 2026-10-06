import { addDays, differenceInCalendarDays, startOfDay } from 'date-fns';

import { parseDayKey, nowIso, toDayKey } from '@/utils/datetime';

import type { BaseEntity } from './base';
import type { Task } from './task';

/**
 * 习惯打卡（纯逻辑 + 实体定义）。
 *
 * 为什么打卡要和"完成任务"分开：
 * 任务只有一次完成态（做完就完了），而习惯是同一件事反复发生（跑步第 30 天）。
 * 把每次打卡压成一条记录，"连续多少天""这个月做了几次""热力图"才有数据基础。
 */

export interface Checkin extends BaseEntity {
  taskId: string;
  /** 'YYYY-MM-DD'（本地日）。用本地日而不是时间戳，是因为"今天打没打卡"按自然日算 */
  dayKey: string;
  /** 当天第几分钟打的（可空，仅用于展示"早上就打了"这类信息） */
  minuteOfDay?: number | null;
  note?: string | null;
}

export interface StreakInfo {
  /** 当前连续天数 */
  current: number;
  /** 历史最长连续天数 */
  longest: number;
  /** 累计打卡次数 */
  total: number;
  /** 今天是否已打卡 */
  doneToday: boolean;
}

const DAY = 864e5;

/**
 * 连续天数。
 *
 * 关键规则：**今天还没打卡不算断**（昨天打了，连续就还在）。
 * 到当天 24 点为止没打才算断 —— 否则一过零点，界面上辛苦攒的连续天数就归零了，
 * 那会让人以为白做了。
 */
export function summarizeCheckins(
  dayKeys: ReadonlyArray<string>,
  today: Date = new Date(),
): StreakInfo {
  const unique = Array.from(new Set(dayKeys)).sort();
  if (!unique.length) {
    return { current: 0, longest: 0, total: 0, doneToday: false };
  }

  const todayStart = startOfDay(today);
  const days = unique.map((key) => parseDayKey(key)).filter((d): d is Date => d !== null);
  if (!days.length) return { current: 0, longest: 0, total: 0, doneToday: false };

  const todayKey = toDayKey(todayStart);
  const doneToday = unique.includes(todayKey);

  // 从最新一天往回数连续
  const sortedDesc = [...days].sort((a, b) => b.getTime() - a.getTime());
  const latest = sortedDesc[0]!;
  const gapFromToday = differenceInCalendarDays(todayStart, latest);

  let current = 0;
  if (gapFromToday <= 1) {
    current = 1;
    for (let i = 1; i < sortedDesc.length; i++) {
      const gap = differenceInCalendarDays(sortedDesc[i - 1]!, sortedDesc[i]!);
      if (gap === 1) current++;
      else break;
    }
  }

  // 最长连续：正序扫一遍
  let longest = 1;
  let run = 1;
  const asc = [...days].sort((a, b) => a.getTime() - b.getTime());
  for (let i = 1; i < asc.length; i++) {
    if (differenceInCalendarDays(asc[i]!, asc[i - 1]!) === 1) run++;
    else run = 1;
    if (run > longest) longest = run;
  }

  return { current, longest, total: days.length, doneToday };
}

export interface HeatCell {
  dayKey: string;
  /** 日期（本地零点） */
  date: Date;
  done: boolean;
  isToday: boolean;
  /** 0=周一 … 6=周日，用来排版 */
  weekday: number;
}

/**
 * 最近 N 天的打卡格子（含今天），旧的在前 —— 直接按顺序铺就是一条时间轴。
 * 只回传"有没有打卡"，不做次数深浅：个人习惯一天打几次没有意义，
 * 有了反而要解释"深色是什么意思"。
 */
export function buildHeatmap(
  dayKeys: ReadonlyArray<string>,
  days: number,
  today: Date = new Date(),
): HeatCell[] {
  const done = new Set(dayKeys);
  const todayStart = startOfDay(today);
  const total = Math.max(1, Math.floor(days));

  return Array.from({ length: total }, (_, i) => {
    const date = addDays(todayStart, i - (total - 1));
    const dayKey = toDayKey(date);
    // 周一 = 0（date-fns 的 getDay 里周日是 0）
    const weekday = (date.getDay() + 6) % 7;
    return {
      dayKey,
      date,
      done: done.has(dayKey),
      isToday: date.getTime() === todayStart.getTime(),
      weekday,
    };
  });
}

/** 打卡文案："连续 12 天" / "今天还没打卡" */
export function describeStreak(info: StreakInfo): string {
  if (info.total === 0) return '还没打过卡';
  if (info.current === 0) return `断了 · 最长 ${info.longest} 天`;
  if (info.doneToday) return `连续 ${info.current} 天`;
  return `连续 ${info.current} 天 · 今天还没打`;
}

/** 距离上次打卡多少天（用于"好久没做了"的提示） */
export function daysSinceLastCheckin(
  dayKeys: ReadonlyArray<string>,
  today: Date = new Date(),
): number | null {
  if (!dayKeys.length) return null;
  const sorted = Array.from(new Set(dayKeys)).sort();
  const latest = sorted[sorted.length - 1];
  if (!latest) return null;
  const date = parseDayKey(latest);
  if (!date) return null;
  return differenceInCalendarDays(startOfDay(today), date);
}

/** 今天是否已打卡（不依赖 summarize 的排序，供按钮直接判断） */
export function hasCheckedInOn(dayKeys: ReadonlyArray<string>, day: Date): boolean {
  return dayKeys.includes(toDayKey(startOfDay(day)));
}

/* ------------------------------------------------------------------ */
/* 打卡 ←→ 任务的联动                                                   */
/* ------------------------------------------------------------------ */

export interface CheckinOutcome {
  patch: Partial<Pick<Task, 'progress' | 'status' | 'completedAt'>>;
  /** 一句反馈，落库后展示给用户 */
  message: string;
}

/**
 * 打卡对任务本身的影响。
 *
 * **刻意不把任务标成完成**（即使它叫"每天跑步"）：
 * 习惯的"做完"是指"今天做过了"，明天还要做。把它标成 done 会让它从列表里消失，
 * 而它明天必须再出现。所以职责分清楚：
 * - "今天做没做" 由打卡记录回答（这张表）
 * - "这件事还做不做" 由 task.status 回答
 *
 * 唯一例外是**频率型**（"每周跑 3 次"）：它有明确的次数目标，打卡就是那个计数，
 * 够数就把本期目标标成达成 —— 这不是"替用户下结论"，而是目标本来就写在那儿。
 */
export function applyCheckinToTask(task: Pick<Task, 'completion' | 'progress' | 'targetOccurrences'>): CheckinOutcome {
  const occurrences = task.progress.occurrencesThisPeriod + 1;

  if (task.completion === 'frequency') {
    const target = task.targetOccurrences ?? null;
    const reached = target != null && target > 0 && occurrences >= target;
    return {
      patch: {
        progress: { ...task.progress, occurrencesThisPeriod: occurrences },
        // 本期目标达成，但保留"下一次从零开始"的余地：只置完成态，不动时间
        ...(reached ? { status: 'done' as const, completedAt: nowIso() } : {}),
      },
      message: reached
        ? `本期第 ${occurrences} 次，达到目标`
        : `本期第 ${occurrences} 次${target ? `（目标 ${target} 次）` : ''}`,
    };
  }

  return {
    patch: { progress: { ...task.progress, occurrencesThisPeriod: occurrences } },
    message: `累计打卡 ${occurrences} 次`,
  };
}

/** 撤销打卡：把次数减回去，并从完成态退回待办（如果原来是靠打卡完成的） */
export function revertCheckinFromTask(
  task: Pick<Task, 'completion' | 'progress' | 'targetOccurrences'>,
): CheckinOutcome {
  const current = task.progress.occurrencesThisPeriod;
  const occurrences = Math.max(0, current - 1);
  const target = task.targetOccurrences ?? null;
  const wasReached = target != null && target > 0 && current >= target;

  return {
    patch: {
      progress: { ...task.progress, occurrencesThisPeriod: occurrences },
      ...(wasReached ? { status: 'todo' as const, completedAt: null } : {}),
    },
    message: `已撤销，本期 ${occurrences} 次`,
  };
}

export const MS_PER_DAY = DAY;
