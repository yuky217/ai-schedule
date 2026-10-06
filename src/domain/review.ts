import {
  addDays,
  differenceInCalendarDays,
  endOfDay,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from 'date-fns';

import { formatMonthDay, parseDayKey, toDayKey } from '@/utils/datetime';

import { summarizeCheckins, type Checkin, type StreakInfo } from './checkins';
import { TaskKind, TaskStatus } from './enums';
import type { FocusSession } from './focus';
import type { Task } from './task';

/**
 * 「回」——回顾与复盘（主流程 记 → 分 → 落 → 行 → 完 → **回**）。
 *
 * 为什么这块必须补上：
 * 打卡、专注时长、完成记录都只进不出的话，用户攒了一堆数据却看不到任何反馈，
 * 那这些数据就只是负担。回顾页的职责就是把它们翻译成"你最近到底干了什么"。
 *
 * 几条口径上的取舍，写在这里免得以后反复纠结：
 *
 * 1. **完成率的分母是"本期该做的"，不是"全部未完成的"。**
 *    拿全部积压任务当分母，完成率永远是 3%，那不是反馈，那是羞辱。
 *    所以分母只取焦点日期落在本期内的任务（见 taskFocusDate）。
 *
 * 2. **本期完成数按 completedAt 算，可以打穿本期边界。**
 *    上周该做、这周才做完的事，就是这周的功劳 —— 否则"提前做完"反而拉低完成率。
 *
 * 3. **连续天数是全局概念，不被本期范围截断。**
 *    "连续 30 天"哪怕本期只覆盖 7 天也还是 30 天，截断就把最有价值的信息砍没了。
 *
 * 4. **子任务不计入。** 父任务会随子任务全完成而自动完成，
 *    两个都算就是同一件事记两次。
 *
 * 5. **没结束、没投入的专注会话不算一次。** actualSeconds = 0 的是"点进去又走了"，
 *    记进去只会让次数虚高。
 *
 * 纯函数，零依赖（除 date-fns），全部可单测。
 */

export type ReviewPreset = 'week' | 'month' | 'last7' | 'last30';

export interface ReviewRange {
  preset: ReviewPreset;
  /** 短名，如"本周" */
  label: string;
  /** 起点：当天 00:00 */
  from: Date;
  /** 终点：当天 23:59:59.999（含今天）*/
  to: Date;
  /** 覆盖的自然日数，>= 1 */
  days: number;
}

export const REVIEW_PRESETS: ReadonlyArray<{ key: ReviewPreset; label: string }> = [
  { key: 'week', label: '本周' },
  { key: 'month', label: '本月' },
  { key: 'last7', label: '近 7 天' },
  { key: 'last30', label: '近 30 天' },
];

/**
 * 把预设解析成具体日期区间。
 *
 * 「本周」「本月」都**截到今天为止**，而不是铺满整周/整月 ——
 * 否则周三打开时，"本周完成 5 件"会被算成"7 天里完成了 5 件"，
 * 完成率立刻被未来那几天稀释，看着像自己很懒。
 */
export function resolveRange(preset: ReviewPreset, today: Date = new Date()): ReviewRange {
  const day = startOfDay(today);

  let from: Date;
  switch (preset) {
    case 'week':
      from = startOfWeek(day, { weekStartsOn: 1 });
      break;
    case 'month':
      from = startOfMonth(day);
      break;
    case 'last7':
      from = addDays(day, -6);
      break;
    case 'last30':
      from = addDays(day, -29);
      break;
  }

  const days = Math.max(1, differenceInCalendarDays(day, from) + 1);
  const label = REVIEW_PRESETS.find((p) => p.key === preset)?.label ?? '';

  return { preset, label, from, to: endOfDay(day), days };
}

/** 上一个等长周期：用于"比上期多/少了多少" */
export function previousRange(range: ReviewRange): ReviewRange {
  const to = endOfDay(addDays(range.from, -1));
  const from = startOfDay(addDays(to, -(range.days - 1)));
  return { ...range, from, to };
}

/** "10月1日 - 10月6日 · 共 6 天" */
export function describeRange(range: ReviewRange): string {
  const from = formatMonthDay(range.from);
  const to = formatMonthDay(range.to);
  return `${from === to ? from : `${from} - ${to}`} · 共 ${range.days} 天`;
}

export function inRange(date: Date, range: ReviewRange): boolean {
  const t = date.getTime();
  return t >= range.from.getTime() && t <= range.to.getTime();
}

/**
 * 铺满 N 天热力图所需的最少列数（列 = 周）。
 *
 * 热力图是"从今天往回填"的，今天落在哪一行取决于星期几，
 * 所以需要的列数不是简单的 ceil(days / 7) —— 少算一列，
 * 最早那几天会被挤出网格边界直接消失。这里按最坏情况补一列。
 */
export function heatmapWeeks(days: number): number {
  return Math.max(1, Math.ceil(Math.max(0, days - 1) / 7) + 1);
}

/**
 * 任务"属于哪一天"。
 *
 * 优先开始时间（日程型就是那天要开会），其次截止时间（执行型常有 ddl），
 * 都没有才回落到创建时间 —— 无时间的任务至少在"记下来的那天"算数，
 * 否则它永远不会出现在任何一期的回顾里。
 */
export function taskFocusDate(task: Task): Date {
  const iso = task.time.startAt ?? task.time.dueAt ?? task.createdAt;
  const d = new Date(iso);
  if (!Number.isNaN(d.getTime())) return d;
  const fallback = new Date(task.createdAt);
  return Number.isNaN(fallback.getTime()) ? new Date() : fallback;
}

/* ------------------------------------------------------------------ */
/* 任务                                                                */
/* ------------------------------------------------------------------ */

export interface KindBreakdown {
  kind: TaskKind;
  planned: number;
  done: number;
}

/** containerId 为 null 表示没归到任何容器 */
export interface ContainerBreakdown {
  containerId: string | null;
  planned: number;
  done: number;
}

export interface TaskReview {
  /** 本期该做的（焦点日期落在本期，排除想法型与子任务）*/
  planned: number;
  /** 上面这些里已完成的 */
  done: number;
  /** done / planned；planned = 0 时为 null（没有可比的分母）*/
  rate: number | null;
  /** 本期真正完成的（按 completedAt 算，含提前做完的）*/
  completedInRange: number;
  /** 本期该做、但时间已过且没完成的 */
  overdue: number;
  byKind: KindBreakdown[];
  byContainer: ContainerBreakdown[];
}

/** 想法型与子任务不参与统计，理由见文件头 */
function countableTasks(tasks: readonly Task[]): Task[] {
  return tasks.filter((task) => task.kind !== TaskKind.Idea && !task.parentId);
}

/** 类型分组的固定展示顺序。让 ties 的先后由类型决定，而不是由数据插入顺序决定 */
const KIND_ORDER: Record<TaskKind, number> = {
  execution: 0,
  schedule: 1,
  habit: 2,
  idea: 3,
};

export function summarizeTasks(
  tasks: readonly Task[],
  range: ReviewRange,
  today: Date = new Date(),
): TaskReview {
  const real = countableTasks(tasks);
  const planned = real.filter((task) => inRange(taskFocusDate(task), range));
  const doneTasks = planned.filter((task) => task.status === TaskStatus.Done);

  const completedInRange = real.filter((task) => {
    if (!task.completedAt) return false;
    const d = new Date(task.completedAt);
    return !Number.isNaN(d.getTime()) && inRange(d, range);
  }).length;

  const todayStart = startOfDay(today).getTime();
  const overdue = planned.filter(
    (task) => task.status !== TaskStatus.Done && taskFocusDate(task).getTime() < todayStart,
  ).length;

  const kindMap = new Map<TaskKind, KindBreakdown>();
  for (const task of planned) {
    const bucket = kindMap.get(task.kind) ?? { kind: task.kind, planned: 0, done: 0 };
    bucket.planned += 1;
    if (task.status === TaskStatus.Done) bucket.done += 1;
    kindMap.set(task.kind, bucket);
  }

  const containerMap = new Map<string | null, ContainerBreakdown>();
  for (const task of planned) {
    const key = task.containerId ?? null;
    const bucket = containerMap.get(key) ?? { containerId: key, planned: 0, done: 0 };
    bucket.planned += 1;
    if (task.status === TaskStatus.Done) bucket.done += 1;
    containerMap.set(key, bucket);
  }

  return {
    planned: planned.length,
    done: doneTasks.length,
    rate: planned.length ? doneTasks.length / planned.length : null,
    completedInRange,
    overdue,
    // 排序全部走到确定的比较键上：数量降序 → 固定次序。
    // 否则 planned 相同的两行谁在前取决于数据读出来的顺序，界面会莫名跳动。
    byKind: [...kindMap.values()].sort(
      (a, b) => b.planned - a.planned || KIND_ORDER[a.kind] - KIND_ORDER[b.kind],
    ),
    byContainer: [...containerMap.values()].sort(
      (a, b) =>
        b.planned - a.planned ||
        b.done - a.done ||
        // null（未归类）固定排在最后，其余按 id 稳定排序
        (a.containerId === null ? 1 : 0) - (b.containerId === null ? 1 : 0) ||
        (a.containerId ?? '').localeCompare(b.containerId ?? ''),
    ),
  };
}

/* ------------------------------------------------------------------ */
/* 专注                                                                */
/* ------------------------------------------------------------------ */

export interface FocusDay {
  dayKey: string;
  date: Date;
  seconds: number;
  /** 0 = 周一 … 6 = 周日 */
  weekday: number;
  isToday: boolean;
}

export interface FocusReview {
  /** 有实际投入的会话数 */
  sessions: number;
  totalSeconds: number;
  /** 有专注的自然日数 */
  activeDays: number;
  /** 单日最长秒数 */
  bestDaySeconds: number;
  /** 按日期铺满整个区间，没专注的日子是 0 —— 柱状图需要连续的时间轴 */
  byDay: FocusDay[];
}

/**
 * 专注汇总。
 *
 * 传入的 sessions 需要**同时覆盖本期与上一期**（见 buildReview），
 * 这样一次查询就能算出环比，不用来回查库。
 */
export function summarizeFocus(
  sessions: readonly FocusSession[],
  range: ReviewRange,
  today: Date = new Date(),
): FocusReview {
  const secondsByDay = new Map<string, number>();
  let sessionsCount = 0;
  let totalSeconds = 0;

  for (const session of sessions) {
    const started = new Date(session.startedAt);
    if (Number.isNaN(started.getTime()) || !inRange(started, range)) continue;
    // 点进去又走了的会话不记账，否则"共 12 次"里一半是空的
    const seconds = Math.max(0, Math.floor(session.actualSeconds));
    if (seconds <= 0) continue;

    sessionsCount += 1;
    totalSeconds += seconds;
    const key = toDayKey(started);
    secondsByDay.set(key, (secondsByDay.get(key) ?? 0) + seconds);
  }

  const todayKey = toDayKey(startOfDay(today));
  const byDay: FocusDay[] = Array.from({ length: range.days }, (_, i) => {
    const date = addDays(range.from, i);
    const dayKey = toDayKey(date);
    return {
      dayKey,
      date,
      seconds: secondsByDay.get(dayKey) ?? 0,
      weekday: (date.getDay() + 6) % 7,
      isToday: dayKey === todayKey,
    };
  });

  return {
    sessions: sessionsCount,
    totalSeconds,
    activeDays: secondsByDay.size,
    bestDaySeconds: byDay.reduce((max, day) => (day.seconds > max ? day.seconds : max), 0),
    byDay,
  };
}

/* ------------------------------------------------------------------ */
/* 环比                                                                */
/* ------------------------------------------------------------------ */

export interface Delta {
  current: number;
  previous: number;
  /** 变化比例；previous = 0 时无从比较，返回 null */
  ratio: number | null;
}

export function delta(current: number, previous: number): Delta {
  return { current, previous, ratio: previous > 0 ? (current - previous) / previous : null };
}

/** "比上期 +40%" / "比上期 -12%" / "和上期持平"；上期没数据时返回空串（无从比较） */
export function describeDelta(d: Delta): string {
  if (d.ratio === null) return '';
  const percent = Math.round(d.ratio * 100);
  if (percent === 0) return '和上期持平';
  return `比上期 ${percent > 0 ? '+' : ''}${percent}%`;
}

/* ------------------------------------------------------------------ */
/* 习惯                                                                */
/* ------------------------------------------------------------------ */

export interface HabitReview {
  taskId: string;
  title: string;
  /** 本期打卡次数 */
  inRange: number;
  /** 本期覆盖率 0..1 = inRange / 本期天数 */
  coverage: number;
  /** 全局连续天数，不受本期范围截断 */
  streak: StreakInfo;
  /** 全部打卡日（升序），供热力图使用 */
  dayKeys: string[];
}

export function reviewHabits(
  habits: readonly Task[],
  checkins: readonly Checkin[],
  range: ReviewRange,
  today: Date = new Date(),
): HabitReview[] {
  const keysByTask = new Map<string, string[]>();
  for (const record of checkins) {
    const bucket = keysByTask.get(record.taskId);
    if (bucket) bucket.push(record.dayKey);
    else keysByTask.set(record.taskId, [record.dayKey]);
  }

  return habits.map((habit) => {
    const dayKeys = (keysByTask.get(habit.id) ?? []).slice().sort();
    const inRangeCount = dayKeys.filter((key) => {
      const date = parseDayKey(key);
      return date ? inRange(date, range) : false;
    }).length;

    return {
      taskId: habit.id,
      title: habit.title,
      inRange: inRangeCount,
      coverage: range.days ? inRangeCount / range.days : 0,
      streak: summarizeCheckins(dayKeys, today),
      dayKeys,
    };
  });
}

/* ------------------------------------------------------------------ */
/* 汇总                                                                */
/* ------------------------------------------------------------------ */

export interface ReviewSnapshot {
  range: ReviewRange;
  previous: ReviewRange;
  tasks: TaskReview;
  focus: FocusReview;
  habits: HabitReview[];
  /** 专注时长环比 */
  focusDelta: Delta;
  /** 完成件数环比 */
  doneDelta: Delta;
  /** 本期打卡总次数 */
  checkinCount: number;
}

export function buildReview(input: {
  tasks: readonly Task[];
  /** 需要**同时覆盖本期与上一期** */
  sessions: readonly FocusSession[];
  checkins: readonly Checkin[];
  habits: readonly Task[];
  range: ReviewRange;
  today?: Date;
}): ReviewSnapshot {
  const { tasks, sessions, checkins, habits, range } = input;
  const today = input.today ?? new Date();
  const previous = previousRange(range);

  const taskReview = summarizeTasks(tasks, range, today);
  const focusReview = summarizeFocus(sessions, range, today);
  const previousFocus = summarizeFocus(sessions, previous, today);
  const previousTasks = summarizeTasks(tasks, previous, today);

  const habitReviews = reviewHabits(habits, checkins, range, today);

  return {
    range,
    previous,
    tasks: taskReview,
    focus: focusReview,
    habits: habitReviews,
    focusDelta: delta(focusReview.totalSeconds, previousFocus.totalSeconds),
    doneDelta: delta(taskReview.completedInRange, previousTasks.completedInRange),
    checkinCount: habitReviews.reduce((sum, habit) => sum + habit.inRange, 0),
  };
}

/** "4 小时 20 分" / "45 分钟" / "不到 1 分钟" / "—" */
export function describeFocusDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  if (total <= 0) return '—';
  if (total < 60) return '不到 1 分钟';

  const minutes = Math.floor(total / 60);
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;

  if (hours <= 0) return `${minutes} 分钟`;
  if (restMinutes === 0) return `${hours} 小时`;
  return `${hours} 小时 ${restMinutes} 分`;
}

/** "完成率 62%" */
export function describeRate(rate: number | null): string {
  if (rate === null) return '本期没有安排';
  return `完成率 ${Math.round(rate * 100)}%`;
}

/**
 * 给回顾页顶部的一句小结。
 *
 * 刻意只报"做到了什么"，不报"没做到什么"：
 * 这是一个推动执行的产品，回顾的作用是让人愿意继续，不是做绩效面谈。
 */
export function describeSummary(snapshot: ReviewSnapshot): string[] {
  const { tasks, focus, checkinCount, range } = snapshot;
  const lines: string[] = [];

  const doneLine =
    tasks.completedInRange > 0
      ? `${range.label}完成了 ${tasks.completedInRange} 件`
      : tasks.planned > 0
        ? `${range.label}安排了 ${tasks.planned} 件，还没有完成的`
        : `${range.label}还没有安排任务`;
  const doneExtra = describeDelta(snapshot.doneDelta);
  lines.push(doneExtra ? `${doneLine}，${doneExtra}` : doneLine);

  if (focus.sessions > 0) {
    const focusLine = `专注 ${describeFocusDuration(focus.totalSeconds)}，共 ${focus.sessions} 次`;
    const focusExtra = describeDelta(snapshot.focusDelta);
    lines.push(focusExtra ? `${focusLine}，${focusExtra}` : focusLine);
  } else {
    lines.push('这段时间还没有专注记录');
  }

  if (checkinCount > 0) {
    const best = snapshot.habits.reduce(
      (max, habit) => (habit.streak.longest > max ? habit.streak.longest : max),
      0,
    );
    lines.push(
      best > 0 ? `打卡 ${checkinCount} 次，最长连续 ${best} 天` : `打卡 ${checkinCount} 次`,
    );
  }

  return lines;
}
