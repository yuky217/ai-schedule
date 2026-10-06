import { describe, expect, it, vi } from 'vitest';

import { afterEach, beforeEach } from 'vitest';

import { TaskKind, TaskStatus, TimeAttribute } from './enums';
import { describeNextFire, nextFireAt } from './reminder';
import type { Task } from './task';

/**
 * 提醒调度的四个静默失败口（无时间、已过、权限、环境）里，
 * 前两个是**可以算出来的** —— 这里钉住它们的文案与判定，
 * 保证"界面显示的"和"实际排出去的"是同一套规则。
 */

function timedTask(startAt: Date, overrides: Partial<Task> = {}): Task {
  return {
    id: 't1',
    title: '测试',
    kind: TaskKind.Schedule,
    status: TaskStatus.Todo,
    time: {
      attribute: TimeAttribute.Fixed,
      startAt: startAt.toISOString(),
      endAt: null,
      dueAt: null,
    },
    ...overrides,
  } as Task;
}

const now = new Date(2026, 9, 7, 12, 0);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('nextFireAt', () => {
  it('准点提醒 = 任务开始时刻', () => {
    const fire = nextFireAt(timedTask(new Date(2026, 9, 7, 14, 0)), now);
    expect(fire!.getTime()).toBe(new Date(2026, 9, 7, 14, 0).getTime());
  });

  it('提前 10 分钟 = 开始前 10 分钟', () => {
    const fire = nextFireAt(
      timedTask(new Date(2026, 9, 7, 14, 0), { reminderMinutesBefore: 10 }),
      now,
    );
    expect(fire!.getTime()).toBe(new Date(2026, 9, 7, 13, 50).getTime());
  });

  it('提前量时刻已过 → 退回准点（与排程一致）', () => {
    const fire = nextFireAt(
      timedTask(new Date(2026, 9, 7, 12, 30), { reminderMinutesBefore: 60 }),
      now,
    );
    expect(fire!.getTime()).toBe(new Date(2026, 9, 7, 12, 30).getTime());
  });

  it('没有时间 / 时间已过 / 已完成 → null', () => {
    expect(nextFireAt(timedTask(new Date(2026, 9, 7, 11, 0)), now)).toBeNull();
    expect(
      nextFireAt(
        timedTask(new Date(2026, 9, 7, 14, 0), {
          time: { attribute: TimeAttribute.None, startAt: null, endAt: null, dueAt: null },
        }),
        now,
      ),
    ).toBeNull();
    expect(
      nextFireAt(timedTask(new Date(2026, 9, 7, 14, 0), { status: TaskStatus.Done }), now),
    ).toBeNull();
  });
});

describe('describeNextFire', () => {
  it('未来：说清几点响', () => {
    expect(describeNextFire(timedTask(new Date(2026, 9, 7, 14, 0)), now)).toBe(
      '将在 10月7日 14:00 提醒你',
    );
  });

  it('时间已过：明说这次不会再提醒', () => {
    expect(describeNextFire(timedTask(new Date(2026, 9, 7, 11, 0)), now)).toBe(
      '时间已过，这次不会再提醒',
    );
  });

  it('无时间：说明前提', () => {
    expect(
      describeNextFire(
        timedTask(new Date(2026, 9, 7, 14, 0), {
          time: { attribute: TimeAttribute.None, startAt: null, endAt: null, dueAt: null },
        }),
        now,
      ),
    ).toBe('定个时间才会提醒');
  });

  it('已完成：不再提醒', () => {
    expect(
      describeNextFire(timedTask(new Date(2026, 9, 7, 14, 0), { status: TaskStatus.Done }), now),
    ).toBe('已完成，不再提醒');
  });
});
