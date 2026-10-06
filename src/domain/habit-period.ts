import { addDays, startOfDay } from 'date-fns';

import { toDayKey } from '@/utils/datetime';

import { CompletionRule, RepeatFreq, TaskStatus } from './enums';
import type { RepeatRule, Task } from './task';

/**
 * 「本期」到底指哪一段时间 —— 频率型任务（"每周跑 3 次"）的唯一口径。
 *
 * 为什么需要这个文件（这是修掉一个真 bug 的地方）：
 * 此前 task.progress 里存了一个 `occurrencesThisPeriod` 计数器，但**没有任何地方
 * 定义过"本期"从哪天开始、也没有任何地方做重置**。三处代码各自 +1、各指一种意思
 * （打卡 +1、重复任务滚动 +1、专注 +1），而读取方当它是"本期做了几次"——
 * 于是"每周 3 次"一旦达标就**永远停在已完成**，下一周做完也不会回来。
 *
 * 修法的原则：**别存会漂移的计数，存事实（打卡记录），计数现算。**
 * 打卡记录里有 `dayKey`，把时间轴切成等长的块，数一数落在本块里的记录有几条，
 * 就是这个答案。不需要定时任务、不会漂移、撤销打卡后立刻正确。
 *
 * 三个单位共用同一个公式：**把时间轴按 interval 切成等长的块，本期 = 含此刻的那一块**。
 * - daily：以 1970-01-01 起算的日块（interval=1 就是"今天"）
 * - weekly：以 1970-01-05（周一）起算的周块 → 块边界永远落在周一
 * - monthly：以 1970 年 1 月起算的月块
 * 块的分界与公历对齐（周一 / 每月 1 号），所以"本周""本月"符合人的直觉；
 * interval > 1 时按同样的边界往后并成一块（"每 2 周"是相邻两周并起来，不是滚动窗口）。
 */

/** 日块的纪元锚点 */
const EPOCH_DAY = new Date(1970, 0, 1);
/** 周块的纪元锚点：1970-01-05 是周一 */
const EPOCH_MONDAY = new Date(1970, 0, 5);
/** 月块的纪元锚点：1970 年 1 月 */
const EPOCH_YEAR = 1970;
const EPOCH_MONTH = 0;

const MS_PER_DAY = 864e5;

export interface PeriodWindow {
  /** 本期第一天，'YYYY-MM-DD'（本地日） */
  fromDayKey: string;
  /** 本期最后一天，'YYYY-MM-DD' */
  toDayKey: string;
  /** 人类可读，如 "今天" / "本周" / "近 2 周" */
  label: string;
}

/** 容错：非法或 <1 的间隔一律当 1 处理，绝不返回空块 */
function safeInterval(value: number | undefined): number {
  if (value == null || !Number.isFinite(value) || value < 1) return 1;
  return Math.floor(value);
}

/** 本地零点到纪元零点之间隔了几天（含跨时区安全：都先归零） */
function dayIndex(date: Date): number {
  const a = startOfDay(date);
  const b = EPOCH_DAY;
  return Math.round(
    (Date.UTC(a.getFullYear(), a.getMonth(), a.getDate()) -
      Date.UTC(b.getFullYear(), b.getMonth(), b.getDate())) /
      MS_PER_DAY,
  );
}

/**
 * 算出 `now` 落在哪一块。`rule` 为空时按"每天"处理 ——
 * 一个频率型任务忘了填重复规则，也应该有个说得通的本期。
 */
export function periodWindow(
  rule: RepeatRule | null | undefined,
  now: Date = new Date(),
): PeriodWindow {
  const interval = safeInterval(rule?.interval);
  const freq = rule?.freq ?? RepeatFreq.Daily;

  if (freq === RepeatFreq.Weekly) {
    // 先把 now 归到所在周的周一，再按 interval 合并成块
    const day = startOfDay(now);
    const monday = addDays(day, -((day.getDay() + 6) % 7));
    const weekIndex = Math.round((monday.getTime() - EPOCH_MONDAY.getTime()) / (7 * MS_PER_DAY));
    const block = Math.floor(weekIndex / interval);
    const from = addDays(EPOCH_MONDAY, block * interval * 7);
    const to = addDays(from, interval * 7 - 1);
    return {
      fromDayKey: toDayKey(from),
      toDayKey: toDayKey(to),
      label: interval > 1 ? `这 ${interval} 周` : '本周',
    };
  }

  if (freq === RepeatFreq.Monthly) {
    const monthIndex =
      (now.getFullYear() - EPOCH_YEAR) * 12 + (now.getMonth() - EPOCH_MONTH);
    const block = Math.floor(monthIndex / interval);
    const from = new Date(EPOCH_YEAR, EPOCH_MONTH + block * interval, 1);
    // 下个月的第 0 天 = 本块的最后一个日历日（自动处理 28/29/30/31）
    const to = new Date(EPOCH_YEAR, EPOCH_MONTH + (block + 1) * interval, 0);
    return {
      fromDayKey: toDayKey(startOfDay(from)),
      toDayKey: toDayKey(startOfDay(to)),
      label: interval > 1 ? `这 ${interval} 个月` : '本月',
    };
  }

  // daily
  const index = dayIndex(now);
  const block = Math.floor(index / interval);
  const from = addDays(EPOCH_DAY, block * interval);
  const to = addDays(from, interval - 1);
  return {
    fromDayKey: toDayKey(startOfDay(from)),
    toDayKey: toDayKey(startOfDay(to)),
    label: interval > 1 ? `这 ${interval} 天` : '今天',
  };
}

/**
 * 本期做了几次。
 *
 * 按**天**去重：同一天打两次卡只算一次（"每周跑 3 次"是 3 天，不是 3 次点击）。
 * 打卡表本身也是按天幂等的，这里再去重一次是为了防住历史数据里的重复行。
 * 'YYYY-MM-DD' 的字典序就是时间序，所以直接比字符串。
 */
export function occurrencesInPeriod(
  dayKeys: ReadonlyArray<string>,
  rule: RepeatRule | null | undefined,
  now: Date = new Date(),
): number {
  const { fromDayKey, toDayKey: to } = periodWindow(rule, now);
  const seen = new Set<string>();
  let count = 0;
  for (const key of dayKeys) {
    if (key < fromDayKey || key > to) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    count += 1;
  }
  return count;
}

/**
 * 这一条任务的完成态**应该**是什么样。返回 null = 不干预。
 *
 * 频率型是唯一"状态可以由事实推导"的类型：目标次数是用户自己写的，
 * 数够没数够不用问人。所以：
 * - 本期够数 → 应当完成（哪怕之前是"等别人"）
 * - 本期不够数、却停在完成态 → 打回待办（**这就是"新的一周它自己回来了"**）
 * - 其他情况一律不干预：待办就是待办，"等待中"是用户手动设的、别踩掉
 *
 * 反向也成立且必要：达标后用户撤销了打卡，下一次对账会把它打回待办。
 */
export function desiredFrequencyStatus(
  task: Pick<Task, 'completion' | 'targetOccurrences' | 'status'>,
  countInPeriod: number,
): TaskStatus | null {
  if (task.completion !== CompletionRule.Frequency) return null;

  const target = task.targetOccurrences ?? null;
  // 没写目标次数的频率型：只记次数，不下结论
  if (target == null || target <= 0) return null;

  if (countInPeriod >= target) {
    return task.status === TaskStatus.Done ? null : TaskStatus.Done;
  }
  return task.status === TaskStatus.Done ? TaskStatus.Todo : null;
}

/** "本周 2/3 次" —— 进度文案，界面直接用 */
export function describePeriodProgress(
  rule: RepeatRule | null | undefined,
  target: number | null | undefined,
  countInPeriod: number,
  now: Date = new Date(),
): string {
  const { label } = periodWindow(rule, now);
  if (target == null || target <= 0) return `${label} ${countInPeriod} 次`;
  return `${label} ${countInPeriod}/${target} 次`;
}

/** "本周跑了 2/3 次" 这类完整句子的尾巴，用于打卡后的反馈 */
export function describePeriodReached(
  rule: RepeatRule | null | undefined,
  target: number | null | undefined,
  countInPeriod: number,
  now: Date = new Date(),
): string {
  const { label } = periodWindow(rule, now);
  if (target == null || target <= 0) return `${label}第 ${countInPeriod} 次`;
  if (countInPeriod >= target) return `${label} ${countInPeriod}/${target} 次，达到目标`;
  return `${label} ${countInPeriod}/${target} 次`;
}
