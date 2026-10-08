import { addDays, endOfDay, endOfWeek, startOfDay, startOfMonth, startOfWeek } from 'date-fns';

/**
 * 日历的数据窗口。
 *
 * 为什么要有这个东西：日历绝不能"一次把全部带时间的任务读进来"。
 * 个人日程攒上几年就是几千条，而用户屏幕上永远只有一个月 ——
 * 每次记录、每次改期都全量读一遍，是纯粹的浪费，而且随年头线性变差。
 *
 * 但窗口开小了会出真问题（某个任务在该出现的视图里凭空消失），
 * 所以这里有两条刻意的设计：
 *
 * 1. **月视图按"整周对齐的网格"取范围，不是按自然月。**
 *    月视图渲染出来的是一张按周对齐的网格（本月 1 号可能落在第一行的周三），
 *    按自然月取范围，网格里属于上/下月的那些格子就会拿不到数据。
 *    而且网格**固定 MONTH_GRID_ROWS 行**（高度才稳定），所以范围要按整张网格算，
 *    不能只算到"包含月末那天的周日" —— 那样在某些月份会差整整一行。
 *    这条曾经靠"余量恰好等于 7 天"蒙对过，但把 padDays 传成 0 就会露馅。
 *
 * 2. **两端各多留 PAD_DAYS 天。**
 *    跨天拖拽、翻页动画、边界日的任务都发生在这个余量里。
 *    多读几天的代价可以忽略，读漏一天就是用户看得见的 bug。
 */

export type CalendarRangeMode = 'month' | 'week' | 'day' | 'timetable' | 'todo';

export interface CalendarWindow {
  /** 起点（当天 00:00） */
  from: Date;
  /** 终点（当天 23:59:59.999） */
  to: Date;
}

/**
 * 月视图渲染的周行数。
 *
 * 这是 domain 与组件的**共同契约**：`components/calendar-month.tsx` 直接引用它来渲染，
 * 窗口按它算范围。两边各写一份 6 迟早会走岔（一边 6 一边 5，最后一行就静默少数据）。
 */
export const MONTH_GRID_ROWS = 6;

/**
 * 月历网格上实际渲染的那些日期（整张 6×7）。
 *
 * 月历渲染、圆点分桶、拖拽命中检测三处必须拿**同一份**日期，
 * 否则会出现"格子在屏幕上、数据却没算它"。行数固定 `MONTH_GRID_ROWS`
 * 是为了月与月之间高度稳定 —— 这里不按"装得下几行"去省一行。
 */
export function monthGridDays(month: Date): Date[] {
  const first = startOfWeek(startOfMonth(month), WEEK_OPTIONS);
  return Array.from({ length: MONTH_GRID_ROWS * 7 }, (_, i) => addDays(first, i));
}

/** 两端各多留的天数 */
export const WINDOW_PAD_DAYS = 7;

const WEEK_OPTIONS = { weekStartsOn: 1 } as const;

export function calendarWindow(
  mode: CalendarRangeMode,
  cursor: Date,
  selected: Date,
  padDays: number = WINDOW_PAD_DAYS,
): CalendarWindow {
  const pad = Math.max(0, Math.trunc(Number.isFinite(padDays) ? padDays : WINDOW_PAD_DAYS));

  let from: Date;
  let to: Date;

  if (mode === 'month') {
    from = startOfWeek(startOfMonth(cursor), WEEK_OPTIONS);
    to = endOfDay(addDays(from, MONTH_GRID_ROWS * 7 - 1));
  } else if (mode === 'week' || mode === 'timetable') {
    // 课表视图和"周"看的是同一段范围：它的数据走 store 里的课程，但日历下方
    // 仍然按这一周取任务（课表周的同一批时间窗，不另开一套口径）
    from = startOfWeek(cursor, WEEK_OPTIONS);
    to = endOfWeek(cursor, WEEK_OPTIONS);
  } else {
    // 「日」按选中的那一天取范围。
    // 「待办」也落进这里：它其实**不用这个窗口**（用的是 store 里的全量任务，
    // 因为"没排时间的待办"本来就不在任何一个时间窗里）。给它一个今天的范围只是
    // 为了让这个纯函数有确定返回值 —— 调用方不必为它写特判分支。
    from = startOfDay(selected);
    to = endOfDay(selected);
  }

  return { from: addDays(from, -pad), to: addDays(to, pad) };
}

/**
 * 窗口的字符串键。
 *
 * 给 React 的 effect 当依赖用：Date 对象每次渲染都是新的引用，
 * 直接放进依赖数组会每次渲染都触发重新查库。转成字符串之后，
 * "范围没变"和"范围变了"能被准确区分开。
 */
export function windowKey(window: CalendarWindow): string {
  return `${window.from.toISOString()}~${window.to.toISOString()}`;
}
