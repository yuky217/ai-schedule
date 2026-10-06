import { nowIso, toDayKey } from '@/utils/datetime';
import { createId } from '@/utils/id';

import type { BaseEntity } from './base';
import type { Checkin } from './checkins';
import type { Container, Mark } from './container';
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
import type { FocusSession } from './focus';
import type { Idea } from './idea';
import type { RepeatRule, Task, TaskTime } from './task';

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
    progress: { accumulatedMinutes: 0, occurrencesThisPeriod: 0 },
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
