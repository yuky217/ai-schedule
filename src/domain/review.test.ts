import { describe, expect, it } from 'vitest';

import type { Checkin } from './checkins';
import { TaskKind, TaskStatus } from './enums';
import type { FocusSession } from './focus';
import {
  buildReview,
  describeDelta,
  describeFocusDuration,
  describeRange,
  describeRate,
  describeSummary,
  delta,
  heatmapWeeks,
  inRange,
  previousRange,
  resolveRange,
  reviewHabits,
  summarizeFocus,
  summarizeTasks,
  taskFocusDate,
} from './review';
import type { Task, TaskTime } from './task';

/**
 * 「回」回顾页的口径测试。
 *
 * 这一层最该被测，因为它的规则**没法靠肉眼验证**：
 * "完成率的分母到底是哪些任务""连续天数要不要被本期截断"，
 * 改一个判断就会让页面上的数字悄悄变味，而且看起来依然"像那么回事"。
 */

/* ------------------------------- 造数据 ------------------------------- */

const iso = (y: number, m: number, d: number, h = 0, min = 0): string =>
  new Date(y, m - 1, d, h, min, 0, 0).toISOString();

const plainTime: TaskTime = { attribute: 'none', startAt: null, endAt: null, dueAt: null };

function makeTask(over: Partial<Task> = {}): Task {
  const created = over.createdAt ?? iso(2026, 10, 2, 9, 0);
  return {
    id: over.id ?? `t-${Math.random().toString(36).slice(2, 8)}`,
    title: 'task',
    kind: TaskKind.Execution,
    status: TaskStatus.Todo,
    time: plainTime,
    completion: 'check',
    tags: [],
    priority: 2,
    source: 'manual',
    progress: { accumulatedMinutes: 0 },
    createdAt: created,
    updatedAt: created,
    syncState: 'local',
    ...over,
  };
}

const fixedAt = (startAt: string, over: Partial<Task> = {}): Task =>
  makeTask({ time: { attribute: 'fixed', startAt, endAt: null, dueAt: null }, ...over });

const dueAt = (due: string, over: Partial<Task> = {}): Task =>
  makeTask({ time: { attribute: 'deadline', startAt: null, endAt: null, dueAt: due }, ...over });

function makeSession(startedAt: string, actualSeconds: number, over: Partial<FocusSession> = {}): FocusSession {
  return {
    id: `f-${Math.random().toString(36).slice(2, 8)}`,
    startedAt,
    actualSeconds,
    growthSeconds: actualSeconds,
    createdAt: startedAt,
    updatedAt: startedAt,
    syncState: 'local',
    ...over,
  };
}

function makeCheckin(taskId: string, dayKey: string): Checkin {
  return {
    id: `c-${Math.random().toString(36).slice(2, 8)}`,
    taskId,
    dayKey,
    createdAt: iso(2026, 10, 1),
    updatedAt: iso(2026, 10, 1),
    syncState: 'local',
  };
}

/** 固定"今天"，让区间计算可复现 */
const TODAY = new Date(2026, 9, 7, 15, 30);

/* ------------------------------- 区间 ------------------------------- */

describe('resolveRange', () => {
  it('「今天」就是今天这一天：零点到 23:59，且只有一天', () => {
    const range = resolveRange('today', TODAY);
    expect(range.days).toBe(1);
    expect(range.label).toBe('今天');
    expect(range.from.getTime()).toBe(new Date(2026, 9, 7, 0, 0, 0, 0).getTime());
    expect(range.to.getTime()).toBe(new Date(2026, 9, 7, 23, 59, 59, 999).getTime());
  });

  it('近 7 天恰好 7 天，起点是今天往前推 6 天', () => {
    const range = resolveRange('last7', TODAY);
    expect(range.days).toBe(7);
    expect(range.from.getTime()).toBe(new Date(2026, 9, 1, 0, 0, 0, 0).getTime());
    expect(range.to.getTime()).toBe(new Date(2026, 9, 7, 23, 59, 59, 999).getTime());
  });

  it('近 30 天恰好 30 天', () => {
    const range = resolveRange('last30', TODAY);
    expect(range.days).toBe(30);
    expect(range.from.getTime()).toBe(new Date(2026, 8, 8, 0, 0, 0, 0).getTime());
  });

  it('本月截到今天为止，而不是铺满整月', () => {
    const range = resolveRange('month', TODAY);
    expect(range.from.getDate()).toBe(1);
    expect(range.from.getMonth()).toBe(9);
    expect(range.days).toBe(7);
  });

  it('本周以周一为起点，也不铺满 7 天', () => {
    const range = resolveRange('week', TODAY);
    expect(range.from.getDay()).toBe(1);
    expect(range.days).toBeGreaterThanOrEqual(1);
    expect(range.days).toBeLessThanOrEqual(7);
    expect(range.from.getTime()).toBeLessThanOrEqual(TODAY.getTime());
  });

  it('不改动传入的 today', () => {
    const before = TODAY.getTime();
    resolveRange('week', TODAY);
    expect(TODAY.getTime()).toBe(before);
  });
});

describe('previousRange', () => {
  it('等长且紧贴在当前周期之前，中间不留空隙', () => {
    const range = resolveRange('last7', TODAY);
    const prev = previousRange(range);

    expect(prev.days).toBe(7);
    expect(prev.from.getTime()).toBe(new Date(2026, 8, 24, 0, 0, 0, 0).getTime());
    expect(prev.to.getTime()).toBe(new Date(2026, 8, 30, 23, 59, 59, 999).getTime());
    expect(prev.to.getTime()).toBeLessThan(range.from.getTime());
    // 两段之间只隔 1ms（from 是 00:00:00.000，上一段的 to 是 23:59:59.999）
    expect(range.from.getTime() - prev.to.getTime()).toBe(1);
  });
});

describe('inRange / taskFocusDate', () => {
  it('区间含首尾', () => {
    const range = resolveRange('last7', TODAY);
    expect(inRange(range.from, range)).toBe(true);
    expect(inRange(range.to, range)).toBe(true);
    expect(inRange(new Date(range.to.getTime() + 1), range)).toBe(false);
    expect(inRange(new Date(range.from.getTime() - 1), range)).toBe(false);
  });

  it('焦点日期优先 startAt，其次 dueAt，最后 createdAt', () => {
    const both = makeTask({
      time: {
        attribute: 'fixed',
        startAt: iso(2026, 10, 3, 10, 0),
        endAt: null,
        dueAt: iso(2026, 10, 9),
      },
      createdAt: iso(2026, 9, 1),
    });
    expect(taskFocusDate(both).getTime()).toBe(new Date(iso(2026, 10, 3, 10, 0)).getTime());

    const onlyDue = dueAt(iso(2026, 10, 5), { createdAt: iso(2026, 9, 1) });
    expect(taskFocusDate(onlyDue).getTime()).toBe(new Date(iso(2026, 10, 5)).getTime());

    const plain = makeTask({ createdAt: iso(2026, 9, 20) });
    expect(taskFocusDate(plain).getTime()).toBe(new Date(iso(2026, 9, 20)).getTime());
  });
});

/* ------------------------------- 任务 ------------------------------- */

describe('summarizeTasks', () => {
  it('排期看焦点日期、完成数看 completedAt，想法型与子任务都不计入', () => {
    const range = resolveRange('last7', TODAY);

    const doneInRange = fixedAt(iso(2026, 10, 3, 10, 0), {
      status: TaskStatus.Done,
      completedAt: iso(2026, 10, 3, 11, 0),
      containerId: 'c1',
    });
    const pendingByCreatedAt = makeTask({ createdAt: iso(2026, 10, 2) });
    const farFuture = dueAt(iso(2026, 10, 20));
    const scheduleOverdue = fixedAt(iso(2026, 10, 3), { kind: TaskKind.Schedule });
    const habitDone = fixedAt(iso(2026, 10, 4), {
      kind: TaskKind.Habit,
      status: TaskStatus.Done,
      completedAt: iso(2026, 10, 5),
    });
    const idea = fixedAt(iso(2026, 10, 3), { kind: TaskKind.Idea });
    const subtask = fixedAt(iso(2026, 10, 3), { parentId: 'parent-1' });
    const doneBeforeRange = dueAt(iso(2026, 10, 1), {
      status: TaskStatus.Done,
      completedAt: iso(2026, 9, 28),
    });

    const result = summarizeTasks(
      [doneInRange, pendingByCreatedAt, farFuture, scheduleOverdue, habitDone, idea, subtask, doneBeforeRange],
      range,
      TODAY,
    );

    expect(result.planned).toBe(5);
    expect(result.done).toBe(3);
    expect(result.rate).toBeCloseTo(0.6);
    // doneBeforeRange 是 9月28日完成的：虽然本期该做，但不算本期的功劳
    expect(result.completedInRange).toBe(2);
    expect(result.overdue).toBe(2);
    expect(result.byContainer).toEqual([
      { containerId: null, planned: 4, done: 2 },
      { containerId: 'c1', planned: 1, done: 1 },
    ]);
    expect(result.byKind.map((row) => row.kind)).toEqual(['execution', 'schedule', 'habit']);
    expect(result.byKind.map((row) => row.planned)).toEqual([3, 1, 1]);
  });

  it('分组行序与数据读出来的顺序无关', () => {
    const range = resolveRange('last7', TODAY);
    const habit = fixedAt(iso(2026, 10, 3), { kind: TaskKind.Habit });
    const schedule = fixedAt(iso(2026, 10, 3), { kind: TaskKind.Schedule });
    const execution = fixedAt(iso(2026, 10, 3), { kind: TaskKind.Execution });

    const forward = summarizeTasks([habit, schedule, execution], range, TODAY).byKind.map((r) => r.kind);
    const backward = summarizeTasks([execution, schedule, habit], range, TODAY).byKind.map((r) => r.kind);

    expect(forward).toEqual(backward);
    expect(forward).toEqual(['execution', 'schedule', 'habit']);
  });

  it('本期没有安排时完成率是 null，不是 0', () => {
    const range = resolveRange('last7', TODAY);
    const result = summarizeTasks([dueAt(iso(2026, 11, 1))], range, TODAY);
    expect(result.planned).toBe(0);
    expect(result.rate).toBeNull();
  });

  it('提前做完的事算在本期的完成数里', () => {
    const range = resolveRange('last7', TODAY);
    const later = fixedAt(iso(2026, 10, 30), {
      status: TaskStatus.Done,
      completedAt: iso(2026, 10, 4, 9, 0),
    });
    const result = summarizeTasks([later], range, TODAY);
    expect(result.planned).toBe(0);
    expect(result.completedInRange).toBe(1);
  });

  it('完全没有任务时不炸，各计数都是 0', () => {
    const range = resolveRange('last7', TODAY);
    const result = summarizeTasks([], range, TODAY);
    expect(result.planned).toBe(0);
    expect(result.done).toBe(0);
    expect(result.overdue).toBe(0);
    expect(result.byKind).toEqual([]);
    expect(result.byContainer).toEqual([]);
  });
});

/* ------------------------------- 专注 ------------------------------- */

describe('summarizeFocus', () => {
  it('没投入的会话不计、区间外的会话不计，按日累加', () => {
    const range = resolveRange('last7', TODAY);
    const sessions = [
      makeSession(iso(2026, 10, 3, 10, 0), 1800),
      makeSession(iso(2026, 10, 3, 20, 0), 1800),
      makeSession(iso(2026, 10, 5, 9, 0), 600),
      makeSession(iso(2026, 10, 5, 10, 0), 0), // 点进去又走了
      makeSession(iso(2026, 10, 6, 10, 0), -5), // 非法值
      makeSession(iso(2026, 9, 20, 10, 0), 9999), // 区间外
    ];

    const result = summarizeFocus(sessions, range, TODAY);

    expect(result.sessions).toBe(3);
    expect(result.totalSeconds).toBe(4200);
    expect(result.activeDays).toBe(2);
    expect(result.bestDaySeconds).toBe(3600);
    expect(result.byDay).toHaveLength(7);
    expect(result.byDay.map((day) => day.seconds)).toEqual([0, 0, 3600, 0, 600, 0, 0]);
    expect(result.byDay[6]!.isToday).toBe(true);
    expect(result.byDay[6]!.dayKey).toBe('2026-10-07');
    // 10月3日按"周一=0"算是 5（周六）
    expect(result.byDay[2]!.weekday).toBe(5);
  });

  it('没有专注时格子仍然铺满，bestDaySeconds 为 0', () => {
    const range = resolveRange('last30', TODAY);
    const result = summarizeFocus([], range, TODAY);
    expect(result.sessions).toBe(0);
    expect(result.byDay).toHaveLength(30);
    expect(result.bestDaySeconds).toBe(0);
  });
});

/* ------------------------------- 环比 ------------------------------- */

describe('delta / describeDelta', () => {
  it('上期没数据时无从比较', () => {
    expect(delta(5, 0).ratio).toBeNull();
    expect(describeDelta(delta(5, 0))).toBe('');
    expect(describeDelta(delta(0, 0))).toBe('');
  });

  it('文案与四舍五入', () => {
    expect(describeDelta(delta(10, 5))).toBe('比上期 +100%');
    expect(describeDelta(delta(5, 10))).toBe('比上期 -50%');
    expect(describeDelta(delta(5, 5))).toBe('和上期持平');
    expect(describeDelta(delta(103, 100))).toBe('比上期 +3%');
  });
});

/* ------------------------------- 文案 ------------------------------- */

describe('describeFocusDuration', () => {
  it('各种边界', () => {
    expect(describeFocusDuration(0)).toBe('—');
    expect(describeFocusDuration(-100)).toBe('—');
    expect(describeFocusDuration(59)).toBe('不到 1 分钟');
    expect(describeFocusDuration(60)).toBe('1 分钟');
    expect(describeFocusDuration(3599)).toBe('59 分钟');
    expect(describeFocusDuration(3600)).toBe('1 小时');
    expect(describeFocusDuration(4800)).toBe('1 小时 20 分');
  });
});

describe('describeRange', () => {
  it('带天数与起始日', () => {
    const text = describeRange(resolveRange('last7', TODAY));
    expect(text).toContain('共 7 天');
    expect(text).toContain('10月1日');
  });

  it('只有一天时只说那一天 —— "共 1 天"是废话', () => {
    expect(describeRange(resolveRange('today', TODAY))).toBe('10月7日');
  });
});

/* ------------------------------- 日报 ------------------------------- */

describe('describeSummary 的日粒度', () => {
  it('第一句说的是"今天"，且只报做到了什么', () => {
    const range = resolveRange('today', TODAY);
    const finished = makeTask({
      status: TaskStatus.Done,
      completedAt: iso(2026, 10, 7, 11, 0),
    });

    const snapshot = buildReview({
      tasks: [finished],
      sessions: [],
      checkins: [],
      habits: [],
      range,
      today: TODAY,
    });

    const lines = describeSummary(snapshot);
    expect(lines[0]).toBe('今天完成了 1 件');
    // 基调是"做到了什么"：这一天没有任何一句是在盘点没做到的
    expect(lines.join('')).not.toContain('逾期');
  });
});

describe('heatmapWeeks', () => {
  it('永远够铺下 N 天（今天落在周日也不丢格子）', () => {
    expect(heatmapWeeks(1)).toBe(1);
    expect(heatmapWeeks(7)).toBe(2);
    expect(heatmapWeeks(30)).toBe(6);

    for (let days = 1; days <= 40; days++) {
      // 最坏情况：今天在周日（weekday = 6），第一格需要的下标最大
      expect(heatmapWeeks(days) * 7).toBeGreaterThanOrEqual(days + 6);
    }
  });
});

/* ------------------------------- 习惯 ------------------------------- */

describe('reviewHabits', () => {
  it('本期次数按区间算，连续天数按全局算（不被区间截断）', () => {
    const range = resolveRange('last7', TODAY);
    const running = makeTask({ id: 'h1', title: '跑步', kind: TaskKind.Habit });
    const words = makeTask({ id: 'h2', title: '背单词', kind: TaskKind.Habit });

    const checkins = [
      // 9月30日 + 10月1日..7日：全局连续 8 天，但本期只数 7 次
      makeCheckin('h1', '2026-09-30'),
      makeCheckin('h1', '2026-10-01'),
      makeCheckin('h1', '2026-10-02'),
      makeCheckin('h1', '2026-10-03'),
      makeCheckin('h1', '2026-10-04'),
      makeCheckin('h1', '2026-10-05'),
      makeCheckin('h1', '2026-10-06'),
      makeCheckin('h1', '2026-10-07'),
      makeCheckin('h2', '2026-10-02'),
      makeCheckin('h2', '2026-10-05'),
    ];

    const result = reviewHabits([running, words], checkins, range, TODAY);

    expect(result).toHaveLength(2);
    expect(result[0]!.inRange).toBe(7);
    expect(result[0]!.coverage).toBe(1);
    expect(result[0]!.streak.current).toBe(8);
    expect(result[0]!.streak.longest).toBe(8);
    expect(result[0]!.streak.total).toBe(8);
    expect(result[1]!.inRange).toBe(2);
    expect(result[1]!.streak.current).toBe(0);
    expect(result[1]!.streak.longest).toBe(1);
  });

  it('没有打卡记录的习惯不会炸', () => {
    const range = resolveRange('last7', TODAY);
    const habit = makeTask({ id: 'hz', kind: TaskKind.Habit });
    const result = reviewHabits([habit], [], range, TODAY);
    expect(result[0]!.inRange).toBe(0);
    expect(result[0]!.coverage).toBe(0);
    expect(result[0]!.streak.total).toBe(0);
  });
});

/* ------------------------------- 汇总 ------------------------------- */

describe('buildReview', () => {
  it('同时算出本期与上期的完成数、专注时长与打卡总数', () => {
    const range = resolveRange('last7', TODAY);

    const done = fixedAt(iso(2026, 10, 3, 10, 0), {
      status: TaskStatus.Done,
      completedAt: iso(2026, 10, 3, 11, 0),
    });
    const pending = makeTask({ createdAt: iso(2026, 10, 2) });
    const earlier = fixedAt(iso(2026, 9, 28), {
      status: TaskStatus.Done,
      completedAt: iso(2026, 9, 28, 12, 0),
    });

    const habit = makeTask({ id: 'h1', kind: TaskKind.Habit });
    const sessions = [
      makeSession(iso(2026, 10, 3, 10, 0), 1800),
      makeSession(iso(2026, 10, 5, 9, 0), 2400),
      makeSession(iso(2026, 9, 26, 9, 0), 600),
    ];
    const checkins = [makeCheckin('h1', '2026-10-01'), makeCheckin('h1', '2026-10-02')];

    const snapshot = buildReview({
      tasks: [done, pending, earlier],
      sessions,
      checkins,
      habits: [habit],
      range,
      today: TODAY,
    });

    expect(snapshot.tasks.completedInRange).toBe(1);
    expect(snapshot.focus.totalSeconds).toBe(4200);
    expect(snapshot.focusDelta.previous).toBe(600);
    expect(Math.round((snapshot.focusDelta.ratio ?? 0) * 100)).toBe(600);
    expect(snapshot.doneDelta.current).toBe(1);
    expect(snapshot.doneDelta.previous).toBe(1);
    expect(snapshot.checkinCount).toBe(2);
    expect(snapshot.habits).toHaveLength(1);

    const lines = describeSummary(snapshot);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('完成了 1 件');
    expect(lines[0]).toContain('和上期持平');
    expect(lines[1]).toContain('1 小时 10 分');
    expect(lines[1]).toContain('+600%');
    expect(lines[2]).toContain('打卡 2 次');
  });

  it('一片空白时小结不出现 NaN / undefined', () => {
    const range = resolveRange('week', TODAY);
    const snapshot = buildReview({ tasks: [], sessions: [], checkins: [], habits: [], range, today: TODAY });

    const lines = describeSummary(snapshot);
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(line).not.toContain('NaN');
      expect(line).not.toContain('undefined');
    }
    expect(lines[0]).toContain('还没有安排任务');
    expect(lines[1]).toContain('还没有专注记录');
  });

  it('没有任务但有专注时，完成率走"本期没有安排"', () => {
    const range = resolveRange('last7', TODAY);
    const snapshot = buildReview({
      tasks: [],
      sessions: [makeSession(iso(2026, 10, 3, 10, 0), 3600)],
      checkins: [],
      habits: [],
      range,
      today: TODAY,
    });
    expect(describeRate(snapshot.tasks.rate)).toBe('本期没有安排');
    expect(describeSummary(snapshot)[1]).toContain('1 小时');
  });
});
