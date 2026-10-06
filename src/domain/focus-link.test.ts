import { describe, expect, it } from 'vitest';

import { focusSpan, focusSpanTime, shouldStampFocusSpan } from './focus-link';
import type { Task, TaskTime } from './task';

/**
 * 「专注 → 日历」的测试。
 *
 * 这一段的职责只有一个：把"我花了多久"翻译成"是几点到几点"。
 * 两条边界必须钉住：
 * - 太短的不落（手滑点开又退出，不该在日历上留垃圾）；
 * - 已经排好时间的任务**不覆盖**（专注只提供投入时长，不重新安排用户的日程）。
 */

const iso = (y: number, m: number, d: number, h = 0, min = 0, s = 0): string =>
  new Date(y, m - 1, d, h, min, s, 0).toISOString();

const NONE: TaskTime = { attribute: 'none', startAt: null, endAt: null, dueAt: null };

function makeTask(time: TaskTime = NONE): Pick<Task, 'time'> {
  return { time };
}

describe('focusSpan', () => {
  const now = new Date(iso(2026, 10, 6, 16));

  it('开始 + 时长 = 结束', () => {
    const span = focusSpan(iso(2026, 10, 6, 15), 45 * 60, now)!;
    expect(span.startAt).toBe(iso(2026, 10, 6, 15));
    expect(span.endAt).toBe(iso(2026, 10, 6, 15, 45));
  });

  it('不到一分钟不落库', () => {
    expect(focusSpan(iso(2026, 10, 6, 15), 12, now)).toBeNull();
    expect(focusSpan(iso(2026, 10, 6, 15), 59, now)).toBeNull();
  });

  it('刚好一分钟就落', () => {
    expect(focusSpan(iso(2026, 10, 6, 15), 60, now)).not.toBeNull();
  });

  it('算出来的结束时间不超过"现在"（会话可能挂了一夜才收尾）', () => {
    const span = focusSpan(iso(2026, 10, 6, 15), 8 * 3600, now)!;
    expect(span.endAt).toBe(iso(2026, 10, 6, 16));
  });

  it('再离谱也不会算出零长度的段', () => {
    // 开始时间在未来 + 时长为 0：仍然保证至少一分钟的跨度
    const span = focusSpan(iso(2026, 10, 7, 9), 600, now)!;
    expect(Date.parse(span.endAt)).toBeGreaterThan(Date.parse(span.startAt));
  });

  it('开始时间脏了就不落，返回 null 而不是抛错', () => {
    expect(focusSpan('not-a-date', 600, now)).toBeNull();
  });

  it('负数时长按 0 处理（拿不到有效时长就当它太短）', () => {
    expect(focusSpan(iso(2026, 10, 6, 15), -300, now)).toBeNull();
  });
});

describe('shouldStampFocusSpan', () => {
  it('还没安排过时间的任务才补时间', () => {
    expect(shouldStampFocusSpan(makeTask(NONE))).toBe(true);
  });

  it('已经排到日历上的任务不覆盖它的时间', () => {
    const fixed: TaskTime = {
      attribute: 'fixed',
      startAt: iso(2026, 10, 7, 9),
      endAt: null,
      dueAt: null,
    };
    expect(shouldStampFocusSpan(makeTask(fixed))).toBe(false);
  });

  it('有 ddl 的任务同样不覆盖', () => {
    const deadline: TaskTime = {
      attribute: 'deadline',
      startAt: null,
      endAt: null,
      dueAt: iso(2026, 10, 7, 18),
    };
    expect(shouldStampFocusSpan(makeTask(deadline))).toBe(false);
  });
});

describe('focusSpanTime', () => {
  it('产出的是一段固定时间，不带截止', () => {
    const time = focusSpanTime({ startAt: iso(2026, 10, 6, 15), endAt: iso(2026, 10, 6, 15, 45) });
    expect(time.attribute).toBe('fixed');
    expect(time.startAt).toBe(iso(2026, 10, 6, 15));
    expect(time.endAt).toBe(iso(2026, 10, 6, 15, 45));
    expect(time.dueAt).toBeNull();
  });
});
