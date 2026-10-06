import { describe, expect, it } from 'vitest';

import { CompletionRule, RepeatFreq, TaskKind, TaskStatus } from './enums';
import { buildHabitConversion, canConvertToHabit, describeCadence } from './habit-convert';
import type { RepeatRule, Task, TaskTime } from './task';

/**
 * 「转成打卡」的测试。
 *
 * 重点不是文案，而是**转换到底动了哪些字段**：
 * 多动一个（比如把时间清掉）就是偷偷毁掉用户的意图，
 * 少动一个（比如没清 targetMinutes）就会留下两套完成判定互相打架。
 */

const iso = (y: number, m: number, d: number, h = 0): string =>
  new Date(y, m - 1, d, h, 0, 0, 0).toISOString();

const plainTime: TaskTime = { attribute: 'none', startAt: null, endAt: null, dueAt: null };
const morningTime: TaskTime = {
  attribute: 'fixed',
  startAt: iso(2026, 10, 7, 7),
  endAt: null,
  dueAt: null,
};

function makeTask(over: Partial<Task> = {}): Task {
  const created = over.createdAt ?? iso(2026, 10, 2, 9);
  return {
    id: over.id ?? 't1',
    title: '跑步',
    kind: TaskKind.Execution,
    status: TaskStatus.Todo,
    time: plainTime,
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

describe('canConvertToHabit', () => {
  it('想法型不给转（它待在想法库，不催办，不该变成每天要打卡的东西）', () => {
    expect(canConvertToHabit(makeTask({ kind: TaskKind.Idea }))).toBe(false);
  });

  it('已经是频率型打卡了，没什么可转的', () => {
    expect(canConvertToHabit(makeTask({ completion: CompletionRule.Frequency }))).toBe(false);
  });

  it('执行型 / 日程型 / 勾选型习惯都可以转', () => {
    expect(canConvertToHabit(makeTask({ kind: TaskKind.Execution }))).toBe(true);
    expect(canConvertToHabit(makeTask({ kind: TaskKind.Schedule }))).toBe(true);
    expect(canConvertToHabit(makeTask({ kind: TaskKind.Habit }))).toBe(true);
  });

  it('时长型习惯（够 30 分钟）也允许转，但会有警告', () => {
    const task = makeTask({ kind: TaskKind.Habit, completion: CompletionRule.Duration, targetMinutes: 30 });
    expect(canConvertToHabit(task)).toBe(true);
    const plan = buildHabitConversion(task, { cadence: 'daily', targetOccurrences: 1 });
    expect(plan.warnings.some((w) => w.includes('30 分钟'))).toBe(true);
  });
});

describe('buildHabitConversion：改哪些字段', () => {
  it('每天 → 日重复 + 目标 1 次', () => {
    const plan = buildHabitConversion(makeTask(), { cadence: 'daily', targetOccurrences: 1 });
    expect(plan.patch.kind).toBe(TaskKind.Habit);
    expect(plan.patch.completion).toBe(CompletionRule.Frequency);
    expect(plan.patch.repeat).toEqual<RepeatRule>({ freq: RepeatFreq.Daily, interval: 1 });
    expect(plan.patch.targetOccurrences).toBe(1);
    expect(plan.message).toBe('已改成打卡习惯：每天 1 次');
  });

  it('每周 3 次 → 周重复 + 目标 3 次', () => {
    const plan = buildHabitConversion(makeTask(), { cadence: 'weekly', targetOccurrences: 3 });
    expect(plan.patch.repeat).toEqual<RepeatRule>({ freq: RepeatFreq.Weekly, interval: 1 });
    expect(plan.patch.targetOccurrences).toBe(3);
  });

  it('每月 10 次 → 月重复 + 目标 10 次', () => {
    const plan = buildHabitConversion(makeTask(), { cadence: 'monthly', targetOccurrences: 10 });
    expect(plan.patch.repeat).toEqual<RepeatRule>({ freq: RepeatFreq.Monthly, interval: 1 });
    expect(plan.patch.targetOccurrences).toBe(10);
  });

  it('每天模式强制目标为 1（一天做二次没有意义，界面也不该允许）', () => {
    const plan = buildHabitConversion(makeTask(), { cadence: 'daily', targetOccurrences: 5 });
    expect(plan.patch.targetOccurrences).toBe(1);
  });

  it('非法次数兜底为 1，小数向下取整', () => {
    const base = makeTask();
    expect(buildHabitConversion(base, { cadence: 'weekly', targetOccurrences: 0 }).patch.targetOccurrences).toBe(1);
    expect(buildHabitConversion(base, { cadence: 'weekly', targetOccurrences: -3 }).patch.targetOccurrences).toBe(1);
    expect(buildHabitConversion(base, { cadence: 'weekly', targetOccurrences: 2.9 }).patch.targetOccurrences).toBe(2);
  });

  it('清掉时长目标：一个任务只允许一套完成判定', () => {
    const plan = buildHabitConversion(makeTask({ targetMinutes: 30 }), {
      cadence: 'weekly',
      targetOccurrences: 3,
    });
    expect(plan.patch.targetMinutes).toBeNull();
  });

  it('状态回到待办、完成时间清空（完成与否从此由打卡记录回答）', () => {
    const plan = buildHabitConversion(
      makeTask({ status: TaskStatus.Done, completedAt: iso(2026, 10, 6, 18) }),
      { cadence: 'daily', targetOccurrences: 1 },
    );
    expect(plan.patch.status).toBe(TaskStatus.Todo);
    expect(plan.patch.completedAt).toBeNull();
  });

  it('不动时间：用户可能真想"每天早上 7 点跑步"', () => {
    const task = makeTask({ time: morningTime });
    const plan = buildHabitConversion(task, { cadence: 'daily', targetOccurrences: 1 });
    expect('time' in plan.patch).toBe(false);
    expect(task.time.startAt).toBe(iso(2026, 10, 7, 7));
  });

  it('不动标题、备注、归属、提醒', () => {
    const task = makeTask({ note: '膝盖不好就慢点', containerId: 'c1', reminderMinutesBefore: 10 });
    const plan = buildHabitConversion(task, { cadence: 'weekly', targetOccurrences: 3 });
    for (const field of ['title', 'note', 'containerId', 'reminderMinutesBefore'] as const) {
      expect(field in plan.patch).toBe(false);
      expect(task[field]).toBeDefined();
    }
  });

  it('同样的输入给同样的结果（纯函数，不掺随机）', () => {
    const task = makeTask();
    const input = { cadence: 'weekly' as const, targetOccurrences: 3 };
    expect(buildHabitConversion(task, input)).toEqual(buildHabitConversion(task, input));
  });
});

describe('buildHabitConversion：原本已完成过的那一次不能凭空消失', () => {
  it('任务已完成 + 默认 → 补一条今天的打卡', () => {
    const plan = buildHabitConversion(makeTask({ status: TaskStatus.Done }), {
      cadence: 'weekly',
      targetOccurrences: 3,
    });
    expect(plan.seedCheckin).toBe(true);
  });

  it('任务还没完成 → 不补打卡', () => {
    const plan = buildHabitConversion(makeTask({ status: TaskStatus.Todo }), {
      cadence: 'weekly',
      targetOccurrences: 3,
    });
    expect(plan.seedCheckin).toBe(false);
  });

  it('显式关掉就不补（用户自己决定不要这次的记录）', () => {
    const plan = buildHabitConversion(makeTask({ status: TaskStatus.Done }), {
      cadence: 'weekly',
      targetOccurrences: 3,
      countExistingCompletion: false,
    });
    expect(plan.seedCheckin).toBe(false);
  });
});

describe('buildHabitConversion：会抹掉什么要说出来', () => {
  it('原来有时长目标 → 警告', () => {
    const plan = buildHabitConversion(makeTask({ targetMinutes: 45 }), {
      cadence: 'weekly',
      targetOccurrences: 3,
    });
    expect(plan.warnings).toHaveLength(1);
    expect(plan.warnings[0]).toContain('45 分钟');
  });

  it('原来有重复规则 → 警告', () => {
    const plan = buildHabitConversion(makeTask({ repeat: { freq: RepeatFreq.Monthly, interval: 1 } }), {
      cadence: 'weekly',
      targetOccurrences: 3,
    });
    expect(plan.warnings.some((w) => w.includes('重复规则'))).toBe(true);
  });

  it('干净的执行型任务没有警告', () => {
    const plan = buildHabitConversion(makeTask(), { cadence: 'weekly', targetOccurrences: 3 });
    expect(plan.warnings).toEqual([]);
  });

  it('两样都有 → 两条警告都给', () => {
    const plan = buildHabitConversion(
      makeTask({ targetMinutes: 30, repeat: { freq: RepeatFreq.Daily, interval: 1 } }),
      { cadence: 'weekly', targetOccurrences: 3 },
    );
    expect(plan.warnings).toHaveLength(2);
  });
});

describe('describeCadence', () => {
  it('三种频率的中文描述', () => {
    expect(describeCadence('daily', 1)).toBe('每天 1 次');
    expect(describeCadence('weekly', 3)).toBe('每周 3 次');
    expect(describeCadence('monthly', 10)).toBe('每月 10 次');
  });
});
