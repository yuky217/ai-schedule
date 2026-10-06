import { describe, expect, it } from 'vitest';

import { TimeAttribute } from './enums';
import { hasConcreteTime, normalizeTaskTime } from './task';

/**
 * `normalizeTaskTime` 的用例。
 *
 * 它守的是一条很容易被忽略的边界：任务"看起来有时间"和"真的有时间"不是一回事。
 * 有属性、没锚点的时间会让任务在收集箱和日历**同时**落空 —— 安静地消失。
 */
describe('normalizeTaskTime：时间字段的收口', () => {
  it('只剩一个属性的"空时间"被退化成没时间（这样它会回收集箱，不至于凭空消失）', () => {
    for (const attribute of [TimeAttribute.Fixed, TimeAttribute.Deadline]) {
      expect(normalizeTaskTime({ attribute, startAt: null, endAt: null, dueAt: null })).toEqual({
        attribute: TimeAttribute.None,
        startAt: null,
        endAt: null,
        dueAt: null,
      });
    }
  });

  it('字段干脆没写（undefined）也按空处理', () => {
    expect(normalizeTaskTime({ attribute: TimeAttribute.Fixed }).attribute).toBe(TimeAttribute.None);
  });

  it('只要有一个锚点，就原样保留 —— 不替用户改他已经定好的时间', () => {
    const fixed = { attribute: TimeAttribute.Fixed, startAt: '2026-10-06T06:00:00.000Z' };
    expect(normalizeTaskTime(fixed)).toEqual(fixed);

    const deadline = { attribute: TimeAttribute.Deadline, dueAt: '2026-10-09T09:00:00.000Z' };
    expect(normalizeTaskTime(deadline)).toEqual(deadline);

    // 只有结束、没有开始：半截数据，但有事实在里面，仍然保留
    const tailOnly = { attribute: TimeAttribute.Fixed, endAt: '2026-10-06T07:00:00.000Z' };
    expect(normalizeTaskTime(tailOnly)).toEqual(tailOnly);
  });

  it('本来就无时间的，原样返回', () => {
    const none = { attribute: TimeAttribute.None, startAt: null, endAt: null, dueAt: null };
    expect(normalizeTaskTime(none)).toEqual(none);
  });

  it('收口之后 hasConcreteTime 的判断和它保持一致（两者不能各说各话）', () => {
    const degenerate = normalizeTaskTime({ attribute: TimeAttribute.Fixed, startAt: null, dueAt: null });
    expect(hasConcreteTime({ time: degenerate })).toBe(false);

    const real = normalizeTaskTime({ attribute: TimeAttribute.Fixed, startAt: '2026-10-06T06:00:00.000Z' });
    expect(hasConcreteTime({ time: real })).toBe(true);
  });
});
