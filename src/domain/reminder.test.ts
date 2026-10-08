import { describe, expect, it, vi } from 'vitest';

import { afterEach, beforeEach } from 'vitest';

import { TaskKind, TaskStatus, TimeAttribute } from './enums';
import { RepeatFreq } from './enums';
import {
  defaultReminderMinutes,
  describeNextFire,
  nextFireAt,
  reminderFireTimes,
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

/**
 * 「这条任务接下来要在哪几个时刻响」—— 单次与重复的**唯一口径**
 * （界面显示、真正排程、启动补排三处都走它）。
 *
 * 2026-10-08 新增，修的是一个很难被发现的问题：重复任务以前只排"下一期"那一条，
 * 于是"每天 8 点吃药"只要哪天没打开 App，第二天就**不会响** ——
 * 而习惯型提醒的全部意义恰恰是"我不打开它也得响"。
 */
describe('reminderFireTimes', () => {
  /** 周三中午。用显式的 now 而不是系统时间，星期几才是确定的 */
  const now = new Date(2026, 9, 7, 12, 0);

  /** 读起来像人话的时间戳，失败信息里能一眼看出错在哪一期 */
  const stamp = (d: Date) =>
    `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(
      d.getMinutes(),
    ).padStart(2, '0')}`;
  const stamps = (task: Task, options: { days?: number } = {}) =>
    reminderFireTimes(task, { now, ...options }).map(stamp);

  const repeating = (start: Date, rule: Task['repeat'], extra: Partial<Task> = {}) =>
    timedTask(start, { reminderMinutesBefore: 0, repeat: rule, ...extra });
  const DAILY = { freq: RepeatFreq.Daily, interval: 1 } as const;

  it('没设提醒 / 已完成 / 没有时间 → 一条都不排', () => {
    const start = new Date(2026, 9, 7, 20, 0);
    expect(stamps(timedTask(start, { repeat: DAILY }))).toEqual([]);
    expect(stamps(repeating(start, DAILY, { status: TaskStatus.Done }))).toEqual([]);
    expect(
      stamps(
        timedTask(start, {
          reminderMinutesBefore: 0,
          time: { attribute: TimeAttribute.None, startAt: null, endAt: null, dueAt: null },
        }),
      ),
    ).toEqual([]);
  });

  it('单次任务：只有一条，而且**不受 7 天窗口限制**（两周后的安排也得响）', () => {
    expect(stamps(timedTask(new Date(2026, 9, 20, 14, 0), { reminderMinutesBefore: 10 }))).toEqual([
      '10/20 13:50',
    ]);
  });

  it('单次任务：时刻已过 → 一条都不排（不打扰用户"昨天的会"）', () => {
    expect(
      stamps(timedTask(new Date(2026, 9, 7, 9, 0), { reminderMinutesBefore: 0 })),
    ).toEqual([]);
  });

  it('每天：窗口内**每一期**都排上（这是"不打开 App 也会响"的全部依据）', () => {
    expect(stamps(repeating(new Date(2026, 9, 7, 20, 0), DAILY))).toEqual([
      '10/7 20:00',
      '10/8 20:00',
      '10/9 20:00',
      '10/10 20:00',
      '10/11 20:00',
      '10/12 20:00',
      '10/13 20:00',
    ]);
  });

  it('每天：锚点停在过去（几天没打勾）→ 先滚到未来，不含已经过去的时刻', () => {
    // 10/4 早上 8 点起每天，今天 10/7 中午才打开 App
    expect(stamps(repeating(new Date(2026, 9, 4, 8, 0), DAILY))).toEqual([
      '10/8 08:00',
      '10/9 08:00',
      '10/10 08:00',
      '10/11 08:00',
      '10/12 08:00',
      '10/13 08:00',
      '10/14 08:00',
    ]);
  });

  it('每周一三五：只落在周一/三/五，且按时间升序', () => {
    const fires = reminderFireTimes(
      repeating(new Date(2026, 9, 7, 18, 0), {
        freq: RepeatFreq.Weekly,
        interval: 1,
        byWeekday: [1, 3, 5],
      }),
      { now },
    );
    expect(fires.map((d) => d.getDay())).toEqual([3, 5, 1]);
    expect(fires.map(stamp)).toEqual(['10/7 18:00', '10/9 18:00', '10/12 18:00']);
  });

  it('每月 25 号：最近一期在窗口之外也**必须带上**（否则这条任务一条提醒都不会有）', () => {
    expect(
      stamps(
        repeating(
          new Date(2026, 9, 25, 9, 0),
          { freq: RepeatFreq.Monthly, interval: 1 },
          { time: { attribute: TimeAttribute.Deadline, startAt: null, endAt: null, dueAt: new Date(2026, 9, 25, 9, 0).toISOString() } },
        ),
      ),
    ).toEqual(['10/25 09:00']);
  });

  it('提前量已过、准点还没到 → 退回准点（每一期各自判断）', () => {
    expect(
      stamps(repeating(new Date(2026, 9, 7, 12, 30), DAILY, { reminderMinutesBefore: 60 })),
    ).toEqual([
      '10/7 12:30',
      '10/8 11:30',
      '10/9 11:30',
      '10/10 11:30',
      '10/11 11:30',
      '10/12 11:30',
      '10/13 11:30',
    ]);
  });

  it('窗口天数可覆盖（排几期由调用方说了算）', () => {
    expect(stamps(repeating(new Date(2026, 9, 7, 20, 0), DAILY), { days: 2 })).toEqual([
      '10/7 20:00',
      '10/8 20:00',
    ]);
  });
});
