import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TaskKind, TaskStatus, TimeAttribute, RepeatFreq } from '@/domain/enums';
import type { Task } from '@/domain/task';

import { scheduleTaskReminder, syncRepeatingTaskReminders } from './notifications';

/**
 * 调度层（entry）的测试网。
 *
 * domain 那边钉住了"该在哪几个时刻响"，这里钉的是**真正排出去与撤掉的范围**：
 * 排几条、每条带什么 taskId、撤的时候会不会误伤别的任务/课程/考试。
 * 这一层以前靠肉眼，而它恰恰有两个"安静地做错"的方向：
 * 排少了（重复提醒只有今天响）和撤多了（把别人的提醒一起干掉）。
 */

/** 假的通知系统：记下排了什么、谁还在 */
const fake = vi.hoisted(() => ({
  store: new Map<string, { title: string; body: string; data: Record<string, unknown> }>(),
  seq: 0,
  permission: { granted: true } as { granted: boolean },
}));

vi.mock('expo-constants', () => ({
  default: { executionEnvironment: 'bare' },
  ExecutionEnvironment: { StoreClient: 'storeClient' },
}));

vi.mock('react-native', () => ({
  Platform: { OS: 'android' },
  LogBox: { ignoreLogs: () => {} },
}));

vi.mock('expo-notifications', () => ({
  AndroidImportance: { DEFAULT: 3 },
  SchedulableTriggerInputTypes: { DATE: 'date', TIME_INTERVAL: 'timeInterval' },
  setNotificationHandler: () => {},
  setNotificationChannelAsync: async () => {},
  getPermissionsAsync: async () => fake.permission,
  requestPermissionsAsync: async () => fake.permission,
  scheduleNotificationAsync: async (req: {
    content: { title: string; body: string; data: Record<string, unknown> };
  }) => {
    const id = `n${(fake.seq += 1)}`;
    fake.store.set(id, { title: req.content.title, body: req.content.body, data: req.content.data });
    return id;
  },
  getAllScheduledNotificationsAsync: async () =>
    [...fake.store.entries()].map(([identifier, item]) => ({
      identifier,
      content: { title: item.title, body: item.body, data: item.data },
    })),
  cancelScheduledNotificationAsync: async (id: string) => {
    fake.store.delete(id);
  },
}));

/** 周三中午 —— 与 reminder.test.ts 用同一时刻，两边算出的期能对得上 */
const NOW = new Date(2026, 9, 7, 12, 0);

/** 排出去的提醒里，属于某个 taskId 的条数 */
const countFor = (taskId: string) =>
  [...fake.store.values()].filter((item) => item.data.taskId === taskId).length;

function task(overrides: Partial<Task> & { id: string }): Task {
  return {
    title: '测试',
    kind: TaskKind.Schedule,
    status: TaskStatus.Todo,
    time: {
      attribute: TimeAttribute.Fixed,
      startAt: new Date(2026, 9, 7, 20, 0).toISOString(),
      endAt: null,
      dueAt: null,
    },
    ...overrides,
  } as Task;
}

const DAILY = { freq: RepeatFreq.Daily, interval: 1 } as const;

beforeEach(() => {
  fake.store.clear();
  fake.seq = 0;
  fake.permission = { granted: true };
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('scheduleTaskReminder', () => {
  it('重复任务：一次把未来几期全排上，每期都带同一个 taskId', async () => {
    const ids = await scheduleTaskReminder(task({ id: 'a', reminderMinutesBefore: 0, repeat: DAILY }));

    // 10/7 20:00 到今天中午还没到，往后排满 7 天窗口
    expect(ids).toHaveLength(7);
    expect(countFor('a')).toBe(7);
  });

  it('单次任务：只排一条', async () => {
    const ids = await scheduleTaskReminder(task({ id: 'b', reminderMinutesBefore: 10 }));
    expect(ids).toHaveLength(1);
    expect(countFor('b')).toBe(1);
  });

  it('没设提醒 → 一条都不排，而且连权限都不问（默认安静）', async () => {
    const ids = await scheduleTaskReminder(task({ id: 'c' }));
    expect(ids).toEqual([]);
    expect(fake.store.size).toBe(0);
  });
});

describe('syncRepeatingTaskReminders', () => {
  it('补排重复任务的窗口，且**不碰**别人的通知（单次任务 / 课程 / 考试）', async () => {
    // 先摆好三类"别人的"通知：单次任务、课程、考试
    fake.store.set('one', { title: '单次', body: '', data: { taskId: 'once' } });
    fake.store.set('course', { title: '课', body: '', data: { courseId: 'c1' } });
    fake.store.set('exam', { title: '考试', body: '', data: { eventId: 'e1' } });
    // 重复任务的旧通知（窗口过期了，应该被撤掉重排）
    fake.store.set('old', { title: '吃药', body: '', data: { taskId: 'med' } });

    const count = await syncRepeatingTaskReminders([
      task({ id: 'med', reminderMinutesBefore: 0, repeat: DAILY }),
      task({ id: 'once', reminderMinutesBefore: 0 }),
      // 重复但没设提醒 → 不排
      task({ id: 'quiet', repeat: DAILY }),
      // 已完成的重复任务 → 不排
      task({ id: 'done', reminderMinutesBefore: 0, repeat: DAILY, status: TaskStatus.Done }),
    ]);

    expect(count).toBe(7);
    expect(countFor('med')).toBe(7);
    expect(fake.store.has('old')).toBe(false);

    expect(fake.store.has('one')).toBe(true);
    expect(fake.store.has('course')).toBe(true);
    expect(fake.store.has('exam')).toBe(true);
    expect(countFor('quiet')).toBe(0);
    expect(countFor('done')).toBe(0);
  });

  it('没有重复任务 → 什么都不做（连既有通知都不动）', async () => {
    fake.store.set('one', { title: '单次', body: '', data: { taskId: 'once' } });
    expect(await syncRepeatingTaskReminders([task({ id: 'once', reminderMinutesBefore: 0 })])).toBe(0);
    expect(fake.store.has('one')).toBe(true);
  });

  it('没拿到通知权限 → 不排，也**不弹权限框**（启动补排不得打扰用户）', async () => {
    fake.permission = { granted: false };
    const count = await syncRepeatingTaskReminders([
      task({ id: 'med', reminderMinutesBefore: 0, repeat: DAILY }),
    ]);
    expect(count).toBe(0);
    expect(fake.store.size).toBe(0);
  });
});
