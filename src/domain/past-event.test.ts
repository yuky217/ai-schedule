import { describe, expect, it } from 'vitest';

import { CompletionRule, TaskKind, TaskStatus, TimeAttribute } from './enums';
import { describePastWindow, planEventShift, shiftEventToDay, toLooseTodo } from './past-event';
import { taskDisplayState } from './task-state';
import type { Task, TaskTime } from './task';

/**
 * 「这段时间已经过去了」三个出口的测试。
 *
 * 重点盯两件容易写错的事：
 * 1. 挪日期要**保留时刻**，有时长的事还要整体平移（14:00–15:00 → 今天 14:00–15:00），
 *    不能变成 00:00 或者只剩一个开始时刻；
 * 2. 「改成待办」必须把时间清干净 —— 漏掉 dueAt 这类字段，它会以另一种形式
 *    继续待在未来某天的日历上，看起来就像"改成待办没生效"。
 */

const iso = (y: number, m: number, d: number, h = 0, min = 0): string =>
  new Date(y, m - 1, d, h, min, 0, 0).toISOString();

const NONE: TaskTime = { attribute: 'none', startAt: null, endAt: null, dueAt: null };

function makeTask(over: Partial<Task> = {}): Task {
  const created = iso(2026, 10, 6, 9);
  return {
    id: over.id ?? 't1',
    title: '一件事',
    kind: TaskKind.Schedule,
    status: TaskStatus.Todo,
    time: NONE,
    completion: CompletionRule.Check,
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

const fixed = (startAt: string, endAt: string | null = null): TaskTime => ({
  attribute: TimeAttribute.Fixed,
  startAt,
  endAt,
  dueAt: null,
});

/** 用固定的"现在"，避免测试跟着真实时间漂 */
const NOW = new Date(2026, 9, 6, 20, 37); // 2026-10-06 20:37 本地

describe('shiftEventToDay', () => {
  it('挪到今天：日期换了、时刻不动', () => {
    const task = makeTask({ time: fixed(iso(2026, 9, 30, 14)) });

    const next = shiftEventToDay(task, 0, NOW);

    expect(next).not.toBeNull();
    expect(next!.startAt).toBe(iso(2026, 10, 6, 14));
    expect(next!.attribute).toBe(TimeAttribute.Fixed);
  });

  it('有时长的事整体平移，时长不变', () => {
    const task = makeTask({ time: fixed(iso(2026, 9, 30, 14), iso(2026, 9, 30, 15, 30)) });

    const next = shiftEventToDay(task, 1, NOW);

    expect(next!.startAt).toBe(iso(2026, 10, 7, 14));
    expect(next!.endAt).toBe(iso(2026, 10, 7, 15, 30));
  });

  it('原来没写结束时刻的，挪完仍然不写（不替它编一个时长）', () => {
    const task = makeTask({ time: fixed(iso(2026, 9, 30, 14)) });

    expect(shiftEventToDay(task, 0, NOW)!.endAt).toBeNull();
  });

  it('跨月、跨年都按日历天走', () => {
    const task = makeTask({ time: fixed(iso(2026, 12, 31, 9, 30)) });

    const next = shiftEventToDay(task, 1, new Date(2026, 11, 31, 20));

    expect(next!.startAt).toBe(iso(2027, 1, 1, 9, 30));
  });

  it('原本的秒与毫秒被抹平成整分（日历上本来就是按分钟排的）', () => {
    const task = makeTask({
      time: { attribute: TimeAttribute.Fixed, startAt: iso(2026, 9, 30, 14, 5), endAt: null, dueAt: null },
    });

    const start = new Date(shiftEventToDay(task, 0, NOW)!.startAt!);
    expect(start.getSeconds()).toBe(0);
    expect(start.getMilliseconds()).toBe(0);
    expect(start.getMinutes()).toBe(5);
  });

  it('截止型不接这个动作（欠着的事不该被"挪到今天"糊过去）', () => {
    const task = makeTask({
      time: { attribute: TimeAttribute.Deadline, startAt: null, endAt: null, dueAt: iso(2026, 9, 30, 14) },
    });

    expect(shiftEventToDay(task, 0, NOW)).toBeNull();
  });

  it('没有时间的任务返回 null', () => {
    expect(shiftEventToDay(makeTask({ time: NONE }), 0, NOW)).toBeNull();
  });

  it('挪完就不该再是"已经过去"：状态从 missed 变成 upcoming', () => {
    const task = makeTask({ time: fixed(iso(2026, 9, 30, 14), iso(2026, 9, 30, 15)) });
    expect(taskDisplayState(task, NOW)).toBe('missed');

    // 注意：原时刻 14:00 在今天（20:37）已经过了，所以要挪到明天才会"不再过去"
    const moved = makeTask({ time: shiftEventToDay(task, 1, NOW)! });
    expect(taskDisplayState(moved, NOW)).toBe('upcoming');
  });
});

describe('planEventShift', () => {
  it('原时刻今天还没到 → 挪到今天（当天补做）', () => {
    // 现在是 10:00，被误期的会是上周三 14:00
    const task = makeTask({ time: fixed(iso(2026, 9, 30, 14)) });

    const plan = planEventShift(task, new Date(2026, 9, 6, 10));

    expect(plan!.dayOffset).toBe(0);
    expect(plan!.label).toBe('挪到今天 14:00');
    expect(new Date(plan!.time.startAt!).getHours()).toBe(14);
  });

  /**
   * 这条是踩出来的：用户晚上才来处理"昨天下午的会"，如果还挪到今天 14:00，
   * 那就是四小时前 —— 卡片不会消失，用户会以为按钮坏了。
   */
  it('原时刻今天已经过了 → 自动挪到明天', () => {
    const task = makeTask({ time: fixed(iso(2026, 9, 30, 14)) });

    const plan = planEventShift(task, NOW); // 20:37

    expect(plan!.dayOffset).toBe(1);
    expect(plan!.label).toBe('挪到明天 14:00');
  });

  it('挪完一定不再是"已经过去"（这是按钮该有的效果）', () => {
    const task = makeTask({ time: fixed(iso(2026, 9, 30, 9), iso(2026, 9, 30, 10)) });

    for (const now of [new Date(2026, 9, 6, 8), NOW, new Date(2026, 9, 6, 23, 59)]) {
      const plan = planEventShift(task, now)!;
      const moved = makeTask({ time: plan.time });
      expect(taskDisplayState(moved, now), `现在 ${now.toLocaleString()}`).not.toBe('missed');
    }
  });

  it('截止型和没时间的都不给这个动作', () => {
    const overdue = makeTask({
      time: { attribute: TimeAttribute.Deadline, startAt: null, endAt: null, dueAt: iso(2026, 9, 30, 14) },
    });
    expect(planEventShift(overdue, NOW)).toBeNull();
    expect(planEventShift(makeTask({ time: NONE }), NOW)).toBeNull();
  });
});

describe('toLooseTodo', () => {
  it('把四个时间字段全部清干净', () => {
    const task = makeTask({
      time: {
        attribute: TimeAttribute.Fixed,
        startAt: iso(2026, 9, 30, 14),
        endAt: iso(2026, 9, 30, 15),
        dueAt: iso(2026, 9, 30, 15),
      },
    });

    const next = toLooseTodo(task);

    expect(next.time).toEqual(NONE);
  });

  it('日程型变成执行型（时间撤了就不再是"占一段时间的事"）', () => {
    expect(toLooseTodo(makeTask({ kind: TaskKind.Schedule })).kind).toBe(TaskKind.Execution);
  });

  it('习惯型不动类型：它的判定域在打卡，跟有没有时间无关', () => {
    expect(toLooseTodo(makeTask({ kind: TaskKind.Habit })).kind).toBe(TaskKind.Habit);
  });

  it('改完就从日历上消失了（没有时间 = 日历上没有它）', () => {
    const task = makeTask({ time: fixed(iso(2026, 9, 30, 14)) });

    const loose = makeTask({ ...toLooseTodo(task) });

    expect(taskDisplayState(loose, NOW)).toBe('unscheduled');
  });
});

describe('describePastWindow', () => {
  const dayDiffLabel = (days: number): string =>
    days === 0 ? '今天' : days === -1 ? '昨天' : days === -2 ? '前天' : `${Math.abs(days)} 天前`;

  it('带结束时刻：昨天 14:00–15:00', () => {
    const task = makeTask({ time: fixed(iso(2026, 10, 5, 14), iso(2026, 10, 5, 15)) });

    expect(describePastWindow(task, NOW)).toBe(`${dayDiffLabel(-1)} 14:00–15:00`);
  });

  it('只有开始时刻时不编结束', () => {
    const task = makeTask({ time: fixed(iso(2026, 10, 5, 14)) });

    expect(describePastWindow(task, NOW)).toBe(`${dayDiffLabel(-1)} 14:00`);
  });

  it('超过两天就说"几天前"，不再堆"前天大前天"', () => {
    const task = makeTask({ time: fixed(iso(2026, 9, 30, 9)) });

    expect(describePastWindow(task, NOW)).toBe('6 天前 09:00');
  });

  it('今天早些时候也算"已经过去"，文案要说今天', () => {
    const task = makeTask({ time: fixed(iso(2026, 10, 6, 9), iso(2026, 10, 6, 10)) });

    expect(describePastWindow(task, NOW)).toBe('今天 09:00–10:00');
    expect(taskDisplayState(task, NOW)).toBe('missed');
  });

  it('没时间的任务给空串（卡片本来也不会显示）', () => {
    expect(describePastWindow(makeTask({ time: NONE }), NOW)).toBe('');
  });
});
