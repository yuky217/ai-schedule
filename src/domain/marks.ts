import { differenceInCalendarDays, startOfDay } from 'date-fns';

import { parseDayKey } from '@/utils/datetime';

import type { Mark } from './container';
import { MarkKind } from './enums';

/**
 * 纪念日（主文档 5.3 的"标记"）。
 *
 * 它**独立于任务**：不提醒、不排程、不进收集箱，只是"一个日子"。
 * 分两种：
 * - 倒数（countdown）：还剩几天 —— 生日、考试、出发日；
 * - 正数（countup）：已经多少天 —— 在一起多久、戒烟多久、入职多久。
 *
 * 开了"每年重复"的倒数日会自动滚到下一次周年；
 * 正数日开了年度重复则会额外标出"第几年"。
 */

const DAYS_PER_YEAR = 365.2425;
/** 已经过去的倒数日统一排到"未来"之后，用一个远大于任何天数间隔的基数实现 */
const PAST_OFFSET = 1e6;

export interface MarkView {
  mark: Mark;
  /** 倒数 = 还剩几天（负数表示已经过去）；正数 = 已经过去几天 */
  days: number;
  /** 大字：数字，或"今天" */
  headline: string;
  /** 小字：单位与说明 */
  caption: string;
  /** 排序键（同类内），越小越靠前 */
  order: number;
}

/** 把周年滚到"下一次"（含今天） */
function nextAnnual(base: Date, now: Date): Date {
  const thisYear = new Date(now.getFullYear(), base.getMonth(), base.getDate());
  if (differenceInCalendarDays(thisYear, startOfDay(now)) >= 0) return thisYear;
  return new Date(now.getFullYear() + 1, base.getMonth(), base.getDate());
}

export function describeMark(mark: Mark, now: Date = new Date()): MarkView {
  const base = parseDayKey(mark.date);
  const today = startOfDay(now);

  if (!base) {
    return { mark, days: 0, headline: '—', caption: '日期不合法', order: Number.MAX_SAFE_INTEGER };
  }

  if (mark.kind === MarkKind.CountUp) {
    const days = differenceInCalendarDays(today, base);
    const years = mark.repeatYearly ? Math.floor(days / DAYS_PER_YEAR) : 0;
    return {
      mark,
      days,
      headline: days < 0 ? '0' : String(days),
      caption:
        days < 0 ? '还没到这天' : years >= 1 ? `天 · 已经第 ${years + 1} 年` : '天',
      order: -days,
    };
  }

  // 倒数
  const target = mark.repeatYearly ? nextAnnual(base, now) : base;
  const days = differenceInCalendarDays(target, today);

  if (days === 0) {
    return {
      mark,
      days,
      headline: '今天',
      caption: mark.repeatYearly ? `第 ${target.getFullYear() - base.getFullYear()} 周年` : '就是这天',
      order: 0,
    };
  }
  if (days > 0) {
    return {
      mark,
      days,
      headline: String(days),
      caption: mark.repeatYearly ? `天后 · 第 ${target.getFullYear() - base.getFullYear()} 周年` : '天后',
      order: days,
    };
  }
  // 已经过去的日子排到最后：它不该抢占"即将发生"的位置
  return { mark, days, headline: String(-days), caption: '天前', order: PAST_OFFSET - days };
}

/**
 * 列表顺序：倒数日在前（越近越靠前），正数日在后（天数越多越靠前）。
 * 这样"最近要发生的事"永远在视野顶部。
 */
export function sortMarkViews(views: MarkView[]): MarkView[] {
  return [...views].sort((a, b) => {
    const aIsCountdown = a.mark.kind === MarkKind.Countdown ? 0 : 1;
    const bIsCountdown = b.mark.kind === MarkKind.Countdown ? 0 : 1;
    if (aIsCountdown !== bIsCountdown) return aIsCountdown - bIsCountdown;
    return a.order - b.order;
  });
}

/** 首页卡片：先把"还没发生"的倒数日按远近排出来，不够再用正数日补齐 */
export function pickUpcoming(views: MarkView[], limit = 3): MarkView[] {
  const upcoming = views.filter((v) => v.mark.kind === MarkKind.Countdown && v.days >= 0);
  if (upcoming.length >= limit) return upcoming.slice(0, limit);
  const countups = views.filter((v) => v.mark.kind === MarkKind.CountUp);
  return [...upcoming, ...countups].slice(0, limit);
}
