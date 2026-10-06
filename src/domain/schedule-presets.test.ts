import { describe, expect, it } from 'vitest';

import { buildScheduleTime, SCHEDULE_PRESETS } from './schedule-presets';
import { TimeAttribute } from './enums';

/**
 * 安排预设的换算。
 *
 * 「稍后」这类相对型预设走的是"现在 + N 分钟"，不再要求用户
 * 在滚轮上对齐一个具体钟点 —— 相对时间本身就是意图。
 */

describe('buildScheduleTime', () => {
  it('时钟型：落在本日的指定钟点', () => {
    const preset = SCHEDULE_PRESETS.find((p) => p.id === 'today-pm')!;
    const base = new Date(2026, 9, 7, 0, 30);
    const time = buildScheduleTime(preset, base);
    expect(time.attribute).toBe(TimeAttribute.Fixed);
    expect(new Date(time.startAt!).getHours()).toBe(14);
    expect(new Date(time.startAt!).getDate()).toBe(7);
  });

  it('时钟型跨天：明天的钟点', () => {
    const preset = SCHEDULE_PRESETS.find((p) => p.id === 'tomorrow-due')!;
    const base = new Date(2026, 9, 7, 23, 0);
    const time = buildScheduleTime(preset, base);
    expect(time.attribute).toBe(TimeAttribute.Deadline);
    const due = new Date(time.dueAt!);
    expect(due.getDate()).toBe(8);
    expect(due.getHours()).toBe(23);
  });

  it('稍后：现在 + 2 小时，不落回整点', () => {
    const preset = SCHEDULE_PRESETS.find((p) => p.id === 'later')!;
    const base = new Date(2026, 9, 7, 13, 7);
    const time = buildScheduleTime(preset, base);
    expect(time.attribute).toBe(TimeAttribute.Fixed);
    const at = new Date(time.startAt!);
    expect(at.getHours()).toBe(15);
    expect(at.getMinutes()).toBe(7);
    expect(at.getDate()).toBe(7);
  });

  it('稍后跨天：深夜点「稍后」落到明天', () => {
    const preset = SCHEDULE_PRESETS.find((p) => p.id === 'later')!;
    const base = new Date(2026, 9, 7, 23, 30);
    const at = new Date(buildScheduleTime(preset, base).startAt!);
    expect(at.getDate()).toBe(8);
    expect(at.getHours()).toBe(1);
    expect(at.getMinutes()).toBe(30);
  });
});
