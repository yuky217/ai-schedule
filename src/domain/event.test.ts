import { describe, expect, it } from 'vitest';

import { buildEventSpan, describeEvent } from './event';
import { createEvent } from './factory';
import { buildSpanTime } from './schedule-presets';

/**
 * 考试的时段换算（手动加一场考试时用）。
 *
 * 重点不是"它返回两个 ISO"，而是**它和日程那段是同一个口径**：
 * 日历上拖出来的日程与手填的考试，在"某天 9:00 到 10:00"这件事上
 * 如果算出两个不同的时刻，用户看到的就是"考试比日程晚一天"这种
 * 没有任何线索可循的怪事。
 */
describe('buildEventSpan', () => {
  it('某天几点到几点 → 落在那天的两个时刻', () => {
    const span = buildEventSpan(new Date(2026, 6, 8), 14 * 60 + 30, 16 * 60 + 30);
    expect(span).not.toBeNull();

    const start = new Date(span!.startAt);
    expect([start.getFullYear(), start.getMonth(), start.getDate()]).toEqual([2026, 6, 8]);
    expect([start.getHours(), start.getMinutes()]).toEqual([14, 30]);

    const end = new Date(span!.endAt);
    expect([end.getHours(), end.getMinutes()]).toEqual([16, 30]);
    expect(end.getDate()).toBe(8);
  });

  it('和日历上拖出来的日程同口径：同一天同一对刻度必须算出同一个时刻', () => {
    const day = new Date(2026, 6, 8);
    const exam = buildEventSpan(day, 9 * 60, 10 * 60)!;
    const span = buildSpanTime(day, 9 * 60, 10 * 60)!;
    expect(exam.startAt).toBe(span.startAt);
    expect(exam.endAt).toBe(span.endAt);
  });

  it('结束不晚于开始 → null（不替用户编一个时长）', () => {
    const day = new Date(2026, 6, 8);
    expect(buildEventSpan(day, 14 * 60, 14 * 60)).toBeNull();
    expect(buildEventSpan(day, 14 * 60, 13 * 60)).toBeNull();
  });

  it('日期无效 → null', () => {
    expect(buildEventSpan(new Date('不认识'), 9 * 60, 10 * 60)).toBeNull();
  });

  it('跨到午夜也不会造出第二天（24:00 夹到当天最后一分钟）', () => {
    const span = buildEventSpan(new Date(2026, 6, 8), 23 * 60, 24 * 60);
    expect(span).not.toBeNull();
    expect(new Date(span!.endAt).getDate()).toBe(8);
  });
});

describe('describeEvent', () => {
  it('时刻 + 地点；没有地点就只给时刻', () => {
    const withRoom = createEvent({
      title: '高等数学',
      startAt: new Date(2026, 6, 8, 14, 30).toISOString(),
      endAt: new Date(2026, 6, 8, 16, 30).toISOString(),
      location: '教B216',
    });
    expect(describeEvent(withRoom)).toBe('14:30–16:30 · 教B216');

    const noRoom = createEvent({
      title: '补考',
      startAt: new Date(2026, 6, 8, 9, 0).toISOString(),
      endAt: null,
    });
    expect(describeEvent(noRoom)).toBe('09:00');
  });
});
