import { describe, expect, it } from 'vitest';

import { CaptureSource, CompletionRule, Priority, SyncState, TaskKind, TaskStatus, TimeAttribute } from './enums';
import { defaultFocusIndex, listFocusCandidates, pickFocusCandidate } from './focus-candidate';
import type { Task } from './task';

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
const done = { status: TaskStatus.Done, completedAt: at(10) };

describe('pickFocusCandidate', () => {
  it('什么都没有时返回 null，不硬凑一件出来', () => {
    expect(pickFocusCandidate({ today: [], inbox: [], now: NOW })).toBeNull();
  });

  it('全部完成时不提案', () => {
    const tasks = [makeTask('a', done), makeTask('b', { ...done, time: fixed(at(16)) })];
    expect(pickFocusCandidate({ today: tasks, inbox: [], now: NOW })).toBeNull();
  });

  it('进行中优先于今天的日程', () => {
    const doing = makeTask('doing', { status: TaskStatus.Doing });
    const meeting = makeTask('meeting', { kind: TaskKind.Schedule, time: fixed(at(16)) });
    const picked = pickFocusCandidate({ today: [meeting, doing], inbox: [], now: NOW });
    expect(picked?.task.id).toBe('doing');
  });

  it('多个进行中时取最近动过的那个（不依赖数组顺序）', () => {
    const older = makeTask('older', { status: TaskStatus.Doing, updatedAt: at(10) });
    const newer = makeTask('newer', { status: TaskStatus.Doing, updatedAt: at(14) });
    expect(pickFocusCandidate({ today: [older, newer], inbox: [], now: NOW })?.task.id).toBe('newer');
    expect(pickFocusCandidate({ today: [newer, older], inbox: [], now: NOW })?.task.id).toBe('newer');
  });

  it('进行中且 updatedAt 相同时按 id 兜底，结果稳定', () => {
    const a = makeTask('aaa', { status: TaskStatus.Doing, updatedAt: at(10) });
    const b = makeTask('bbb', { status: TaskStatus.Doing, updatedAt: at(10) });
    expect(pickFocusCandidate({ today: [a, b], inbox: [], now: NOW })?.task.id).toBe('aaa');
    expect(pickFocusCandidate({ today: [b, a], inbox: [], now: NOW })?.task.id).toBe('aaa');
  });

  it('今天的固定日程取离现在最近的（未来的）', () => {
    const soon = makeTask('soon', { time: fixed(at(16)) });
    const later = makeTask('later', { time: fixed(at(20)) });
    expect(pickFocusCandidate({ today: [later, soon], inbox: [], now: NOW })?.task.id).toBe('soon');
  });

  it('今天的固定日程都过点了时，取刚过去的那件而不是最早那件', () => {
    const early = makeTask('early', { time: fixed(at(9)) });
    const recent = makeTask('recent', { time: fixed(at(13)) });
    const picked = pickFocusCandidate({ today: [early, recent], inbox: [], now: NOW });
    expect(picked?.task.id).toBe('recent');
    expect(picked?.reason).toContain('过点');
  });

  it('明天的固定日程不算今天该做的事', () => {
    const tomorrow = makeTask('tomorrow', { time: fixed(at(10, 0, 1)) });
    expect(pickFocusCandidate({ today: [tomorrow], inbox: [], now: NOW })).toBeNull();
  });

  it('今天到期的取最早到期的那个', () => {
    const late = makeTask('late', { time: deadline(at(23, 59)) });
    const early = makeTask('early', { time: deadline(at(18)) });
    expect(pickFocusCandidate({ today: [late, early], inbox: [], now: NOW })?.task.id).toBe('early');
  });

  it('固定时间排在截止之前（有钟点的比只有 ddl 的更该马上做）', () => {
    const meeting = makeTask('meeting', { time: fixed(at(20)) });
    const report = makeTask('report', { time: deadline(at(18)) });
    const ids = listFocusCandidates({ today: [report, meeting], inbox: [], now: NOW }).map((c) => c.task.id);
    expect(ids).toEqual(['meeting', 'report']);
  });

  it('都没有时落到收集箱，且保留用户自己的排序', () => {
    const first = makeTask('first');
    const second = makeTask('second');
    const picked = pickFocusCandidate({ today: [], inbox: [first, second], now: NOW });
    expect(picked?.task.id).toBe('first');
    expect(picked?.reason).toContain('收集箱');
  });

  it('收集箱里已完成的不出现', () => {
    const finished = makeTask('finished', done);
    const open = makeTask('open');
    expect(pickFocusCandidate({ today: [], inbox: [finished, open], now: NOW })?.task.id).toBe('open');
  });

  it('同一件事命中多条规则时只出现一次，且保留优先级最高的理由', () => {
    const both = makeTask('both', {
      status: TaskStatus.Doing,
      time: deadline(at(23)),
    });
    const candidates = listFocusCandidates({ today: [both], inbox: [both], now: NOW });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.reason).toContain('进行中');
  });

  it('「换一件」能拿到队列里的下一件', () => {
    const first = makeTask('a', { time: fixed(at(16)) });
    const second = makeTask('b', { time: fixed(at(18)) });
    const candidates = listFocusCandidates({ today: [first, second], inbox: [], now: NOW });
    expect(candidates.map((c) => c.task.id)).toEqual(['a', 'b']);
  });

  it('不改动传入的数组', () => {
    const today = [makeTask('b', { time: fixed(at(20)) }), makeTask('a', { time: fixed(at(16)) })];
    const inbox = [makeTask('c')];
    const todayBefore = today.map((t) => t.id);
    const inboxBefore = inbox.map((t) => t.id);
    listFocusCandidates({ today, inbox, now: NOW });
    expect(today.map((t) => t.id)).toEqual(todayBefore);
    expect(inbox.map((t) => t.id)).toEqual(inboxBefore);
  });
});

/**
 * 指针默认停在哪一格。
 *
 * 这一条的取舍：默认项宁可指向"时间表上正在发生的"或"用户明确标了在做的事"，
 * 也不要"随便挑一件待办" —— 后者解释不了自己，用户还得先滑走才知道不对。
 * 都覆盖不到就给空白输入框，让用户自己说。
 */
describe('defaultFocusIndex', () => {
  it('此刻正落在某件安排里 → 指向它，而不是"离现在最近的那件"', () => {
    const soon = makeTask('soon', { time: fixed(at(15, 10)) });
    const meeting = makeTask('meeting', {
      time: { attribute: TimeAttribute.Fixed, startAt: at(14), endAt: at(16), dueAt: null },
    });
    const candidates = listFocusCandidates({ today: [soon, meeting], inbox: [], now: NOW });
    expect(candidates.map((c) => c.task.id)).toEqual(['soon', 'meeting']);
    expect(defaultFocusIndex(candidates, NOW)).toBe(1);
  });

  it('正在进行优先于「进行中」', () => {
    const doing = makeTask('doing', { status: TaskStatus.Doing });
    const meeting = makeTask('meeting', {
      time: { attribute: TimeAttribute.Fixed, startAt: at(14), endAt: at(16), dueAt: null },
    });
    const candidates = listFocusCandidates({ today: [doing, meeting], inbox: [], now: NOW });
    expect(candidates[0]?.task.id).toBe('doing');
    expect(defaultFocusIndex(candidates, NOW)).toBe(1);
  });

  it('没有正在进行的，就指向标了「进行中」的那件', () => {
    const doing = makeTask('doing', { status: TaskStatus.Doing });
    const later = makeTask('later', { time: fixed(at(20)) });
    const candidates = listFocusCandidates({ today: [later, doing], inbox: [], now: NOW });
    expect(defaultFocusIndex(candidates, NOW)).toBe(0);
  });

  it('只有普通待办时返回 null —— 界面据此把指针放到「写一件新的事」', () => {
    const later = makeTask('later', { time: fixed(at(20)) });
    const candidates = listFocusCandidates({ today: [later], inbox: [], now: NOW });
    expect(defaultFocusIndex(candidates, NOW)).toBeNull();
  });

  it('已经过点的日程不接管默认项（那是"欠着"，不是"正在做"）', () => {
    const missed = makeTask('missed', { time: fixed(at(9)) });
    const candidates = listFocusCandidates({ today: [missed], inbox: [], now: NOW });
    expect(defaultFocusIndex(candidates, NOW)).toBeNull();
  });

  it('空队列返回 null', () => {
    expect(defaultFocusIndex([], NOW)).toBeNull();
  });
});
