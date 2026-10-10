import type { BaseEntity } from './base';
import { TimeAttribute } from './enums';
import type {
  CaptureSource,
  CompletionRule,
  Priority,
  RepeatFreq,
  TaskKind,
  TaskStatus,
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
  /**
   * 全天：**占满一整天，没有具体时刻**（2026-10-10 加）。
   *
   * 它不是第四种 attribute，而是**挂在"日程"上的一种形态** —— 属性仍然是
   * "这天要发生"，只是不落到几点几分。所以落库时 startAt/endAt 照旧写
   * （当天 00:00 到 23:59:59），日历窗口、排序、排提醒全都照原样工作，
   * 这个字段只负责"显示上别把 00:00 当成真的零点"。
   *
   * 反过来，**不能靠"startAt 是 00:00"去推全天**：用户可以真的把一件事
   * 定在零点。是全天就必须明说。
   */
  allDay?: boolean;
}

/**
 * "没有时间"这个值。
 *
 * 凡是"手上还没有时间、但要走一遍时间口径"的地方（比如在日历某天新建一件，
 * 先拿文字里解析出来的时间去问 `buildTimeOnDay`）都用它当空值 ——
 * 不要各写一份 `{ attribute: 'none' }` 字面量，那样改口径时会漏掉一处。
 */
export const NO_TIME: TaskTime = {
  attribute: TimeAttribute.None,
  startAt: null,
  endAt: null,
  dueAt: null,
};

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
  /**
   * 地点（可选）。**与课程、固定日程上的同名字段对齐** —— 那两者早就有它了，
   * 只有任务没有，于是"粘一整段通知"里那句「🏠地点：…」只能躺在备注里。
   *
   * 它是"这件事在哪儿发生"，不是"这件事是什么"的一部分：日历上你要知道去哪，
   * 而那一眼不该靠点进详情页才能看见。
   */
  location?: string | null;
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
/* 类型判定                                                            */
/* ------------------------------------------------------------------ */

/** 有明确时间（固定 或 截止），可以直接落到日历上 */
export const hasConcreteTime = (t: Pick<Task, 'time'>) =>
  t.time.attribute === 'fixed' || t.time.attribute === 'deadline';

/* ------------------------------------------------------------------ */
/* 时间：三个字段，四个问题，一个家                                       */
/* ------------------------------------------------------------------ */
/*
 * 任务的时间有三个字段（startAt / endAt / dueAt），它们能回答几个**不同**的问题，
 * 而收口前每个问题都在各处被手写了一遍（同一行 `time.startAt ?? time.dueAt`
 * 抄了 13 遍，反向的 `dueAt ?? startAt` 抄了 4 遍）：
 *
 * - `timeAnchor`  "什么时候**发生**" → 归到日历哪一天 / 排序 / 排提醒 / 滚重复
 * - `timeDue`     "什么时候**到期**" → 期限显示 / 紧迫度
 * - `hasAnyTime`  "**落进时间轴了吗**" → 该不该画到日历 / 甘特图上
 *
 * 关键在它们两两之间都有实质差别，不能当同一个东西：
 * - 前两个**方向相反**，而且是**并列的两条事实**（"周三 14:00 开会，但周二前交材料"
 *   里，开始与截止指向不同日子）—— 不是"哪个更优先"，是回答不同的问题；
 * - 第三个**包含 endAt**，前两个刻意不含（单独一个结束时间不构成"什么时候发生"，
 *   但它确实占着一段时间，所以仍要画到日历上）。
 *
 * 混用它们不会崩溃，只会**日子算错而没人发现** —— 所以每个都只有一处定义，
 * 并由 `task-anchor.guard.test.ts` 扫源码守着（再手写就变红）。
 *
 * 至于"说了有时间、却一个锚点都没填"的退化数据，由 `normalizeTaskTime` 兜底。
 */

/**
 * "这件事算哪一刻"：优先开始时间（日程就是那天那点要发生），
 * 没有才看截止时间（执行型常有 ddl）。
 *
 * 签名收下三个时间字段、但**刻意不看 endAt** —— 结束时间是锚点的附属信息
 * （14:00–15:00 的会锚在 14:00），单独一个 endAt 不构成"它什么时候发生"。
 * 收下 endAt 只是为了能直接吃一个完整的时间对象，不用调用方先挑字段。
 */
export function timeAnchor(
  time: Pick<TaskTime, 'startAt' | 'endAt' | 'dueAt'>,
): string | null {
  return time.startAt ?? time.dueAt ?? null;
}

/** `timeAnchor` 的 Task 版本 */
export const taskAnchor = (t: Pick<Task, 'time'>): string | null => timeAnchor(t.time);

/**
 * "这件事什么时候**到期**"：优先截止时间，其次开始时间。
 *
 * 方向与 `timeAnchor` 相反，但**它不是 `timeAnchor` 的另一种读法，而是另一条并列的事实**：
 * 一件任务可以同时有两者 —— "周三 14:00 开会（固定），但周二前要交材料（截止）"。
 * 所以：
 * - `taskAnchor` 回答"什么时候**发生**" → 归到日历哪一天 / 排序 / 排提醒 / 滚重复
 * - `taskDue`    回答"什么时候**到期**" → 期限显示 / 紧迫度
 *
 * 混用这两者的后果不是崩溃，而是**日子算错而没人发现**。
 */
export function timeDue(
  time: Pick<TaskTime, 'startAt' | 'endAt' | 'dueAt'>,
): string | null {
  return time.dueAt ?? time.startAt ?? null;
}

/** `timeDue` 的 Task 版本 */
export const taskDue = (t: Pick<Task, 'time'>): string | null => timeDue(t.time);

/**
 * 三个时间字段里有没有任何一个（**含 endAt**）—— "这条任务落进时间轴了吗"。
 *
 * 与 `normalizeTaskTime` 同一口径：规范化之后，"有属性"与"有锚点"必然一致，
 * 所以这个判断也是"该不该出现在日历 / 甘特图上"的判据。
 */
export function hasAnyTime(
  time: Pick<TaskTime, 'startAt' | 'endAt' | 'dueAt'>,
): boolean {
  return Boolean(time.startAt || time.endAt || time.dueAt);
}

/**
 * 是不是"全天"。**两个条件都要**：标记了全天、而且真有锚点。
 *
 * 只看 `allDay` 是不够的 —— 退化数据（标了全天却没锚点）会被
 * `normalizeTaskTime` 修成"没时间"，那时它就不该再被当成全天显示。
 */
export function isAllDay(
  time: Pick<TaskTime, 'allDay'> & Pick<TaskTime, 'startAt' | 'endAt' | 'dueAt'>,
): boolean {
  return Boolean(time.allDay) && hasAnyTime(time);
}

/**
 * "这件事到什么时候为止都还算**没到**"（收件箱 / 小组件 / 首页都问这个）。
 *
 * ⭐ **全天看的是当天结束（endAt），不是开始**。
 * 全天的 startAt 是当天 00:00，拿它跟"现在"比**永远比不过** ——
 * 于是一条"今天全天"的事永远不会被算成"下一个截止"，凭空从卡片上少一件。
 * 语义上也该这样：全天说的是"这一天都算它"，那这天过完之前它就还没到。
 *
 * 其余时间看 `timeDue`（截止优先、其次开始），与全局口径一致。
 */
export function pendingUntil(
  time: Pick<TaskTime, 'allDay'> & Pick<TaskTime, 'startAt' | 'endAt' | 'dueAt'>,
): string | null {
  if (isAllDay(time)) return time.endAt ?? null;
  return timeDue(time);
}

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
  if (time.attribute !== 'none' && !hasAnyTime(time)) {
    return { attribute: 'none', startAt: null, endAt: null, dueAt: null };
  }
  return time;
}
