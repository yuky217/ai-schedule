import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TaskKind, TaskStatus, TimeAttribute } from './enums';
import {
  advanceRepeatingTask,
  describeRepeat,
  describeReminder,
  nextOccurrence,
} from './repeat-next';
import type { RepeatRule, Task } from './task';

/**
 * 重复任务的「下一期」计算。
 *
 * 这里最要紧的一条不变量是：**完成一次之后，下一期必须是未来**。
 * 用户完全可能"晚勾"——昨天 08:00 的每日任务今天 10:00 才打勾，
 * 如果只从原锚点 +1 天算，下一期就是"今天 08:00"= 过去，
 * 任务回待办却带着一个已过去的时间，立刻被判 missed，等于越滚越糟。
 */

function dailyTask(anchor: Date, overrides: Partial<Task> = {}): Task {
  return {
    id: 't1',
    title: '晨间锻炼',
    kind: TaskKind.Execution,
    status: TaskStatus.Todo,
    time: {
      attribute: TimeAttribute.Fixed,
      startAt: anchor.toISOString(),
      endAt: null,
      dueAt: null,
    },
    repeat: { freq: 'daily', interval: 1 },
    ...overrides,
  } as Task;
}

/** 本地时间构造，断言也用本地字段，测试本身不挑时区 */
function local(y: number, m: number, d: number, h: number, min: number): Date {
  return new Date(y, m - 1, d, h, min, 0, 0);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('nextOccurrence', () => {
  it('每天：+interval 天并保留时刻', () => {
    const next = nextOccurrence({ freq: 'daily', interval: 1 }, local(2026, 10, 7, 8, 0));
    expect(next).not.toBeNull();
    expect(next!.getDate()).toBe(8);
    expect(next!.getHours()).toBe(8);
  });

  it('每月：1 月 31 日滚到 2 月钳到 28 日', () => {
    const next = nextOccurrence({ freq: 'monthly', interval: 1 }, local(2026, 1, 31, 9, 0));
    expect(next!.getMonth()).toBe(1);
    expect(next!.getDate()).toBe(28);
  });

  it('每 2 周的周一：跳过中间那个周一', () => {
    // 2026-10-05 是周一
    const next = nextOccurrence(
      { freq: 'weekly', interval: 2, byWeekday: [1] },
      local(2026, 10, 5, 8, 0),
    );
    expect(next!.getDate()).toBe(19);
  });
});

describe('advanceRepeatingTask 的下期不变量', () => {
  it('准点勾：下一期是明天同一时刻', () => {
    vi.setSystemTime(local(2026, 10, 7, 8, 5));
    const patch = advanceRepeatingTask(dailyTask(local(2026, 10, 7, 8, 0)));
    expect(patch).not.toBeNull();
    expect(patch!.time!.attribute).toBe('fixed');
    expect(new Date(patch!.time!.startAt!).getTime()).toBe(
      local(2026, 10, 8, 8, 0).getTime(),
    );
  });

  it('晚勾一天：下一期仍然在未来（不许滚进过去）', () => {
    vi.setSystemTime(local(2026, 10, 8, 10, 0)); // 锚点是昨天 08:00，今天 10:00 才勾
    const patch = advanceRepeatingTask(dailyTask(local(2026, 10, 7, 8, 0)));
    const nextAt = new Date(patch!.time!.startAt!).getTime();
    expect(nextAt).toBeGreaterThan(Date.now());
    expect(nextAt).toBe(local(2026, 10, 9, 8, 0).getTime());
  });

  it('晚勾好几天：一路滚到第一个晚于现在的期', () => {
    vi.setSystemTime(local(2026, 10, 11, 10, 0)); // 锚点是 4 天前
    const patch = advanceRepeatingTask(dailyTask(local(2026, 10, 7, 8, 0)));
    const nextAt = new Date(patch!.time!.startAt!).getTime();
    expect(nextAt).toBeGreaterThan(Date.now());
    expect(nextAt).toBe(local(2026, 10, 12, 8, 0).getTime());
  });

  it('提前勾：下一期不变（不因为提前完成而把期提前）', () => {
    vi.setSystemTime(local(2026, 10, 7, 7, 0)); // 锚点今天 08:00，7 点就勾了
    const patch = advanceRepeatingTask(dailyTask(local(2026, 10, 7, 8, 0)));
    expect(new Date(patch!.time!.startAt!).getTime()).toBe(
      local(2026, 10, 8, 8, 0).getTime(),
    );
  });

  it('滚动同时把状态翻回待办、清掉完成时间', () => {
    vi.setSystemTime(local(2026, 10, 7, 8, 5));
    const patch = advanceRepeatingTask(
      dailyTask(local(2026, 10, 7, 8, 0), { status: TaskStatus.Done }),
    );
    expect(patch).not.toBeNull();
    expect(patch!.status).toBe(TaskStatus.Todo);
    expect(patch!.completedAt).toBeNull();
  });

  it('截止型滚 dueAt、不动 startAt', () => {
    vi.setSystemTime(local(2026, 10, 7, 8, 5));
    const task = dailyTask(local(2026, 10, 7, 8, 0), {
      time: {
        attribute: TimeAttribute.Deadline,
        startAt: null,
        endAt: null,
        dueAt: local(2026, 10, 7, 18, 0).toISOString(),
      },
    });
    const patch = advanceRepeatingTask(task);
    expect(patch).not.toBeNull();
    expect(patch!.time!.attribute).toBe('deadline');
    expect(new Date(patch!.time!.dueAt!).getTime()).toBe(local(2026, 10, 8, 18, 0).getTime());
    expect(patch!.time!.startAt).toBeNull();
  });

  it('没有 repeat 或没有锚点：不滚动，按普通完成处理', () => {
    vi.setSystemTime(local(2026, 10, 7, 8, 5));
    expect(
      advanceRepeatingTask(dailyTask(local(2026, 10, 7, 8, 0), { repeat: undefined as never })),
    ).toBeNull();
    expect(
      advanceRepeatingTask(
        dailyTask(local(2026, 10, 7, 8, 0), {
          time: { attribute: TimeAttribute.None, startAt: null, endAt: null, dueAt: null },
        }),
      ),
    ).toBeNull();
  });
});

describe('中文短描述', () => {
  it.each([
    [{ freq: 'daily', interval: 1 }, '每天'],
    [{ freq: 'daily', interval: 3 }, '每 3 天'],
    [{ freq: 'weekly', interval: 1, byWeekday: [1, 2, 3, 4, 5] }, '工作日'],
    [{ freq: 'weekly', interval: 1, byWeekday: [6, 0] }, '每周六、周日'],
    [{ freq: 'monthly', interval: 2 }, '每 2 个月'],
  ] as const)('%j → %s', (rule, label) => {
    const normalised: RepeatRule =
      'byWeekday' in rule ? { ...rule, byWeekday: [...rule.byWeekday] } : { ...rule };
    expect(describeRepeat(normalised)).toBe(label);
  });

  it.each([
    [0, '准点'],
    [10, '提前 10 分钟'],
    [60, '提前 1 小时'],
    [90, '提前 90 分钟'],
  ] as const)('提前量 %i 分钟 → %s', (minutes, label) => {
    expect(describeReminder(minutes)).toBe(label);
  });
});

describe('yearly（2026-10-11 加的：每年一次的事也允许是任务）', () => {
  it('每年：下一年同月同日，时刻保留', () => {
    const next = nextOccurrence({ freq: 'yearly', interval: 1 }, new Date(2026, 2, 6, 9, 0));
    expect(next!.getFullYear()).toBe(2027);
    expect(next!.getMonth()).toBe(2);
    expect(next!.getDate()).toBe(6);
    expect(next!.getHours()).toBe(9);
  });

  it('2月29日 → 平年钳到 2月28日（不滚成 3月1日）', () => {
    const next = nextOccurrence({ freq: 'yearly', interval: 1 }, new Date(2028, 1, 29, 8, 0));
    expect(next!.getFullYear()).toBe(2029);
    expect(next!.getMonth()).toBe(1);
    expect(next!.getDate()).toBe(28);
  });

  it('每 2 年：跨两年', () => {
    const next = nextOccurrence({ freq: 'yearly', interval: 2 }, new Date(2026, 2, 6, 9, 0));
    expect(next!.getFullYear()).toBe(2028);
  });

  it('描述：每年 / 每 2 年', () => {
    expect(describeRepeat({ freq: 'yearly', interval: 1 })).toBe('每年');
    expect(describeRepeat({ freq: 'yearly', interval: 2 })).toBe('每 2 年');
  });

  it('完成一次后滚到下一期（advanceRepeatingTask 走通 yearly）', () => {
    vi.setSystemTime(new Date(2026, 2, 7, 10, 0)); // 锚点 3月6日 已过
    try {
      const patch = advanceRepeatingTask(
        dailyTask(new Date(2026, 2, 6, 9, 0), {
          repeat: { freq: 'yearly', interval: 1 },
        }),
      );
      expect(patch?.time).toMatchObject({ startAt: new Date(2027, 2, 6, 9, 0).toISOString() });
    } finally {
      vi.useRealTimers();
    }
  });
});
