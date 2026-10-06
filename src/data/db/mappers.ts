import type { SQLiteBindValue } from 'expo-sqlite';

import type { BaseEntity } from '@/domain/base';
import type { Checkin } from '@/domain/checkins';
import type { Container, Mark as MarkEntity, TaskChain } from '@/domain/container';
import type { CaptureSource, Priority, SyncState } from '@/domain/enums';
import type { FocusSession } from '@/domain/focus';
import type { Idea } from '@/domain/idea';
import type { RepeatRule, Task, TaskProgress, TaskTime } from '@/domain/task';

import type { ColumnMap } from './sql';

/**
 * 行 ←→ 领域对象 的映射层。
 *
 * 只有这一个文件知道"数据库列名长什么样"。
 * 领域层用嵌套对象（time / progress / tags），数据库用扁平列 + JSON 列，
 * 两边解耦，将来换存储（比如换到 WatermelonDB 或云端）只改这里。
 */

const parseJson = <T>(raw: string | null | undefined, fallback: T): T => {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

function readBase(row: BaseRow): BaseEntity {
  return {
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at ?? null,
    remoteId: row.remote_id ?? null,
    syncState: row.sync_state as SyncState,
  };
}

function writeBase(entity: BaseEntity): Record<string, SQLiteBindValue> {
  return {
    created_at: entity.createdAt,
    updated_at: entity.updatedAt,
    deleted_at: entity.deletedAt ?? null,
    remote_id: entity.remoteId ?? null,
    sync_state: entity.syncState,
  };
}

interface BaseRow {
  id: string;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
  remote_id?: string | null;
  sync_state: string;
}

/* ------------------------------------------------------------------ */
/* Task                                                               */
/* ------------------------------------------------------------------ */

export interface TaskRow extends BaseRow {
  title: string;
  note: string | null;
  kind: string;
  status: string;
  time_attribute: string;
  start_at: string | null;
  end_at: string | null;
  due_at: string | null;
  repeat_json: string | null;
  completion: string;
  target_minutes: number | null;
  target_occurrences: number | null;
  container_id: string | null;
  tags_json: string;
  priority: number;
  waiting_for: string | null;
  source: string;
  completed_at: string | null;
  reminder_minutes_before: number | null;
  parent_task_id: string | null;
  sort_order: number | null;
  progress_json: string;
}

export function taskFromRow(row: TaskRow): Task {
  const time: TaskTime = {
    attribute: row.time_attribute as TaskTime['attribute'],
    startAt: row.start_at,
    endAt: row.end_at,
    dueAt: row.due_at,
  };
  return {
    ...readBase(row),
    title: row.title,
    note: row.note,
    kind: row.kind as Task['kind'],
    status: row.status as Task['status'],
    time,
    repeat: parseJson<RepeatRule | null>(row.repeat_json, null),
    completion: row.completion as Task['completion'],
    targetMinutes: row.target_minutes,
    targetOccurrences: row.target_occurrences,
    containerId: row.container_id,
    tags: parseJson<string[]>(row.tags_json, []),
    priority: row.priority as Priority,
    waitingFor: row.waiting_for,
    source: row.source as CaptureSource,
    completedAt: row.completed_at,
    reminderMinutesBefore: row.reminder_minutes_before,
    parentId: row.parent_task_id ?? null,
    sortOrder: row.sort_order ?? null,
    progress: parseJson<TaskProgress>(row.progress_json, {
      accumulatedMinutes: 0,
      occurrencesThisPeriod: 0,
    }),
  };
}

export function taskColumns(task: Task): ColumnMap {
  return {
    id: task.id,
    title: task.title,
    note: task.note ?? null,
    kind: task.kind,
    status: task.status,
    time_attribute: task.time.attribute,
    start_at: task.time.startAt ?? null,
    end_at: task.time.endAt ?? null,
    due_at: task.time.dueAt ?? null,
    repeat_json: task.repeat ? JSON.stringify(task.repeat) : null,
    completion: task.completion,
    target_minutes: task.targetMinutes ?? null,
    target_occurrences: task.targetOccurrences ?? null,
    container_id: task.containerId ?? null,
    tags_json: JSON.stringify(task.tags ?? []),
    priority: task.priority,
    waiting_for: task.waitingFor ?? null,
    source: task.source,
    completed_at: task.completedAt ?? null,
    reminder_minutes_before: task.reminderMinutesBefore ?? null,
    parent_task_id: task.parentId ?? null,
    sort_order: task.sortOrder ?? null,
    progress_json: JSON.stringify(task.progress),
    ...writeBase(task),
  };
}

/* ------------------------------------------------------------------ */
/* Idea                                                               */
/* ------------------------------------------------------------------ */

export interface IdeaRow extends BaseRow {
  content: string;
  tags_json: string;
  source: string;
  archived_at: string | null;
}

export function ideaFromRow(row: IdeaRow): Idea {
  return {
    ...readBase(row),
    content: row.content,
    tags: parseJson<string[]>(row.tags_json, []),
    source: row.source as CaptureSource,
    archivedAt: row.archived_at,
  };
}

export function ideaColumns(idea: Idea): ColumnMap {
  return {
    id: idea.id,
    content: idea.content,
    tags_json: JSON.stringify(idea.tags ?? []),
    source: idea.source,
    archived_at: idea.archivedAt ?? null,
    ...writeBase(idea),
  };
}

/* ------------------------------------------------------------------ */
/* Container / Chain / Mark                                           */
/* ------------------------------------------------------------------ */

export interface ContainerRow extends BaseRow {
  kind: string;
  title: string;
  note: string | null;
  parent_id: string | null;
  start_at: string | null;
  end_at: string | null;
  status: string;
}

export function containerFromRow(row: ContainerRow): Container {
  return {
    ...readBase(row),
    kind: row.kind as Container['kind'],
    title: row.title,
    note: row.note,
    parentId: row.parent_id,
    startAt: row.start_at,
    endAt: row.end_at,
    status: row.status as Container['status'],
  };
}

export function containerColumns(container: Container): ColumnMap {
  return {
    id: container.id,
    kind: container.kind,
    title: container.title,
    note: container.note ?? null,
    parent_id: container.parentId ?? null,
    start_at: container.startAt ?? null,
    end_at: container.endAt ?? null,
    status: container.status,
    ...writeBase(container),
  };
}

export interface ChainRow extends BaseRow {
  kind: string;
  title: string;
  steps_json: string;
}

export function chainFromRow(row: ChainRow): TaskChain {
  return {
    ...readBase(row),
    kind: row.kind as TaskChain['kind'],
    title: row.title,
    steps: parseJson(row.steps_json, []),
  };
}

export function chainColumns(chain: TaskChain): ColumnMap {
  return {
    id: chain.id,
    kind: chain.kind,
    title: chain.title,
    steps_json: JSON.stringify(chain.steps ?? []),
    ...writeBase(chain),
  };
}

export interface MarkRow extends BaseRow {
  kind: string;
  title: string;
  date: string;
  repeat_yearly: number;
}

export function markFromRow(row: MarkRow): MarkEntity {
  return {
    ...readBase(row),
    kind: row.kind as MarkEntity['kind'],
    title: row.title,
    date: row.date,
    repeatYearly: row.repeat_yearly === 1,
  };
}

export function markColumns(mark: MarkEntity): ColumnMap {
  return {
    id: mark.id,
    kind: mark.kind,
    title: mark.title,
    date: mark.date,
    repeat_yearly: mark.repeatYearly ? 1 : 0,
    ...writeBase(mark),
  };
}

/* ------------------------------------------------------------------ */
/* FocusSession                                                       */
/* ------------------------------------------------------------------ */

export interface FocusRow extends BaseRow {
  task_id: string | null;
  intent: string | null;
  note: string | null;
  started_at: string;
  ended_at: string | null;
  planned_minutes: number | null;
  actual_seconds: number;
  growth_seconds: number;
}

export function focusFromRow(row: FocusRow): FocusSession {
  return {
    ...readBase(row),
    taskId: row.task_id,
    intent: row.intent,
    note: row.note,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    plannedMinutes: row.planned_minutes,
    actualSeconds: row.actual_seconds,
    growthSeconds: row.growth_seconds,
  };
}

export function focusColumns(session: FocusSession): ColumnMap {
  return {
    id: session.id,
    task_id: session.taskId ?? null,
    intent: session.intent ?? null,
    note: session.note ?? null,
    started_at: session.startedAt,
    ended_at: session.endedAt ?? null,
    planned_minutes: session.plannedMinutes ?? null,
    actual_seconds: session.actualSeconds,
    growth_seconds: session.growthSeconds,
    ...writeBase(session),
  };
}

/* ------------------------------------------------------------------ */
/* Checkin                                                            */
/* ------------------------------------------------------------------ */

export interface CheckinRow extends BaseRow {
  task_id: string;
  day_key: string;
  minute_of_day: number | null;
  note: string | null;
}

export function checkinFromRow(row: CheckinRow): Checkin {
  return {
    ...readBase(row),
    taskId: row.task_id,
    dayKey: row.day_key,
    minuteOfDay: row.minute_of_day,
    note: row.note,
  };
}

export function checkinColumns(checkin: Checkin): ColumnMap {
  return {
    id: checkin.id,
    task_id: checkin.taskId,
    day_key: checkin.dayKey,
    minute_of_day: checkin.minuteOfDay ?? null,
    note: checkin.note ?? null,
    ...writeBase(checkin),
  };
}
