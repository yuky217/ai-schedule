import type { BaseEntity } from './base';
import type {
  CaptureSource,
  CompletionRule,
  Priority,
  RepeatFreq,
  TaskKind,
  TaskStatus,
  TimeAttribute,
} from './enums';

/** 重复规则（时长 / 习惯型）："每天"、"每周 3 次" */
export interface RepeatRule {
  freq: RepeatFreq;
  /** 间隔，1 = 每期都做 */
  interval: number;
  /** 周几，0 = 周日。仅 freq = weekly 时有意义 */
  byWeekday?: number[];
}

/**
 * 时间属性（主文档 5.3）。
 * 三者可以并存：比如"周三 14:00 开会（固定），但要在周二前交材料（截止）"，
 * 所以 startAt / dueAt 是并列字段，而不是二选一。
 */
export interface TaskTime {
  attribute: TimeAttribute;
  /** 固定时间的开始 / 结束 */
  startAt?: string | null;
  endAt?: string | null;
  /** 截止时间（ddl） */
  dueAt?: string | null;
}

/**
 * 进度：支撑"够时长 / 够频率自动完成"。
 *
 * **这里只剩一个字段，是故意的。**
 * 频率型的"本期完成几次"曾经也存这里（叫 `occurrencesThisPeriod`），但它必须有人负责
 * 在周期翻页时归零，而全项目没有任何地方做这件事 —— 于是"每周 3 次"一旦达标就
 * **永远停在已完成**，下一周做完也不会回来。
 *
 * 现在那个数字**不再存**：它由 `domain/habit-period.occurrencesInPeriod` 从打卡记录
 * 现算出来（打卡记录里有日期，"本期做了几次"就是数一数有几条落在本期）。
 * 原则是 **存事实、不存会漂移的计数** —— 不需要定时任务，撤销打卡后立刻正确。
 */
export interface TaskProgress {
  /** 累计投入分钟数（时长型）。只涨不落 —— 中途放弃也算投入 */
  accumulatedMinutes: number;
}

export interface Task extends BaseEntity {
  title: string;
  note?: string | null;
  kind: TaskKind;
  status: TaskStatus;
  time: TaskTime;
  /** 仅时长 / 习惯型有值 */
  repeat?: RepeatRule | null;
  completion: CompletionRule;
  /** 时长型的目标分钟数 */
  targetMinutes?: number | null;
  /** 频率型的目标次数（如"每周 3 次"里的 3） */
  targetOccurrences?: number | null;
  /** 所属容器（目标 / 项目 / 文件夹） */
  containerId?: string | null;
  tags: string[];
  /** 决定"谁先被排、谁被挤掉" */
  priority: Priority;
  /** 状态为 waiting 时，在等谁 */
  waitingFor?: string | null;
  /** 从哪个入口记进来的 */
  source: CaptureSource;
  completedAt?: string | null;
  progress: TaskProgress;
  /**
   * 提醒提前量（分钟）：0 = 准点提醒，10 = 开始/截止前 10 分钟。
   * 通知不可用的环境里这个字段照存不误 —— 提醒是加分项，数据先记全。
   */
  reminderMinutesBefore?: number | null;
  /**
   * 父任务 id（子任务用）。
   *
   * 只允许一层：子任务的子任务会被上层列表过滤掉、也拿不到进度，
   * 与其写递归，不如在数据层就阉掉这条可能性（个人待办里三层以上没有价值）。
   * 顶层任务的 parentId 为 null，列表查询一律带 `parent_task_id IS NULL`。
   */
  parentId?: string | null;
  /**
   * 手动排序权重（越小越靠前）。
   *
   * null 表示"用户没手动排过"，查询里按 0 处理并回落到 created_at DESC，
   * 于是没排过的任务仍然是"新的在最上面"；用户拖拽之后整份列表被写成
   * 1..n 的显式顺序，从此以手动序为准。
   */
  sortOrder?: number | null;
}

/* ------------------------------------------------------------------ */
/* 类型判定：让界面层不用到处写 kind === 'xxx'                          */
/* ------------------------------------------------------------------ */

export const isScheduleTask = (t: Pick<Task, 'kind'>) => t.kind === 'schedule';
export const isExecutionTask = (t: Pick<Task, 'kind'>) => t.kind === 'execution';
export const isHabitTask = (t: Pick<Task, 'kind'>) => t.kind === 'habit';
export const isIdeaTask = (t: Pick<Task, 'kind'>) => t.kind === 'idea';

/** 有明确时间（固定 或 截止），可以直接落到日历上 */
export const hasConcreteTime = (t: Pick<Task, 'time'>) =>
  t.time.attribute === 'fixed' || t.time.attribute === 'deadline';

/**
 * 时间字段的收口：把"说了有属性、却一个锚点都没填"的时间退化成"没时间"。
 *
 * 这种数据正常路径产不出来，但**备份导入、早期版本写下的行、手改过的库**
 * 都可能有。它最坏的地方不是报错、而是**安静地消失**：
 * 收集箱按 `time_attribute = 'none'` 收人，日历按锚点收人 —— 两边都不沾，
 * 全 App 没有任何一处会报错，任务就是不见了（用户只会说"我的任务丢了"）。
 *
 * 所以这条判定不放界面上、也不放某一个查询里，而是收在**读写库的必经之路**
 * （`data/db/mappers.ts`）上，让库里根本存不下这种行、读出来也已经被纠正。
 */
export function normalizeTaskTime(time: TaskTime): TaskTime {
  const hasAnchor = Boolean(time.startAt || time.endAt || time.dueAt);
  if (time.attribute !== 'none' && !hasAnchor) {
    return { attribute: 'none', startAt: null, endAt: null, dueAt: null };
  }
  return time;
}
