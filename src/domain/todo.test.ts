import { describe, expect, it } from 'vitest';

import {
  CaptureSource,
  CompletionRule,
  Priority,
  SyncState,
  TaskKind,
  TaskStatus,
  TimeAttribute,
} from './enums';
import type { Task } from './task';
import { bucketOf, groupTodos, isTodo } from './todo';

/** 基准时刻：2026-10-06（周二）15:00 本地时间 */
const NOW = new Date(2026, 9, 6, 15, 0, 0, 0);

function at(hour: number, minute = 0, dayOffset = 0): string {
  return new Date(2026, 9, 6 + dayOffset, hour, minute, 0, 0).toISOString();
}

function makeTask(id: string, patch: Partial<Task> = {}): Task {
  return {
    id,
    createdAt: at(9),
    updatedAt: at(9),
    syncState: SyncState.Local,
    title: `任务 ${id}`,
    kind: TaskKind.Execution,
    status: TaskStatus.Todo,
    time: { attribute: TimeAttribute.None },
    completion: CompletionRule.Check,
    tags: [],
    priority: Priority.P2,
    source: CaptureSource.Manual,
    progress: { accumulatedMinutes: 0 },
    ...patch,
  };
}

const fixed = (iso: string) => ({ attribute: TimeAttribute.Fixed, startAt: iso, endAt: null, dueAt: null });
const deadline = (iso: string) => ({ attribute: TimeAttribute.Deadline, startAt: null, endAt: null, dueAt: iso });

describe('isTodo：谁算待办', () => {
  it('执行型和习惯型算', () => {
    expect(isTodo(makeTask('a'))).toBe(true);
    expect(isTodo(makeTask('b', { kind: TaskKind.Habit }))).toBe(true);
  });

  it('日程型（有时间）不算 —— 开会、上课是"到点发生"，不是欠你的事', () => {
    expect(isTodo(makeTask('a', { kind: TaskKind.Schedule, time: fixed(at(18)) }))).toBe(false);
  });

  /**
   * ⭐ 这条例外是可达性扫描扫出来的：`todo/doing/waiting/done × schedule × 无时间`
   * 四种组合在**四个列表里同时查不到**（待办按分档、日历要时间、首页按时间窗、
   * 习惯页只取习惯型）。快记一句"开会"、没写时间，就是这么丢的。
   */
  it('⭐ 日程型但没排时间 → 算 —— 没有"到点"可言的日程需要一个落点', () => {
    expect(isTodo(makeTask('a', { kind: TaskKind.Schedule }))).toBe(true);
  });

  it('想法型不算 —— 它在想法库等拆解', () => {
    expect(isTodo(makeTask('a', { kind: TaskKind.Idea }))).toBe(false);
  });

  it('做完的执行型仍收进来（落在「已完成」档）', () => {
    expect(isTodo(makeTask('a', { status: TaskStatus.Done }))).toBe(true);
  });

  it('做完的日程型（有时间）不算（它从来就不是待办）', () => {
    expect(
      isTodo(makeTask('a', { kind: TaskKind.Schedule, time: fixed(at(18)), status: TaskStatus.Done })),
    ).toBe(false);
  });
});

describe('bucketOf：分到哪一档', () => {
  it('过期的截止型 → 已过期', () => {
    expect(bucketOf(makeTask('a', { time: deadline(at(12)) }), NOW)).toBe('overdue');
  });

  it('今天到期的 → 今天', () => {
    expect(bucketOf(makeTask('a', { time: deadline(at(20)) }), NOW)).toBe('today');
  });

  it('今天稍后开始的固定型 → 今天', () => {
    expect(bucketOf(makeTask('a', { time: fixed(at(18)) }), NOW)).toBe('today');
  });

  it('明天到期的 → 往后', () => {
    expect(bucketOf(makeTask('a', { time: deadline(at(9, 0, 1)) }), NOW)).toBe('upcoming');
  });

  it('完全没有时间的 → 还没排时间', () => {
    expect(bucketOf(makeTask('a'), NOW)).toBe('someday');
  });

  it('已过点的固定型不当作"过期欠着" → 今天（日程过期不是欠债）', () => {
    expect(bucketOf(makeTask('a', { time: fixed(at(11)) }), NOW)).toBe('today');
  });

  it('做完的 → 已完成（不管它本来该在哪档）', () => {
    expect(
      bucketOf(makeTask('a', { status: TaskStatus.Done, time: deadline(at(12)) }), NOW),
    ).toBe('done');
  });
});

describe('groupTodos：分档与排序', () => {
  it('空输入 → 空数组（界面不外挂空标题）', () => {
    expect(groupTodos([], NOW)).toEqual([]);
  });

  it('日程型不进任何档', () => {
    const groups = groupTodos([makeTask('s', { kind: TaskKind.Schedule, time: fixed(at(18)) })], NOW);
    expect(groups).toEqual([]);
  });

  it('档序固定：已过期 → 今天 → 往后 → 还没排时间 → 已完成', () => {
    const groups = groupTodos(
      [
        makeTask('done1', { status: TaskStatus.Done }),
        makeTask('someday1'),
        makeTask('future1', { time: deadline(at(9, 0, 2)) }),
        makeTask('today1', { time: deadline(at(20)) }),
        makeTask('overdue1', { time: deadline(at(12)) }),
      ],
      NOW,
    );
    expect(groups.map((g) => g.bucket)).toEqual(['overdue', 'today', 'upcoming', 'someday', 'done']);
  });

  it('空档整个不出现', () => {
    const groups = groupTodos([makeTask('today1', { time: deadline(at(20)) })], NOW);
    expect(groups.map((g) => g.bucket)).toEqual(['today']);
  });

  it('同一档内按时间先后', () => {
    const groups = groupTodos(
      [
        makeTask('late', { time: deadline(at(23)) }),
        makeTask('early', { time: deadline(at(16)) }),
      ],
      NOW,
    );
    expect(groups[0].tasks.map((t) => t.id)).toEqual(['early', 'late']);
  });

  it('"有时间的排前面"只能在同档内验 —— 无时间的必然落在『还没排时间』档，与有时间的不同档', () => {
    const groups = groupTodos(
      [
        makeTask('none', { time: { attribute: TimeAttribute.None } }),
        makeTask('has', { time: deadline(at(16)) }),
      ],
      NOW,
    );
    // 分档本身就把它们分开了，所以这一条不该在"同档排序"里验：
    expect(groups.map((g) => g.bucket)).toEqual(['today', 'someday']);
  });

  it('都没时间时保留传入顺序（那是用户自己拖出来的意愿）', () => {
    const groups = groupTodos([makeTask('b'), makeTask('a')], NOW);
    expect(groups[0].tasks.map((t) => t.id)).toEqual(['b', 'a']);
  });

  it('已完成档按"最近做完的在前"', () => {
    const groups = groupTodos(
      [
        makeTask('old', { status: TaskStatus.Done, updatedAt: at(9) }),
        makeTask('new', { status: TaskStatus.Done, updatedAt: at(14) }),
      ],
      NOW,
    );
    expect(groups[0].tasks.map((t) => t.id)).toEqual(['new', 'old']);
  });

  it('排序是确定性的：同样数据换输入顺序，档内顺序不变', () => {
    const a = makeTask('a', { time: deadline(at(16)) });
    const b = makeTask('b', { time: deadline(at(18)) });
    const c = makeTask('c');
    const one = groupTodos([a, b, c], NOW)[0].tasks.map((t) => t.id);
    const two = groupTodos([c, b, a], NOW)[0].tasks.map((t) => t.id);
    expect(one).toEqual(two);
  });

  it('习惯型没有时间也进待办（跑步、背单词本来就该出现在这儿）', () => {
    const groups = groupTodos([makeTask('run', { kind: TaskKind.Habit })], NOW);
    expect(groups[0].bucket).toBe('someday');
    expect(groups[0].tasks[0].id).toBe('run');
  });
});
