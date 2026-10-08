import { describe, expect, it } from 'vitest';

import { DAY_STRIP_COLS, DAY_STRIP_COUNT, dayStripDays, dayStripIndexAt } from './day-strip';

/** 一整条：350 宽（7 列 × 50）、96 高（2 行 × 48），摆在屏幕下半部分 */
const rect = { x: 40, y: 600, width: 350, height: 96 };

describe('dayStripDays', () => {
  it('从今天零点起连续排，不带时刻', () => {
    const days = dayStripDays(new Date(2026, 9, 8, 15, 30), 3);
    expect(days.map((d) => d.getDate())).toEqual([8, 9, 10]);
    expect(days[0]!.getHours()).toBe(0);
    expect(days[0]!.getMinutes()).toBe(0);
    expect(days[2]!.getHours()).toBe(0);
  });

  it('跨月不断档', () => {
    const days = dayStripDays(new Date(2026, 9, 30, 8, 0), 4);
    expect(days.map((d) => `${d.getMonth() + 1}-${d.getDate()}`)).toEqual([
      '10-30',
      '10-31',
      '11-1',
      '11-2',
    ]);
  });

  it('默认正好排满两行', () => {
    expect(dayStripDays(new Date(2026, 9, 8)).length).toBe(DAY_STRIP_COUNT);
    expect(DAY_STRIP_COUNT % DAY_STRIP_COLS).toBe(0);
  });

  it('不改动传进来的基准时刻', () => {
    const base = new Date(2026, 9, 8, 23, 59);
    dayStripDays(base, 2);
    expect(base.getDate()).toBe(8);
    expect(base.getHours()).toBe(23);
  });
});

describe('dayStripIndexAt', () => {
  it('第一个格与最后一个格都在边界内', () => {
    expect(dayStripIndexAt(rect, { x: 40, y: 600 })).toBe(0);
    expect(dayStripIndexAt(rect, { x: 389, y: 695 })).toBe(13);
  });

  it('第二行第一个格是第 7 格（0 起）', () => {
    expect(dayStripIndexAt(rect, { x: 65, y: 672 })).toBe(7);
  });

  it('落到条外一律 null —— 宁可什么都不做，也不猜一个用户没指的日期', () => {
    expect(dayStripIndexAt(rect, { x: 39, y: 640 })).toBeNull();
    expect(dayStripIndexAt(rect, { x: 391, y: 640 })).toBeNull();
    expect(dayStripIndexAt(rect, { x: 200, y: 599 })).toBeNull();
    expect(dayStripIndexAt(rect, { x: 200, y: 697 })).toBeNull();
  });

  it('还没量到尺寸时不接（条刚浮出、格子还没量到的那一瞬）', () => {
    expect(dayStripIndexAt({ x: 0, y: 0, width: 0, height: 0 }, { x: 0, y: 0 })).toBeNull();
  });

  it('格子数不足一行时不会算出不存在的格', () => {
    // 只有 5 个格子（宽 70 → 每格 10），第 6 格的位置不该有东西
    const half = { x: 0, y: 0, width: 70, height: 20 };
    expect(dayStripIndexAt(half, { x: 45, y: 10 }, 5)).toBe(4);
    expect(dayStripIndexAt(half, { x: 65, y: 10 }, 5)).toBeNull();
  });
});
