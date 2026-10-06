import { describe, expect, it } from 'vitest';

import { toDayKey } from '@/utils/datetime';

import { CompletionRule, RepeatFreq, TaskStatus } from './enums';
import {
  describePeriodProgress,
  desiredFrequencyStatus,
  occurrencesInPeriod,
  periodWindow,
} from './habit-period';
import type { RepeatRule } from './task';

/**
 * 「本期」口径的测试。
 *
 * 这组用例守的是一个**真出过的 bug**：以前"本期次数"存在任务里、没人负责归零，
 * 于是"每周 3 次"一旦达标就永远停在已完成，下一周做完也不会回来。
 * 所以最关键的一条在最后：**跨到下一周，本期次数必须回到 0**。
 */

/** 本地日期，避免 UTC 解析把"哪天"算错 */
const d = (y: number, m: number, day: number, h = 0, min = 0): Date =>
  new Date(y, m - 1, day, h, min, 0, 0);

const key = (y: number, m: number, day: number): string => toDayKey(d(y, m, day));

const weekly: RepeatRule = { freq: RepeatFreq.Weekly, interval: 1 };
const monthly: RepeatRule = { freq: RepeatFreq.Monthly, interval: 1 };
const daily: RepeatRule = { freq: RepeatFreq.Daily, interval: 1 };

/* --------------------------- 块边界 --------------------------- */

describe('periodWindow：块边界', () => {
  it('每天：本期就是今天，起点终点同一天', () => {
    const w = periodWindow(daily, d(2026, 10, 6, 23, 30));
    expect(w.fromDayKey).toBe(key(2026, 10, 6));
    expect(w.toDayKey).toBe(key(2026, 10, 6));
    expect(w.label).toBe('今天');
  });

  it('每周：块是周一到周日（2026-10-01 是周四，所以 10-05 是周一）', () => {
    const w = periodWindow(weekly, d(2026, 10, 6, 15, 0));
    expect(w.fromDayKey).toBe(key(2026, 10, 5));
    expect(w.toDayKey).toBe(key(2026, 10, 11));
    expect(w.label).toBe('本周');
  });

  it('每周：同周的周日算同一块（不因为跨了周末就翻页）', () => {
    expect(periodWindow(weekly, d(2026, 10, 11, 23, 59)).fromDayKey).toBe(key(2026, 10, 5));
    // 周一零点起就是新的一块
    expect(periodWindow(weekly, d(2026, 10, 12, 0, 0)).fromDayKey).toBe(key(2026, 10, 12));
  });

  it('每周：块之间首尾相接，没有缝也不重叠', () => {
    const thisWeek = periodWindow(weekly, d(2026, 10, 6));
    const nextWeek = periodWindow(weekly, d(2026, 10, 13));
    expect(thisWeek.toDayKey).toBe(key(2026, 10, 11));
    expect(nextWeek.fromDayKey).toBe(key(2026, 10, 12));
    // 上一块的末日 + 1 天 = 下一块的首日
    expect(toDayKey(new Date(d(2026, 10, 11).getTime() + 864e5))).toBe(nextWeek.fromDayKey);
  });

  it('每月：1 号到月末', () => {
    const w = periodWindow(monthly, d(2026, 10, 6));
    expect(w.fromDayKey).toBe(key(2026, 10, 1));
    expect(w.toDayKey).toBe(key(2026, 10, 31));
    expect(w.label).toBe('本月');
  });

  it('每月：闰年 2 月到 29 号，平年到 28 号', () => {
    expect(periodWindow(monthly, d(2024, 2, 10)).toDayKey).toBe(key(2024, 2, 29));
    expect(periodWindow(monthly, d(2026, 2, 10)).toDayKey).toBe(key(2026, 2, 28));
  });

  it('每 2 周：块仍然是周一起、周日止，长度 14 天', () => {
    const w = periodWindow({ freq: RepeatFreq.Weekly, interval: 2 }, d(2026, 10, 6));
    const from = new Date(w.fromDayKey.replace(/-/g, '/'));
    const to = new Date(w.toDayKey.replace(/-/g, '/'));
    expect(from.getDay()).toBe(1);
    expect(to.getDay()).toBe(0);
    expect(Math.round((to.getTime() - from.getTime()) / 864e5)).toBe(13);
    // 此刻必须落在块内
    expect(w.fromDayKey <= key(2026, 10, 6)).toBe(true);
    expect(key(2026, 10, 6) <= w.toDayKey).toBe(true);
  });

  it('每 3 天：块长 3 天，且此刻落在块内', () => {
    const w = periodWindow({ freq: RepeatFreq.Daily, interval: 3 }, d(2026, 10, 6, 12, 0));
    const from = new Date(w.fromDayKey.replace(/-/g, '/'));
    const to = new Date(w.toDayKey.replace(/-/g, '/'));
    expect(Math.round((to.getTime() - from.getTime()) / 864e5)).toBe(2);
    expect(w.label).toBe('这 3 天');
  });

  it('没有重复规则按每天算；非法间隔回落到 1，不产生空块', () => {
    expect(periodWindow(null, d(2026, 10, 6)).label).toBe('今天');
    expect(periodWindow(undefined, d(2026, 10, 6)).label).toBe('今天');
    expect(periodWindow({ freq: RepeatFreq.Weekly, interval: 0 }, d(2026, 10, 6)).label).toBe('本周');
    expect(
      periodWindow({ freq: RepeatFreq.Weekly, interval: Number.NaN }, d(2026, 10, 6)).fromDayKey,
    ).toBe(key(2026, 10, 5));
  });

  it('不修改传进来的 Date', () => {
    const now = d(2026, 10, 6, 15, 30);
    const before = now.getTime();
    periodWindow(weekly, now);
    periodWindow(monthly, now);
    expect(now.getTime()).toBe(before);
  });
});

/* --------------------------- 本期次数 --------------------------- */

describe('occurrencesInPeriod：本期做了几次', () => {
  it('只数落在本期的记录', () => {
    const keys = [key(2026, 10, 4), key(2026, 10, 5), key(2026, 10, 7), key(2026, 10, 12)];
    // 本周 = 10-05 ~ 10-11 → 只有 10-05 和 10-07
    expect(occurrencesInPeriod(keys, weekly, d(2026, 10, 6))).toBe(2);
  });

  it('两端都算在内（含第一天和最后一天）', () => {
    expect(occurrencesInPeriod([key(2026, 10, 5)], weekly, d(2026, 10, 6))).toBe(1);
    expect(occurrencesInPeriod([key(2026, 10, 11)], weekly, d(2026, 10, 6))).toBe(1);
  });

  it('同一天有两条记录只算一次', () => {
    const keys = [key(2026, 10, 6), key(2026, 10, 6), key(2026, 10, 6)];
    expect(occurrencesInPeriod(keys, weekly, d(2026, 10, 6))).toBe(1);
  });

  it('传入顺序不影响结果', () => {
    const asc = [key(2026, 10, 5), key(2026, 10, 6), key(2026, 10, 7)];
    const desc = [...asc].reverse();
    const now = d(2026, 10, 8);
    expect(occurrencesInPeriod(asc, weekly, now)).toBe(occurrencesInPeriod(desc, weekly, now));
    expect(occurrencesInPeriod(asc, weekly, now)).toBe(3);
  });

  it('空记录是 0，不是 NaN', () => {
    expect(occurrencesInPeriod([], weekly, d(2026, 10, 6))).toBe(0);
  });

  it('回归：跨到下一周，本期次数必须回到 0', () => {
    // 上周（9-28 ~ 10-4）打了 3 次
    const lastWeek = [key(2026, 9, 29), key(2026, 9, 30), key(2026, 10, 1)];
    expect(occurrencesInPeriod(lastWeek, weekly, d(2026, 9, 30))).toBe(3);
    // 本周一看，应当是 0 —— 这就是以前做不到的那一步
    expect(occurrencesInPeriod(lastWeek, weekly, d(2026, 10, 5))).toBe(0);
    expect(occurrencesInPeriod(lastWeek, weekly, d(2026, 10, 11))).toBe(0);
  });

  it('回归：跨月同理（上月的记录不算进本月）', () => {
    const keys = [key(2026, 9, 28), key(2026, 9, 30)];
    expect(occurrencesInPeriod(keys, monthly, d(2026, 9, 30))).toBe(2);
    expect(occurrencesInPeriod(keys, monthly, d(2026, 10, 1))).toBe(0);
  });
});

/* ------------------------- 完成态推导 ------------------------- */

describe('desiredFrequencyStatus：完成态应该是什么', () => {
  const task = (over: Partial<{ completion: CompletionRule; targetOccurrences: number | null; status: TaskStatus }> = {}) => ({
    completion: CompletionRule.Frequency,
    targetOccurrences: 3,
    status: TaskStatus.Todo,
    ...over,
  });

  it('本期够数 → 完成', () => {
    expect(desiredFrequencyStatus(task(), 3)).toBe(TaskStatus.Done);
    expect(desiredFrequencyStatus(task(), 5)).toBe(TaskStatus.Done);
  });

  it('本期不够数却停在完成态 → 打回待办（新的一周它自己回来）', () => {
    expect(desiredFrequencyStatus(task({ status: TaskStatus.Done }), 0)).toBe(TaskStatus.Todo);
    expect(desiredFrequencyStatus(task({ status: TaskStatus.Done }), 2)).toBe(TaskStatus.Todo);
  });

  it('撤销打卡后也会被打回待办', () => {
    const done = task({ status: TaskStatus.Done });
    expect(desiredFrequencyStatus(done, 3)).toBeNull(); // 还算数，不动
    expect(desiredFrequencyStatus(done, 2)).toBe(TaskStatus.Todo); // 撤了一次，打回
  });

  it('不够数但本来就是待办 → 不干预', () => {
    expect(desiredFrequencyStatus(task(), 0)).toBeNull();
    expect(desiredFrequencyStatus(task(), 2)).toBeNull();
  });

  it('"等待中"是用户手动设的，不够数时不许踩掉', () => {
    expect(desiredFrequencyStatus(task({ status: TaskStatus.Waiting }), 0)).toBeNull();
  });

  it('没写目标次数的频率型只记次数，不下结论', () => {
    expect(desiredFrequencyStatus(task({ targetOccurrences: null }), 99)).toBeNull();
    expect(desiredFrequencyStatus(task({ targetOccurrences: 0 }), 99)).toBeNull();
  });

  it('非频率型一律不干预（勾选 / 时长型由各自规则负责）', () => {
    expect(desiredFrequencyStatus(task({ completion: CompletionRule.Check }), 99)).toBeNull();
    expect(desiredFrequencyStatus(task({ completion: CompletionRule.Duration }), 99)).toBeNull();
  });
});

describe('describePeriodProgress：进度文案', () => {
  it('有目标时报 x/y', () => {
    expect(describePeriodProgress(weekly, 3, 2, d(2026, 10, 6))).toBe('本周 2/3 次');
    expect(describePeriodProgress(monthly, 10, 0, d(2026, 10, 6))).toBe('本月 0/10 次');
  });

  it('没有目标时只报次数', () => {
    expect(describePeriodProgress(weekly, null, 4, d(2026, 10, 6))).toBe('本周 4 次');
  });
});
