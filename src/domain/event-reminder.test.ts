import { describe, expect, it } from 'vitest';

import { createEvent } from './factory';
import { describeEventFire, eventFireAt } from './event-reminder';
import type { CalEvent } from './event';

/**
 * 考试提醒的规则是定死的（前一天 20:00，排不上退开考前 1 小时），
 * 所以这里把三个时刻钉住：正常、已过前一天、连兜底也过了。
 * 另外钉住"已经开始的不提醒"——马后炮不是提醒。
 */

function exam(startAt: Date, overrides: Partial<CalEvent> = {}): CalEvent {
  return {
    ...createEvent({ title: '高等数学', startAt: startAt.toISOString(), endAt: null }),
    ...overrides,
  };
}

describe('eventFireAt', () => {
  it('考前一天 20:00 提醒', () => {
    const now = new Date(2026, 6, 5, 10, 0); // 7/5 上午
    const fire = eventFireAt(exam(new Date(2026, 6, 8, 14, 30)), now);
    expect(fire!.onEve).toBe(true);
    expect(fire!.at.getTime()).toBe(new Date(2026, 6, 7, 20, 0).getTime());
  });

  it('跨月也按"前一天的晚上八点"算', () => {
    const now = new Date(2026, 5, 20, 9, 0);
    const fire = eventFireAt(exam(new Date(2026, 6, 1, 9, 0)), now);
    expect(fire!.at.getTime()).toBe(new Date(2026, 5, 30, 20, 0).getTime());
  });

  it('已经过了前一天 20:00 → 退到开考前 1 小时', () => {
    const now = new Date(2026, 6, 7, 21, 0); // 考前一晚九点才导入
    const fire = eventFireAt(exam(new Date(2026, 6, 8, 9, 0)), now);
    expect(fire!.onEve).toBe(false);
    expect(fire!.at.getTime()).toBe(new Date(2026, 6, 8, 8, 0).getTime());
  });

  it('连兜底也过去（还有半小时就开考）→ 不排', () => {
    const now = new Date(2026, 6, 8, 8, 30);
    expect(eventFireAt(exam(new Date(2026, 6, 8, 9, 0)), now)).toBeNull();
  });

  it('考试已经开始或已经过去 → 不排', () => {
    const now = new Date(2026, 6, 8, 10, 0);
    expect(eventFireAt(exam(new Date(2026, 6, 8, 9, 0)), now)).toBeNull();
    expect(eventFireAt(exam(new Date(2026, 6, 1, 9, 0)), now)).toBeNull();
  });

  it('时刻坏掉 → 不排（不让 Date 静默进位）', () => {
    expect(eventFireAt(exam(new Date(2026, 6, 8, 9, 0), { startAt: '不是时间' }), new Date(2026, 6, 5))).toBeNull();
  });

  it('前一天 20:00 恰好等于此刻 → 当作已过，走兜底', () => {
    const now = new Date(2026, 6, 7, 20, 0);
    const fire = eventFireAt(exam(new Date(2026, 6, 8, 9, 0)), now);
    expect(fire!.onEve).toBe(false);
  });
});

describe('describeEventFire', () => {
  const event = exam(new Date(2026, 6, 8, 14, 30), {
    endAt: new Date(2026, 6, 8, 16, 30).toISOString(),
    location: '教B216',
  });

  it('前一天那次说"明天"，带上时段与考场', () => {
    const fire = eventFireAt(event, new Date(2026, 6, 5, 10, 0))!;
    expect(describeEventFire(event, fire)).toBe('明天 14:30–16:30 · 教B216');
  });

  it('兜底那次说"开考"', () => {
    const fire = eventFireAt(event, new Date(2026, 6, 7, 21, 0))!;
    expect(describeEventFire(event, fire)).toBe('14:30–16:30 开考 · 教B216');
  });

  it('没地点 / 没结束时刻也能拼出人话', () => {
    const bare = exam(new Date(2026, 6, 8, 9, 0));
    const fire = eventFireAt(bare, new Date(2026, 6, 5, 10, 0))!;
    expect(describeEventFire(bare, fire)).toBe('明天 09:00');
  });
});
