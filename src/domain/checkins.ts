import { addDays, differenceInCalendarDays, startOfDay } from 'date-fns';

import { parseDayKey, toDayKey } from '@/utils/datetime';

import type { BaseEntity } from './base';

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

/**
 * 打卡对任务本身的影响：**没有影响**（除频率型达标，见下）。
 *
 * 这里以前有两个函数（applyCheckinToTask / revertCheckinFromTask），
 * 它们维护了一个存在 task.progress 里的"本期次数"计数器。已经删掉，原因：
 *
 * 1. 那个计数器**没有任何地方负责归零**，"每周 3 次"达标后永远停在已完成；
 * 2. 同一块数据被三处各自 +1（打卡、重复任务滚动、专注），三种意思混在一起；
 * 3. 它本来就可以从这张表**算出来** —— 打卡记录里有日期，"本期做了几次"
 *    就是数一数有几条落在本期。
 *
 * 现在的分工是干净的：
 * - "今天做没做" → 这张表（`hasCheckedInOn`）
 * - "本期做了几次" → `domain/habit-period.occurrencesInPeriod`（现算，不存）
 * - "这件事还做不做" → task.status
 *
 * 频率型任务的目标达成是唯一需要"状态推导"的地方，规则放在
 * `domain/habit-period.desiredFrequencyStatus`（纯函数），由 state 层在 refresh
 * 时统一对账 —— 因为那里同时握着任务表和打卡表，是唯一能算准的地方。
 */

export const MS_PER_DAY = DAY;
