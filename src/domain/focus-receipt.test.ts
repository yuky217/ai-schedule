import { describe, expect, it } from 'vitest';

import { describeFocusReceipt, describeFocusSeconds } from './focus-receipt';

/**
 * 回执措辞的用例。
 *
 * 重点不在"文案好不好看"，而在**话和事实一致**：
 * 最不能接受的是"明明没记上，回执说得像记上了" —— 那比没有回执更糟，
 * 用户会据此以为事情已经落好，然后再也找不到它。
 */

const span = { startAt: '2026-10-06T13:30:00.000Z', endAt: '2026-10-06T13:55:00.000Z' };

describe('describeFocusSeconds', () => {
  it('不到一分钟说秒，不说 0 分钟', () => {
    expect(describeFocusSeconds(42)).toBe('42 秒');
  });

  it('够一分钟说分钟', () => {
    expect(describeFocusSeconds(60)).toBe('1 分钟');
    expect(describeFocusSeconds(3599)).toBe('59 分钟');
  });
});

describe('describeFocusReceipt', () => {
  it('没绑定任务、结束时起了名：说出来它落在日历的哪一段', () => {
    const message = describeFocusReceipt({
      seconds: 1500,
      boundTitle: null,
      intent: '整理周报',
      span,
    });
    expect(message).toContain('整理周报');

    // 断言"跨度 = 专注时长"，而不是断言某个具体钟点 ——
    // 后者会把测试绑死在东八区，换个时区跑就红。
    const clock = /(\d{2}):(\d{2})[–-](\d{2}):(\d{2})/.exec(message);
    expect(clock, '回执里必须写出这一段日历的起止时刻').not.toBeNull();
    const toMinutes = (h: string, m: string) => Number(h) * 60 + Number(m);
    expect(toMinutes(clock![3], clock![4]) - toMinutes(clock![1], clock![2])).toBe(25);
  });

  it('绑定任务但不到一分钟：明说没记上，不能说得像记上了', () => {
    const message = describeFocusReceipt({
      seconds: 42,
      boundTitle: '写周报',
      intent: null,
      span: null,
    });
    expect(message).toContain('42 秒');
    expect(message).toContain('没记到');
    expect(message).not.toContain('日历上留下');
  });

  it('绑定任务、够一分钟、补了日历时段：时长、时段都要说', () => {
    const message = describeFocusReceipt({
      seconds: 1500,
      boundTitle: '写周报',
      intent: null,
      span,
    });
    expect(message).toContain('25 分钟');
    expect(message).toContain('写周报');
    expect(message).toContain('日历上留下');
  });

  it('还没做完所以没往日历上放：要说出来，否则用户会以为这段丢了', () => {
    const message = describeFocusReceipt({
      seconds: 1500,
      boundTitle: '写周报',
      intent: null,
      span: null,
      keptOffCalendar: true,
    });
    expect(message).toContain('25 分钟');
    expect(message).toContain('没往日历上放');
    expect(message).not.toContain('日历上留下');
  });

  it('绑定的任务已经不在清单里：不能假装它还在', () => {
    const message = describeFocusReceipt({
      seconds: 1500,
      boundTitle: '写周报',
      intent: null,
      span: null,
      taskMissing: true,
    });
    expect(message).toContain('已经不在清单里');
  });

  it('够目标自动完成 / 用户明确勾了完成：都要交代', () => {    expect(
      describeFocusReceipt({
        seconds: 7200,
        boundTitle: '写周报',
        intent: null,
        span: null,
        completed: true,
      }),
    ).toContain('自动完成');

    expect(
      describeFocusReceipt({
        seconds: 600,
        boundTitle: '写周报',
        intent: null,
        span: null,
        markOutcome: 'done',
      }),
    ).toContain('标成了完成');
  });

  it('重复型勾了完成：说的是"滚到下一次"而不是"完成了"（实际落库结果不同）', () => {
    const message = describeFocusReceipt({
      seconds: 600,
      boundTitle: '每周复盘',
      intent: null,
      span: null,
      markOutcome: 'rolled',
    });
    expect(message).toContain('滚到了下一次');
    expect(message).not.toContain('标成了完成');
  });

  it('频率型勾了完成：说的是"记下今天这一次"（它的完成态在打卡表上）', () => {
    const message = describeFocusReceipt({
      seconds: 600,
      boundTitle: '跑步',
      intent: null,
      span: null,
      markOutcome: 'checked-in',
    });
    expect(message).toContain('记下了今天这一次');
    expect(message).not.toContain('标成了完成');
  });

  it('频率型的本期进度跟着回执一起说', () => {
    const message = describeFocusReceipt({
      seconds: 1500,
      boundTitle: '跑步',
      intent: null,
      span: null,
      periodNote: '本周 2/3 次',
    });
    expect(message).toContain('本周 2/3 次');
  });

  it('没绑定、没起名：也叫「专注」落到日历上，时段说清楚', () => {
    const message = describeFocusReceipt({
      seconds: 900,
      boundTitle: null,
      intent: null,
      span: { startAt: '2026-10-08T19:00:00+08:00', endAt: '2026-10-08T19:15:00+08:00' },
    });
    expect(message).toContain('15 分钟');
    expect(message).toContain('日历上');
  });

  it('没绑定、时段没落成（兜底）：至少说清统计里有这段，不提日历', () => {
    const message = describeFocusReceipt({
      seconds: 900,
      boundTitle: null,
      intent: null,
      span: null,
    });
    expect(message).toContain('15 分钟');
    expect(message).toContain('统计');
    expect(message).not.toContain('日历');
  });

  it('没绑定、起名了但太短：不建记录，也不假装建了', () => {
    const message = describeFocusReceipt({
      seconds: 30,
      boundTitle: null,
      intent: '整理周报',
      span: null,
    });
    expect(message).toContain('没记进统计');
    expect(message).not.toContain('日历上');
  });
});
