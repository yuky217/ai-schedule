import { describe, expect, it } from 'vitest';

import { CompletionRule, TaskKind, TaskStatus } from './enums';
import { DEFAULT_EVENT_MINUTES, isActiveNow, isMuted, taskDisplayState, taskWindow } from './task-state';
import type { Task, TaskTime } from './task';

/**
 * 「这条任务现在算什么」的测试。
 *
 * 核心是两类"过了时间"必须分开：
 * - 截止型过期 = 欠着（overdue），不该弱化；
 * - 固定型过期 = 过去了（missed），该弱化。
 * 混成一种，要么欠着的事被藏起来，要么一堆"上周的会"永远显眼。
 */

const iso = (y: number, m: number, d: number, h = 0, min = 0): string =>
  new Date(y, m - 1, d, h, min, 0, 0).toISOString();

const NONE: TaskTime = { attribute: 'none', startAt: null, endAt: null, dueAt: null };

function makeTask(over: Partial<Task> = {}): Task {
  const created = iso(2026, 10, 6, 9);
  return {
    id: over.id ?? 't1',
    title: '一件事',
    kind: TaskKind.Execution,
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
  attribute: 'fixed',
  startAt,
  endAt,
  dueAt: null,
});

const deadline = (dueAt: string): TaskTime => ({
  attribute: 'deadline',
  startAt: null,
  endAt: null,
  dueAt,
});

describe('taskWindow', () => {
  it('只有截止的事是一个时间点，没有开始', () => {
    const w = taskWindow(makeTask({ time: deadline(iso(2026, 10, 6, 18)) }));
    expect(w).not.toBeNull();
    expect(w!.start).toBeNull();
    expect(w!.end).toBe(Date.parse(iso(2026, 10, 6, 18)));
  });

  it('固定型没给结束就按默认半小时算', () => {
    const start = iso(2026, 10, 6, 15);
    const w = taskWindow(makeTask({ time: fixed(start) }))!;
    expect(w.end - w.start!).toBe(DEFAULT_EVENT_MINUTES * 60_000);
  });

  it('给了结束就用结束', () => {
    const w = taskWindow(
      makeTask({ time: fixed(iso(2026, 10, 6, 15), iso(2026, 10, 6, 17)) }),
    )!;
    expect(w.end).toBe(Date.parse(iso(2026, 10, 6, 17)));
  });

  it('结束早于开始（脏数据）不会算出负长度', () => {
    const w = taskWindow(
      makeTask({ time: fixed(iso(2026, 10, 6, 15), iso(2026, 10, 6, 14)) }),
    )!;
    expect(w.end).toBe(w.start);
  });

  it('什么都没安排 → null（日历上没有它）', () => {
    expect(taskWindow(makeTask())).toBeNull();
  });
});

describe('taskDisplayState', () => {
  const now = new Date(iso(2026, 10, 6, 15));

  it('已完成永远是 done，哪怕时间还在后面', () => {
    const task = makeTask({
      status: TaskStatus.Done,
      time: fixed(iso(2026, 10, 6, 20)),
    });
    expect(taskDisplayState(task, now)).toBe('done');
  });

  it('固定型：还没开始 = upcoming，正在其中 = active，过了 = missed', () => {
    const at = (h: number) => makeTask({ time: fixed(iso(2026, 10, 6, h), iso(2026, 10, 6, h + 1)) });
    expect(taskDisplayState(at(20), now)).toBe('upcoming');
    expect(taskDisplayState(at(14), now)).toBe('active');
    expect(taskDisplayState(at(9), now)).toBe('missed');
  });

  it('固定型的边界：正好在开始那一刻算 active，正好在结束那一刻还算 active', () => {
    const spanning = makeTask({
      time: fixed(iso(2026, 10, 6, 15), iso(2026, 10, 6, 16)),
    });
    expect(taskDisplayState(spanning, now)).toBe('active');
    expect(taskDisplayState(spanning, new Date(iso(2026, 10, 6, 16)))).toBe('active');
    expect(taskDisplayState(spanning, new Date(iso(2026, 10, 6, 16, 1)))).toBe('missed');
  });

  it('截止型：没过 ddl 是 upcoming（哪怕还没到）', () => {
    expect(taskDisplayState(makeTask({ time: deadline(iso(2026, 10, 6, 18)) }), now)).toBe('upcoming');
  });

  it('截止型：过了 ddl 是 overdue，不是 missed — 它还欠着', () => {
    const late = makeTask({ time: deadline(iso(2026, 10, 5, 18)) });
    expect(taskDisplayState(late, now)).toBe('overdue');
    expect(isMuted(taskDisplayState(late, now))).toBe(false);
  });

  it('过了时间的固定型该弱化，过了时间的截止型不该', () => {
    const meeting = makeTask({ time: fixed(iso(2026, 10, 6, 9), iso(2026, 10, 6, 10)) });
    expect(isMuted(taskDisplayState(meeting, now))).toBe(true);
  });

  it('时间过了不会变成完成 —— 状态只由用户改', () => {
    const task = makeTask({ time: deadline(iso(2026, 9, 1, 9)) });
    expect(taskDisplayState(task, now)).toBe('overdue');
    expect(task.status).toBe(TaskStatus.Todo);
  });

  it('还没安排时间的算 unscheduled', () => {
    expect(taskDisplayState(makeTask(), now)).toBe('unscheduled');
  });

  it('时间字段脏了也当"没安排"，不抛错', () => {
    const broken = makeTask({
      time: { attribute: 'fixed', startAt: 'not-a-date', endAt: null, dueAt: null },
    });
    expect(taskDisplayState(broken, now)).toBe('unscheduled');
  });
});

describe('isActiveNow', () => {
  const now = new Date(iso(2026, 10, 6, 15));

  it('只有"正在这段时间里"才算，已过的不算', () => {
    expect(isActiveNow(makeTask({ time: fixed(iso(2026, 10, 6, 14), iso(2026, 10, 6, 16)) }), now)).toBe(true);
    expect(isActiveNow(makeTask({ time: fixed(iso(2026, 10, 6, 9), iso(2026, 10, 6, 10)) }), now)).toBe(false);
  });

  it('已完成的即使时间正落在其中也不算', () => {
    const task = makeTask({
      status: TaskStatus.Done,
      time: fixed(iso(2026, 10, 6, 14), iso(2026, 10, 6, 16)),
    });
    expect(isActiveNow(task, now)).toBe(false);
  });

  it('只有截止、没有开始的事不会算作"正在进行"', () => {
    expect(isActiveNow(makeTask({ time: deadline(iso(2026, 10, 6, 18)) }), now)).toBe(false);
  });
});
