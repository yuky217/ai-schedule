import { describe, expect, it } from 'vitest';

import type { GanttItem } from './gantt';
import {
  canReschedule,
  daysFromDrag,
  describeDayShift,
  ganttTicks,
  layoutGantt,
  shiftIsoByDays,
} from './gantt';

/**
 * 甘特图：布局与拖拽改期。
 *
 * 拖拽这块尤其需要测：它把"手指移了多少像素"翻译成"日子挪了几天"，
 * 而像素 → 天数是个取整过程 —— 取整规则写错，用户会在真机上感觉到
 * "往左拖要更远才生效"，但翻代码看不出任何问题。
 */

const iso = (y: number, m: number, d: number, h = 0, min = 0): string =>
  new Date(y, m - 1, d, h, min, 0, 0).toISOString();

const item = (over: Partial<GanttItem> = {}): GanttItem => ({
  id: 'x',
  label: 'x',
  kind: 'task',
  ...over,
});

describe('canReschedule', () => {
  it('任务条只要有任一时间就能拖', () => {
    expect(canReschedule(item({ startAt: iso(2026, 10, 3, 9, 0) }))).toBe(true);
    expect(canReschedule(item({ dueAt: iso(2026, 10, 3) }))).toBe(true);
    expect(canReschedule(item({ endAt: iso(2026, 10, 5, 18, 0) }))).toBe(true);
  });

  it('完全没有时间的任务条不能拖', () => {
    expect(canReschedule(item())).toBe(false);
    expect(canReschedule(item({ startAt: null, dueAt: null, endAt: null }))).toBe(false);
  });

  it('容器条不能拖 —— 它是这张图的框架', () => {
    expect(
      canReschedule(item({ kind: 'container', startAt: iso(2026, 10, 1), endAt: iso(2026, 10, 31) })),
    ).toBe(false);
  });
});

describe('shiftIsoByDays', () => {
  it('空值原样返回 null，不会凭空造出时间', () => {
    expect(shiftIsoByDays(null, 3)).toBeNull();
    expect(shiftIsoByDays(undefined, 3)).toBeNull();
    expect(shiftIsoByDays('', 3)).toBeNull();
  });

  it('平移 0 天原样返回', () => {
    const source = iso(2026, 10, 3, 9, 30);
    expect(shiftIsoByDays(source, 0)).toBe(source);
  });

  it('往后 / 往前平移整天', () => {
    const forward = new Date(shiftIsoByDays(iso(2026, 10, 3, 9, 0), 3) as string);
    expect(forward.getFullYear()).toBe(2026);
    expect(forward.getMonth()).toBe(9);
    expect(forward.getDate()).toBe(6);

    const backward = new Date(shiftIsoByDays(iso(2026, 10, 3, 9, 0), -5) as string);
    expect(backward.getMonth()).toBe(8);
    expect(backward.getDate()).toBe(28);
  });

  it('跨月跨年都对', () => {
    const toNextYear = new Date(shiftIsoByDays(iso(2026, 12, 30, 8, 0), 3) as string);
    expect(toNextYear.getMonth()).toBe(0);
    expect(toNextYear.getFullYear()).toBe(2027);

    const toLastYear = new Date(shiftIsoByDays(iso(2026, 1, 2, 8, 0), -3) as string);
    expect(toLastYear.getMonth()).toBe(11);
    expect(toLastYear.getFullYear()).toBe(2025);
  });

  it('保留原本的时分 —— 改期不该把 09:00 的会变成 00:00', () => {
    const shifted = new Date(shiftIsoByDays(iso(2026, 10, 3, 9, 30), 10) as string);
    expect(shifted.getHours()).toBe(9);
    expect(shifted.getMinutes()).toBe(30);
    expect(shifted.getDate()).toBe(13);
  });

  it('小数天数按截断处理', () => {
    const shifted = new Date(shiftIsoByDays(iso(2026, 10, 3, 9, 0), 1.9) as string);
    expect(shifted.getDate()).toBe(4);
  });

  it('非法天数不动原值，非法时间返回 null', () => {
    const source = iso(2026, 10, 3, 9, 0);
    expect(shiftIsoByDays(source, Number.NaN)).toBe(source);
    expect(shiftIsoByDays(source, Number.POSITIVE_INFINITY)).toBe(source);
    expect(shiftIsoByDays('不是时间', 3)).toBeNull();
  });
});

describe('daysFromDrag', () => {
  it('按轴宽换算：每天 10px 时，25px = 3 天', () => {
    expect(daysFromDrag(25, 140, 14)).toBe(3);
    expect(daysFromDrag(14, 140, 14)).toBe(1);
    expect(daysFromDrag(15, 140, 14)).toBe(2);
    expect(daysFromDrag(0, 140, 14)).toBe(0);
  });

  it('参数不合法时返回 0，不产生 NaN 位移', () => {
    expect(daysFromDrag(50, 0, 14)).toBe(0);
    expect(daysFromDrag(50, 140, 0)).toBe(0);
    expect(daysFromDrag(Number.NaN, 140, 14)).toBe(0);
  });

  it('7 天的窄轴也能正确换算', () => {
    expect(daysFromDrag(60, 210, 7)).toBe(2);
    expect(daysFromDrag(45, 210, 7)).toBe(2);
  });

  it('左右完全对称：正负半格必须换同样的天数', () => {
    // 回归测试：JS 的 Math.round(-2.5) 是 -2，而 Math.round(2.5) 是 3。
    // 直接用朴素写法会变成"往左拖半格不换天、往右拖半格换天"。
    for (const px of [5, 15, 25, 35, 45, 55, 100, 250]) {
      expect(daysFromDrag(-px, 140, 14)).toBe(-daysFromDrag(px, 140, 14));
    }
    expect(daysFromDrag(25, 140, 14)).toBe(3);
    expect(daysFromDrag(-25, 140, 14)).toBe(-3);
  });
});

describe('describeDayShift', () => {
  it('预览文案', () => {
    expect(describeDayShift(0)).toBe('原位');
    expect(describeDayShift(3)).toBe('往后 3 天');
    expect(describeDayShift(-2)).toBe('往前 2 天');
  });
});

describe('layoutGantt 回归', () => {
  const now = new Date(2026, 9, 7);

  it('只有一天的条目画成点', () => {
    const layout = layoutGantt([item({ startAt: iso(2026, 10, 3, 9, 0) })], now);
    expect(layout.rows).toHaveLength(1);
    expect(layout.rows[0]!.point).toBe(true);
    expect(layout.todayRatio).not.toBeNull();
    expect(layout.days).toBeGreaterThanOrEqual(14);
  });

  it('跨天条目是宽度为正的条子', () => {
    const layout = layoutGantt([item({ startAt: iso(2026, 10, 3), endAt: iso(2026, 10, 9) })], now);
    expect(layout.rows[0]!.point).toBe(false);
    expect(layout.rows[0]!.width).toBeGreaterThan(0);
    expect(layout.rows[0]!.left).toBeGreaterThanOrEqual(0);
    expect(layout.rows[0]!.left).toBeLessThanOrEqual(1);
  });

  it('没有任何条目时给一条空轴，不崩', () => {
    const layout = layoutGantt([], now);
    expect(layout.rows).toEqual([]);
    expect(layout.days).toBe(14);
    expect(layout.todayRatio).not.toBeNull();
  });

  it('起止写反了也能纠正过来', () => {
    const layout = layoutGantt([item({ startAt: iso(2026, 10, 9), endAt: iso(2026, 10, 3) })], now);
    expect(layout.rows[0]!.start.getTime()).toBeLessThan(layout.rows[0]!.end.getTime());
  });

  it('刻度按跨度给密度，标签不重复', () => {
    const layout = layoutGantt([item({ startAt: iso(2026, 10, 3), endAt: iso(2026, 10, 9) })], now);
    const ticks = ganttTicks(layout);
    expect(ticks.length).toBeGreaterThan(0);
    expect(new Set(ticks.map((t) => t.label)).size).toBe(ticks.length);
    for (const tick of ticks) {
      expect(tick.ratio).toBeGreaterThanOrEqual(0);
      expect(tick.ratio).toBeLessThanOrEqual(1);
    }
  });
});
