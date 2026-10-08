import { nowIso, toDayKey } from '@/utils/datetime';
import { createId } from '@/utils/id';

import type { BaseEntity } from './base';
import type { Checkin } from './checkins';
import type { Container, Mark } from './container';
import { sanitizeSessions, type Course, type CourseSession, type Term } from './course';
import { ContainerStatus } from './enums';
import {
  CaptureSource,
  CompletionRule,
  MarkKind,
  Priority,
  SyncState,
  TaskKind,
  TaskStatus,
  TimeAttribute,
} from './enums';
import type { ContainerKind } from './enums';
import { EventKind, type CalEvent } from './event';
import type { FocusSession } from './focus';
import type { Idea } from './idea';
import type { RepeatRule, Task, TaskTime } from './task';
import { DEFAULT_PERIODS, sanitizePeriods, type ClassPeriod } from './timetable';

/**
 * 工厂函数：把"创建实体"这件事收敛到一处。
 *
 * 好处是默认值只有一份定义（比如新建任务默认 P2、默认 todo、默认纯本地），
 * 界面层只需要传它真正关心的字段，不必到处写 `?? 2`。
 */

export function createBase(idPrefix: string): BaseEntity {
  const at = nowIso();
  return {
    id: createId(idPrefix),
    createdAt: at,
    updatedAt: at,
    deletedAt: null,
    remoteId: null,
    syncState: SyncState.Local,
  };
}

export interface CreateTaskInput {
  title: string;
  kind?: TaskKind;
  time?: Partial<TaskTime>;
  /** 便捷写法，等价于 time.dueAt */
  dueAt?: string | null;
  note?: string | null;
  tags?: string[];
  priority?: Priority;
  containerId?: string | null;
  source?: CaptureSource;
  repeat?: RepeatRule | null;
  targetMinutes?: number | null;
  targetOccurrences?: number | null;
  completion?: CompletionRule;
  /** 提醒提前量（分钟），0 = 准点 */
  reminderMinutesBefore?: number | null;
  /** 挂到哪个父任务下（子任务）。只允许一层 */
  parentId?: string | null;
  /** 手动排序权重；不传 = 还没排过（按创建时间倒序） */
  sortOrder?: number | null;
}

export function createTask(input: CreateTaskInput): Task {
  const kind = input.kind ?? TaskKind.Execution;
  return {
    ...createBase('task'),
    title: input.title.trim(),
    note: input.note ?? null,
    kind,
    status: TaskStatus.Todo,
    time: normalizeTime(kind, input),
    repeat: input.repeat ?? null,
    completion: input.completion ?? defaultCompletion(kind, input),
    targetMinutes: input.targetMinutes ?? null,
    targetOccurrences: input.targetOccurrences ?? null,
    containerId: input.containerId ?? null,
    tags: input.tags ?? [],
    priority: input.priority ?? Priority.P2,
    waitingFor: null,
    source: input.source ?? CaptureSource.Manual,
    completedAt: null,
    reminderMinutesBefore: input.reminderMinutesBefore ?? null,
    parentId: input.parentId ?? null,
    sortOrder: input.sortOrder ?? null,
    progress: { accumulatedMinutes: 0 },
  };
}

/**
 * 子任务。
 *
 * 刻意**不继承父任务的时间/重复**：子任务是"把这件事拆开"的产物，
 * 给每个子任务自动派一份时间，等于替用户排了一遍程 —— 那是排程算法该做的事，
 * 不是创建子任务时该做的。子任务的 kind 固定为执行型（拆出来的都是要动手的事）。
 */
export function createSubtask(parentId: string, title: string): Task {
  return createTask({
    title,
    kind: TaskKind.Execution,
    parentId,
  });
}

/** 没显式给时间属性时，按"有没有时间"倒推 */
function normalizeTime(kind: TaskKind, input: CreateTaskInput): TaskTime {
  const explicit = input.time?.attribute;
  const startAt = input.time?.startAt ?? null;
  const endAt = input.time?.endAt ?? null;
  const dueAt = input.time?.dueAt ?? input.dueAt ?? null;

  let attribute = explicit;
  if (!attribute) {
    if (startAt) attribute = TimeAttribute.Fixed;
    else if (dueAt) attribute = TimeAttribute.Deadline;
    else if (kind === TaskKind.Schedule) attribute = TimeAttribute.Fixed;
    else attribute = TimeAttribute.None;
  }
  return { attribute, startAt, endAt, dueAt };
}

/** 时长 / 习惯型默认用"够时长/够频率自动完成"，其余手动勾选 */
function defaultCompletion(kind: TaskKind, input: CreateTaskInput): CompletionRule {
  if (kind === TaskKind.Habit) {
    if (input.targetOccurrences != null) return CompletionRule.Frequency;
    if (input.targetMinutes != null) return CompletionRule.Duration;
    return CompletionRule.Check;
  }
  return CompletionRule.Check;
}

export function createIdea(content: string, source: CaptureSource = CaptureSource.Manual): Idea {
  return {
    ...createBase('idea'),
    content: content.trim(),
    tags: [],
    source,
    archivedAt: null,
    breakdownTaskId: null,
  };
}

export interface CreateContainerInput {
  title: string;
  kind?: ContainerKind;
  parentId?: string | null;
  startAt?: string | null;
  endAt?: string | null;
  note?: string | null;
}

export function createContainer(input: CreateContainerInput): Container {
  return {
    ...createBase('container'),
    kind: input.kind ?? 'project',
    title: input.title.trim(),
    note: input.note ?? null,
    parentId: input.parentId ?? null,
    startAt: input.startAt ?? null,
    endAt: input.endAt ?? null,
    status: ContainerStatus.Active,
  };
}

export interface CreateMarkInput {
  title: string;
  /** 默认倒数（还剩几天） */
  kind?: MarkKind;
  /** YYYY-MM-DD */
  date: string;
  /** 每年重复：生日、纪念日这类 */
  repeatYearly?: boolean;
}

/** 纪念日（主文档 5.3 的"标记"）：独立于任务，不参与排程 */
export function createMark(input: CreateMarkInput): Mark {
  return {
    ...createBase('mark'),
    kind: input.kind ?? MarkKind.Countdown,
    title: input.title.trim(),
    date: input.date,
    repeatYearly: input.repeatYearly ?? false,
  };
}

/** 开始专注：结束前 endedAt / intent 都为空，允许"先干着，之后再命名" */
export function createFocusSession(taskId: string | null, plannedMinutes?: number | null): FocusSession {
  return {
    ...createBase('focus'),
    taskId,
    intent: null,
    note: null,
    startedAt: nowIso(),
    endedAt: null,
    plannedMinutes: plannedMinutes ?? null,
    actualSeconds: 0,
    growthSeconds: 0,
  };
}

/**
 * 打卡一条。dayKey 不传就取"今天"（本地日）。
 * 一天只应该有一条 —— 去重交给仓储（先查后插），这里不做副作用。
 */
export function createCheckin(
  taskId: string,
  day: Date = new Date(),
  minuteOfDay?: number | null,
): Checkin {
  return {
    ...createBase('checkin'),
    taskId,
    dayKey: toDayKey(day),
    minuteOfDay: minuteOfDay ?? day.getHours() * 60 + day.getMinutes(),
    note: null,
  };
}

/** 课表配色有几种（界面按这个下标取色；领域层只给下标，不碰颜色值） */
export const COURSE_COLORS = 8;

/**
 * 课程配色下标：**由课名决定**，同一门课每次都落到同一个颜色。
 * 随机取色的话，每次刷新/每次导入颜色都在换，课表就没法"看颜色认课"了。
 */
export function colorIndexOf(title: string): number {
  let hash = 0;
  for (const ch of title) hash = (hash * 31 + (ch.codePointAt(0) ?? 0)) % 997;
  return hash % COURSE_COLORS;
}

export interface CreateCourseInput {
  title: string;
  teacher?: string | null;
  location?: string | null;
  note?: string | null;
  sessions?: CourseSession[];
  reminderMinutesBefore?: number | null;
  colorIndex?: number;
}

/**
 * 新课默认提前 15 分钟提醒。
 *
 * **为什么给非零默认值**：用户把课表导进来，图的就是"别错过课"。
 * 默认不提醒等于把"要不要提醒"这个决定又推回给他 —— 而他得先知道
 * 有这么一个开关存在，才可能去开。15 分钟够从宿舍走到教室，也不至于太早。
 * 不想要的人在课程详情页关掉即可。
 */
export const DEFAULT_COURSE_REMINDER = 15;

export function createCourse(input: CreateCourseInput): Course {
  const title = input.title.trim();
  return {
    ...createBase('course'),
    title,
    teacher: input.teacher ?? null,
    location: input.location ?? null,
    note: input.note ?? null,
    colorIndex: input.colorIndex ?? colorIndexOf(title),
    sessions: sanitizeSessions(input.sessions ?? []),
    reminderMinutesBefore: input.reminderMinutesBefore ?? DEFAULT_COURSE_REMINDER,
  };
}

export interface CreateTermInput {
  /** '2026-2027-1' 这类学期名 */
  label: string;
  /** 'YYYY-MM-DD'，**必须是第 1 周的周一** */
  startDayKey: string;
  totalWeeks?: number;
  periods?: readonly ClassPeriod[];
}

export function createTerm(input: CreateTermInput): Term {
  const periods = input.periods ? [...input.periods] : [...DEFAULT_PERIODS];
  return {
    ...createBase('term'),
    label: input.label.trim(),
    startDayKey: input.startDayKey,
    totalWeeks: input.totalWeeks ?? 18,
    periods: sanitizePeriods(periods).length ? sanitizePeriods(periods) : [...DEFAULT_PERIODS],
  };
}

export interface CreateEventInput {
  kind?: string;
  title: string;
  location?: string | null;
  note?: string | null;
  startAt: string;
  endAt?: string | null;
  source?: string;
}

/**
 * 固定日程（考试等）：没有完成态，也**没有提前量字段** ——
 * 什么时候提醒由 `domain/event-reminder.ts` 按固定日程的规则算（前一天 20:00，
 * 排不上退开考前 1 小时）。考试不该像任务那样让用户先挑一个提前量。
 */
export function createEvent(input: CreateEventInput): CalEvent {
  return {
    ...createBase('event'),
    kind: input.kind ?? EventKind.Exam,
    title: input.title.trim(),
    location: input.location ?? null,
    note: input.note ?? null,
    startAt: input.startAt,
    endAt: input.endAt ?? null,
    source: input.source ?? CaptureSource.Manual,
  };
}
