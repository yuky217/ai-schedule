import { describe, expect, it } from 'vitest';

import { TimeAttribute } from './enums';
import {
  hasAnyTime,
  hasConcreteTime,
  isAllDay,
  normalizeTaskTime,
  pendingUntil,
  taskAnchor,
  taskDue,
  timeAnchor,
  timeDue,
} from './task';

/**
 * `normalizeTaskTime` 的用例。
 *
 * 它守的是一条很容易被忽略的边界：任务"看起来有时间"和"真的有时间"不是一回事。
 * 有属性、没锚点的时间会让任务在待办和日历**同时**落空 —— 安静地消失。
 */
describe('normalizeTaskTime：时间字段的收口', () => {
  it('只剩一个属性的"空时间"被退化成没时间（这样它会回待办，不至于凭空消失）', () => {
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

/**
 * 锚点口径的用例。
 *
 * 这一组守的是**两件不同的事不能被写成一件**：
 * - `timeAnchor` = "这件事算哪一刻"（归天 / 排序 / 提醒 / 重复都用它）
 * - `hasAnyTime` = "这件事落进时间轴了吗"（该不该画到日历上）
 *
 * 它们只在一种数据上分道扬镳 —— **只写了结束时间、没写开始和截止**。
 * 上面 `normalizeTaskTime` 的用例特意保留了这种半截数据（它有事实在里面），
 * 所以这里必须确认：这种任务**会被画到日历上**（hasAnyTime = true），
 * 但**没有锚点**（timeAnchor = null），因此不参与"算哪天"。
 * 收口前 `startAt ?? dueAt` 被抄了 13 遍，任何一处把这两个概念混起来就是 bug。
 */
describe('timeAnchor：这件事算哪一刻', () => {
  it('优先开始时间', () => {
    expect(
      timeAnchor({ startAt: '2026-10-06T06:00:00.000Z', dueAt: '2026-10-09T09:00:00.000Z' }),
    ).toBe('2026-10-06T06:00:00.000Z');
  });

  it('没有开始时间就用截止时间（执行型常有 ddl）', () => {
    expect(timeAnchor({ startAt: null, dueAt: '2026-10-09T09:00:00.000Z' })).toBe(
      '2026-10-09T09:00:00.000Z',
    );
  });

  it('**不看 endAt**：只有结束时间的事没有锚点（它就是分水岭）', () => {
    expect(timeAnchor({ startAt: null, endAt: '2026-10-06T07:00:00.000Z', dueAt: null })).toBeNull();
  });

  it('三个都空 → null（不是空字符串，调用方靠它判"没有"）', () => {
    expect(timeAnchor({ startAt: null, dueAt: null })).toBeNull();
    expect(timeAnchor({})).toBeNull();
  });

  it('taskAnchor 就是它的 Task 版本', () => {
    const time = {
      attribute: TimeAttribute.None,
      startAt: '2026-10-06T06:00:00.000Z',
      dueAt: null,
    };
    expect(taskAnchor({ time })).toBe(timeAnchor(time));
  });
});

/**
 * 反方向的那件事：**什么时候到期**。
 *
 * 它有独立的用例、而不是"锚点的补充说明"，因为它和锚点是**两条并列的事实**：
 * "周三 14:00 开会，但周二前要交材料" —— 这条任务的开始与截止指向不同的日子，
 * 归天要用前者、显示期限要用后者。
 */
describe('timeDue：这件事什么时候到期', () => {
  it('优先截止时间（"周五前交"比"周三开会"更能说明期限）', () => {
    expect(
      timeDue({ startAt: '2026-10-07T06:00:00.000Z', dueAt: '2026-10-09T09:00:00.000Z' }),
    ).toBe('2026-10-09T09:00:00.000Z');
  });

  it('没有截止就退回开始时间（不然期限那一栏会空着）', () => {
    expect(timeDue({ startAt: '2026-10-07T06:00:00.000Z' })).toBe('2026-10-07T06:00:00.000Z');
  });

  it('**同一条数据上两个方向给出相反答案** —— 这就是它们必须分开的理由', () => {
    const time = { startAt: '2026-10-07T06:00:00.000Z', dueAt: '2026-10-09T09:00:00.000Z' };
    expect(timeAnchor(time)).toBe(time.startAt);
    expect(timeDue(time)).toBe(time.dueAt);
    expect(timeAnchor(time)).not.toBe(timeDue(time));
  });

  it('都空 → null', () => {
    expect(timeDue({})).toBeNull();
  });

  it('taskDue 就是它的 Task 版本', () => {
    const time = { attribute: TimeAttribute.None, startAt: null, dueAt: '2026-10-09T09:00:00.000Z' };
    expect(taskDue({ time })).toBe(timeDue(time));
  });
});

describe('hasAnyTime：这件事落进时间轴了吗', () => {
  it('三个字段里任意一个有就算（含只有 endAt 的半截数据）', () => {
    expect(hasAnyTime({ startAt: '2026-10-06T06:00:00.000Z' })).toBe(true);
    expect(hasAnyTime({ dueAt: '2026-10-09T09:00:00.000Z' })).toBe(true);
    expect(hasAnyTime({ endAt: '2026-10-06T07:00:00.000Z' })).toBe(true);
  });

  it('全空 → false（该回待办，不该出现在日历上）', () => {
    expect(hasAnyTime({ startAt: null, endAt: null, dueAt: null })).toBe(false);
    expect(hasAnyTime({})).toBe(false);
  });

  it('空字符串不算数（"填过又清空"的字段不该被当成有时间）', () => {
    expect(hasAnyTime({ startAt: '', endAt: '', dueAt: '' })).toBe(false);
  });
});

describe('isAllDay：是不是"全天"', () => {
  const day = '2026-10-10T00:00:00.000Z';

  it('标了全天 + 有锚点 → true', () => {
    expect(isAllDay({ allDay: true, startAt: day, endAt: null, dueAt: null })).toBe(true);
  });

  it('没标 → false（**不能靠 startAt 是 00:00 去推**：真·零点的日程不是全天）', () => {
    expect(isAllDay({ startAt: day, endAt: null, dueAt: null })).toBe(false);
    expect(isAllDay({ allDay: false, startAt: day, endAt: null, dueAt: null })).toBe(false);
  });

  it('⭐ 标了全天却没有锚点 → false（退化数据已被 normalize 判成"没时间"）', () => {
    expect(isAllDay({ allDay: true, startAt: null, endAt: null, dueAt: null })).toBe(false);
  });

  it('⭐ 全天照样有锚点 —— 否则它会从所有按时间取数的列表里消失', () => {
    const time = { allDay: true, startAt: day, endAt: null, dueAt: null };
    expect(timeAnchor(time)).toBe(day);
    expect(hasAnyTime(time)).toBe(true);
  });
});

describe('pendingUntil：这件事到什么时候为止都算"没到"', () => {
  const start = '2026-10-10T09:00:00.000Z';
  const end = '2026-10-10T15:00:00.000Z';
  const due = '2026-10-10T18:00:00.000Z';

  it('普通时间：截止优先，其次开始（与 timeDue 同一口径）', () => {
    expect(pendingUntil({ startAt: start, endAt: end, dueAt: due })).toBe(due);
    expect(pendingUntil({ startAt: start, endAt: end, dueAt: null })).toBe(start);
  });

  it('⭐ 全天看当天结束，不是开始 —— 00:00 永远在过去，用它比等于全天永远"已过期"', () => {
    const time = {
      allDay: true,
      startAt: '2026-10-10T00:00:00.000Z',
      endAt: '2026-10-10T23:59:59.999Z',
      dueAt: null,
    };
    expect(pendingUntil(time)).toBe('2026-10-10T23:59:59.999Z');
  });

  it('⭐ 全天即使另有截止也按当天结束算（它说的是"这天都算它"）', () => {
    expect(
      pendingUntil({
        allDay: true,
        startAt: '2026-10-10T00:00:00.000Z',
        endAt: '2026-10-10T23:59:59.999Z',
        dueAt: due,
      }),
    ).toBe('2026-10-10T23:59:59.999Z');
  });

  it('退化数据（标了全天却没锚点）不特殊对待：按没时间算', () => {
    expect(pendingUntil({ allDay: true, startAt: null, endAt: null, dueAt: null })).toBeNull();
  });
});
