import { describe, expect, it, vi } from 'vitest';

import { afterEach, beforeEach } from 'vitest';

import { TaskKind, TaskStatus, TimeAttribute } from './enums';
import { RepeatFreq } from './enums';
import {
  defaultReminderMinutes,
  describeNextFire,
  nextFireAt,
  resolveReminderMinutes,
} from './reminder';
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
    const fire = nextFireAt(
      timedTask(new Date(2026, 9, 7, 14, 0), { reminderMinutesBefore: 0 }),
      now,
    );
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

  /*
   * 「没设提醒」与「准点」是两件事（2026-10-08 改）：以前 `null` 当准点用，
   * 于是没点过提醒那一格的人照样被通知，界面还说"没设"。这条钉住它们分开了。
   */
  it('没设提醒 → 不会响（null 不再等于准点）', () => {
    const task = timedTask(new Date(2026, 9, 7, 14, 0));
    expect(task.reminderMinutesBefore).toBeUndefined();
    expect(nextFireAt(task, now)).toBeNull();
  });

  it('没有时间 / 时间已过 / 已完成 → null', () => {
    expect(
      nextFireAt(timedTask(new Date(2026, 9, 7, 11, 0), { reminderMinutesBefore: 0 }), now),
    ).toBeNull();
    expect(
      nextFireAt(
        timedTask(new Date(2026, 9, 7, 14, 0), {
          reminderMinutesBefore: 0,
          time: { attribute: TimeAttribute.None, startAt: null, endAt: null, dueAt: null },
        }),
        now,
      ),
    ).toBeNull();
    expect(
      nextFireAt(
        timedTask(new Date(2026, 9, 7, 14, 0), { reminderMinutesBefore: 0, status: TaskStatus.Done }),
        now,
      ),
    ).toBeNull();
  });
});

describe('describeNextFire', () => {
  it('未来：说清几点响', () => {
    expect(
      describeNextFire(timedTask(new Date(2026, 9, 7, 14, 0), { reminderMinutesBefore: 0 }), now),
    ).toBe('将在 10月7日 14:00 提醒你');
  });

  it('时间已过：明说这次不会再提醒', () => {
    expect(
      describeNextFire(timedTask(new Date(2026, 9, 7, 11, 0), { reminderMinutesBefore: 0 }), now),
    ).toBe('时间已过，这次不会再提醒');
  });

  it('没设提醒：明说没有提醒，并指一下怎么开', () => {
    expect(describeNextFire(timedTask(new Date(2026, 9, 7, 14, 0)), now)).toBe(
      '还没有提醒，想要就挑一个提前量',
    );
  });

  it('无时间：说明前提', () => {
    expect(
      describeNextFire(
        timedTask(new Date(2026, 9, 7, 14, 0), {
          reminderMinutesBefore: 0,
          time: { attribute: TimeAttribute.None, startAt: null, endAt: null, dueAt: null },
        }),
        now,
      ),
    ).toBe('定个时间才会提醒');
  });

  it('已完成：不再提醒', () => {
    expect(
      describeNextFire(
        timedTask(new Date(2026, 9, 7, 14, 0), { reminderMinutesBefore: 0, status: TaskStatus.Done }),
        now,
      ),
    ).toBe('已完成，不再提醒');
  });
});

/**
 * 「提了提醒、但没说提前多久」时该提前多久 —— 按事情类型给（2026-10-08 用户要求）。
 * 三条分支对应三类事的正确时刻：截止要留出做的时间、重复到点就该做、其余要动身。
 */
describe('defaultReminderMinutes', () => {
  const base = { kind: TaskKind.Execution, attribute: TimeAttribute.Fixed } as const;

  it('截止型 → 提前 1 小时（准点提醒等于通知你"已经晚了"）', () => {
    expect(defaultReminderMinutes({ ...base, attribute: TimeAttribute.Deadline })).toBe(60);
  });

  it('重复型 → 准点（到点就该做，提前没有额外价值）', () => {
    expect(
      defaultReminderMinutes({
        ...base,
        repeat: { freq: RepeatFreq.Daily, interval: 1 },
      }),
    ).toBe(0);
  });

  it('习惯型 → 准点', () => {
    expect(defaultReminderMinutes({ ...base, kind: TaskKind.Habit })).toBe(0);
  });

  it('其余（开会、活动、约好的事）→ 提前 10 分钟', () => {
    expect(defaultReminderMinutes({ ...base, kind: TaskKind.Schedule })).toBe(10);
  });
});

/** 手动 > 文字写明 > 类型默认 > 不提醒 —— chip 显示与落库共用这一条 */
describe('resolveReminderMinutes', () => {
  const base = { kind: TaskKind.Schedule, attribute: TimeAttribute.Fixed } as const;

  it('没动过 chip、文字里也没提 → 不提醒', () => {
    expect(resolveReminderMinutes(base)).toBeNull();
  });

  it('没动过 chip、文字里写明了 → 用文字里的', () => {
    expect(resolveReminderMinutes({ ...base, parsed: 30 })).toBe(30);
  });

  it('文字写在但没给量 → 用类型默认值', () => {
    expect(resolveReminderMinutes({ ...base, parsedUnspecified: true })).toBe(10);
    expect(
      resolveReminderMinutes({
        ...base,
        attribute: TimeAttribute.Deadline,
        parsedUnspecified: true,
      }),
    ).toBe(60);
  });

  it('用户点过「不提醒」→ 压过文字里写的', () => {
    expect(resolveReminderMinutes({ ...base, manual: null, parsed: 30 })).toBeNull();
    expect(resolveReminderMinutes({ ...base, manual: null, parsedUnspecified: true })).toBeNull();
  });

  it('用户点过具体值 → 压过文字里写的', () => {
    expect(resolveReminderMinutes({ ...base, manual: 5, parsed: 30 })).toBe(5);
  });
});
