import { addDays, endOfDay, startOfMonth, startOfWeek } from 'date-fns';
import { describe, expect, it } from 'vitest';

import { calendarWindow, MONTH_GRID_ROWS, monthGridDays, WINDOW_PAD_DAYS, windowKey } from './calendar-window';

/**
 * 日历数据窗口。
 *
 * 这里有两条"差一天就是 bug"的规则，所以必须测：
 * 1. 月视图的范围要按**整周对齐的网格**取，按自然月取就会漏掉网格里属于上/下月的格子；
 * 2. 两端都要留余量，否则跨天拖拽、边界日的任务会在视图里凭空消失。
 */

const d = (y: number, m: number, day: number, h = 0): Date => new Date(y, m - 1, day, h, 0, 0, 0);
const DAY = 864e5;
const daysBetween = (a: Date, b: Date): number =>
  Math.round((new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime() -
    new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime()) / DAY);

describe('calendarWindow', () => {
  it('月视图按整周网格取范围：从网格首格的周一，到整 6 行的最后一格', () => {
    // 2026 年 10 月：1 号是周四 → 网格首格是 9 月 28 日（周一）
    const window = calendarWindow('month', d(2026, 10, 15), d(2026, 10, 15), 0);

    expect(window.from.getDay()).toBe(1);
    expect(window.from.getMonth()).toBe(8);
    expect(window.from.getDate()).toBe(28);

    // 网格固定 MONTH_GRID_ROWS 行，末格 = 首格 + (行数 × 7 - 1) 天 = 11 月 8 日（周日）
    expect(daysBetween(window.from, window.to)).toBe(MONTH_GRID_ROWS * 7 - 1);
    expect(window.to.getDay()).toBe(0);
    expect(window.to.getMonth()).toBe(10);
    expect(window.to.getDate()).toBe(8);
  });

  it('关掉余量也必须盖住整张网格的最后一行', () => {
    // 回归测试：窗口曾经只算到"包含月末那天的周日"，某些月份会比 6 行网格整整差一行。
    // 那时只是靠"余量恰好等于 7 天"蒙对 —— 把 padDays 传成 0 就会露馅。
    for (let month = 1; month <= 12; month++) {
      const cursor = d(2026, month, 15);
      const bare = calendarWindow('month', cursor, cursor, 0);
      const gridFirst = startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 });
      const gridLast = addDays(gridFirst, MONTH_GRID_ROWS * 7 - 1);

      expect(bare.from.getTime()).toBeLessThanOrEqual(gridFirst.getTime());
      expect(bare.to.getTime()).toBeGreaterThanOrEqual(endOfDay(gridLast).getTime());
    }
  });

  it('月视图：1 号恰好是周一时，范围从 1 号开始', () => {
    // 2026 年 6 月：1 号是周一
    const window = calendarWindow('month', d(2026, 6, 10), d(2026, 6, 10), 0);
    expect(window.from.getMonth()).toBe(5);
    expect(window.from.getDate()).toBe(1);
    expect(window.from.getDay()).toBe(1);
  });

  it('周视图是周一到周日', () => {
    const window = calendarWindow('week', d(2026, 10, 7), d(2026, 10, 7), 0);
    expect(window.from.getDay()).toBe(1);
    expect(window.to.getDay()).toBe(0);
    expect(daysBetween(window.from, window.to)).toBe(6);
  });

  it('日视图只有那一天，且含当天最后一毫秒', () => {
    const window = calendarWindow('day', d(2026, 10, 7), d(2026, 10, 7), 0);
    expect(window.from.getHours()).toBe(0);
    expect(window.from.getMinutes()).toBe(0);
    expect(window.to.getDate()).toBe(7);
    expect(window.to.getHours()).toBe(23);
    expect(window.to.getMinutes()).toBe(59);
  });

  it('默认两端各留余量，且余量可以关掉', () => {
    const padded = calendarWindow('day', d(2026, 10, 7), d(2026, 10, 7));
    const bare = calendarWindow('day', d(2026, 10, 7), d(2026, 10, 7), 0);

    expect(daysBetween(padded.from, bare.from)).toBe(WINDOW_PAD_DAYS);
    expect(daysBetween(bare.to, padded.to)).toBe(WINDOW_PAD_DAYS);
    expect(padded.from.getTime()).toBeLessThan(bare.from.getTime());
  });

  it('月视图的窗口一定比一个自然月大（含余量与网格补位）', () => {
    for (let month = 1; month <= 12; month++) {
      const cursor = d(2026, month, 15);
      const window = calendarWindow('month', cursor, cursor);
      const span = daysBetween(window.from, window.to) + 1;
      expect(span).toBeGreaterThanOrEqual(28 + WINDOW_PAD_DAYS * 2);
    }
  });

  it('翻月时相邻两个月的窗口必然有重叠（否则边界任务会闪）', () => {
    for (let month = 1; month <= 11; month++) {
      const a = calendarWindow('month', d(2026, month, 15), d(2026, month, 15));
      const b = calendarWindow('month', d(2026, month + 1, 15), d(2026, month + 1, 15));
      expect(b.from.getTime()).toBeLessThanOrEqual(a.to.getTime());
    }
  });

  it('非法余量回落到默认值，不产生 NaN 日期', () => {
    const window = calendarWindow('week', d(2026, 10, 7), d(2026, 10, 7), Number.NaN);
    expect(Number.isNaN(window.from.getTime())).toBe(false);
    expect(Number.isNaN(window.to.getTime())).toBe(false);
  });

  it('不改动传入的 cursor / selected', () => {
    const cursor = d(2026, 10, 15);
    const selected = d(2026, 10, 20);
    const cursorTime = cursor.getTime();
    const selectedTime = selected.getTime();
    calendarWindow('month', cursor, selected);
    expect(cursor.getTime()).toBe(cursorTime);
    expect(selected.getTime()).toBe(selectedTime);
  });
});

describe('monthGridDays', () => {
  /**
   * 这个函数是"月历上到底有哪几格"的唯一出处：组件渲染、圆点分桶、
   * 拖拽命中检测三处都从它拿日期。三处一旦各算一份，就会出现
   * "格子在屏幕上、数据却没算它"（或反过来）—— 而这种 bug 只在个别月份露头。
   */
  it('整张网格：从本月 1 号所在那周的周一算起，固定 MONTH_GRID_ROWS×7 天', () => {
    // 2026 年 10 月：1 号是周四 → 首格 9 月 28 日（周一）
    const days = monthGridDays(new Date(2026, 9, 15));
    expect(days).toHaveLength(MONTH_GRID_ROWS * 7);
    expect(days[0].getDay()).toBe(1);
    expect(days[0].getMonth()).toBe(8);
    expect(days[0].getDate()).toBe(28);
    // 最后一格是周日，且正好是首格 + (行数×7-1) 天
    expect(days[days.length - 1].getDay()).toBe(0);
    expect(daysBetween(days[0], days[days.length - 1])).toBe(MONTH_GRID_ROWS * 7 - 1);
  });

  it('每天都不同、且严格连续（不会漏一天或多一天）', () => {
    const days = monthGridDays(new Date(2026, 1, 15));
    for (let i = 1; i < days.length; i += 1) {
      expect(daysBetween(days[i - 1], days[i])).toBe(1);
    }
  });

  it('和 calendarWindow 盖的是同一段：网格每一格都落在窗口里', () => {
    for (let month = 1; month <= 12; month += 1) {
      const cursor = d(2026, month, 15);
      const window = calendarWindow('month', cursor, cursor, 0);
      for (const day of monthGridDays(cursor)) {
        const t = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
        expect(t).toBeGreaterThanOrEqual(window.from.getTime());
        expect(t).toBeLessThanOrEqual(window.to.getTime());
      }
    }
  });

  it('任何一个月都至少覆盖本月 1 号到最后一天', () => {
    for (let month = 1; month <= 12; month += 1) {
      const cursor = d(2026, month, 15);
      const days = monthGridDays(cursor);
      const keys = new Set(days.map((x) => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`));
      const last = new Date(2026, month, 0);
      for (let day = 1; day <= last.getDate(); day += 1) {
        expect(keys.has(`2026-${month - 1}-${day}`)).toBe(true);
      }
    }
  });
});

describe('windowKey', () => {
  it('同一范围得到同一个键（哪怕 Date 是新对象）', () => {
    const a = calendarWindow('month', d(2026, 10, 15), d(2026, 10, 15));
    const b = calendarWindow('month', d(2026, 10, 15), d(2026, 10, 15));
    expect(a.from).not.toBe(b.from);
    expect(windowKey(a)).toBe(windowKey(b));
  });

  it('范围变了键就变', () => {
    const a = calendarWindow('month', d(2026, 10, 15), d(2026, 10, 15));
    const b = calendarWindow('month', d(2026, 11, 15), d(2026, 11, 15));
    expect(windowKey(a)).not.toBe(windowKey(b));
  });

  it('月视图里只改"选中日"不会让窗口键变化（避免无谓重查）', () => {
    const a = calendarWindow('month', d(2026, 10, 15), d(2026, 10, 3));
    const b = calendarWindow('month', d(2026, 10, 15), d(2026, 10, 28));
    expect(windowKey(a)).toBe(windowKey(b));
  });
});
