import { differenceInCalendarDays, startOfDay } from 'date-fns';

import { TaskKind, TaskStatus, TimeAttribute } from './enums';
import { taskDisplayState, type TaskDisplayState } from './task-state';
import { hasAnyTime, taskDue, type Task } from './task';

/**
 * 「待办」视图的数据口径。
 *
 * 用户的原话是"想找个地方看到所有待办，不管设没设时间；开会、上课这种不算待办"。
 * 这句话翻译成数据就是一条判断：
 *
 *   **待办 = 执行型 + 习惯型，还没做完。**
 *
 * 为什么"开会/上课"被自动排除了：它们是 `schedule`（日程型）—— 别人定好的时间，
 * 到点发生，不需要"你去做"。而执行型（写作业、写策划）和习惯型（跑步、背单词）
 * 才是"欠着你的"。所以这里**不需要用户手动归档、也不需要一个"标记为待办"的开关**，
 * 类型本身就把这件事答了（与"不做智能清单"那条立场一致：落位规则只有一套）。
 *
 * 唯一的例外是**还没排时间的日程型**（快记的一句"开会"、没写时间）——
 * 它没有"到点"可言，反而需要一个落点，否则会从所有列表里消失（见 `isTodo`）。
 *
 * 想法型（idea）也不进来：它在想法库里等着被拆解，不是待办。
 */

/**
 * 分档。顺序就是"先看哪一档"，从最急到最不急。
 * 分档不做成"用户可选的分组方式" —— 只有这一套，用户零操作。
 */
export type TodoBucket =
  /** 已经过期的截止型 —— 欠着的，最该看 */
  | 'overdue'
  /** 今天要做：今天到期，或今天有固定时间 */
  | 'today'
  /** 还没到：未来有明确日期的 */
  | 'upcoming'
  /** 想做但没排时间的（收集箱里的执行型/习惯型） */
  | 'someday'
  /** 已经做完的（折叠在最后，只做回顾用） */
  | 'done';

export interface TodoGroup {
  bucket: TodoBucket;
  title: string;
  tasks: Task[];
}

/** 一眼能看出"这档是什么"的标题；空档不显示 */
const BUCKET_TITLE: Record<TodoBucket, string> = {
  overdue: '已过期',
  today: '今天',
  upcoming: '往后',
  someday: '还没排时间',
  done: '已完成',
};

/** 分档的固定先后 —— 界面按这个顺序铺，不依赖数据里出现的顺序 */
const BUCKET_ORDER: TodoBucket[] = ['overdue', 'today', 'upcoming', 'someday', 'done'];

/**
 * 是不是"待办"。默认**只看类型**：
 *
 * 执行型和习惯型就是待办（做完的也在内，它落在最后的『已完成』档）；
 * 日程型不是 —— 开会、上课是"别人定好的时间，到点发生"，不欠你什么。
 * 所以这里不能先判 `status === Done`，那会把"做完的会"也收进来。
 *
 * ⭐ **一条例外：日程型但完全没排时间**时也算待办。
 *
 * "到点发生"这条理由的**前提是它有时间**；一条连锚点都没有的日程根本谈不上"到点"，
 * 它和"没排期的执行型"处境完全一样 —— 都是"记下来了、还没安排"。
 *
 * 不收它的后果非常具体：收集箱（五档列表）不收、日历要时间才进得去、
 * 首页今天按时间窗匹配、习惯页只取习惯型 —— 四个列表同时把它排除，
 * 用户快记的一句"开会"就凭空消失了（只有知道 id 才打得开）。
 * 这不是假设：`task-repository.test.ts` 的可达性扫描把
 * `todo/doing/waiting/done × schedule × 无时间` 四种组合直接扫了出来。
 *
 * 想法型不在例外里 —— 它在想法库等拆解，那里才是它的家（`kind` 判定在后，
 * 就是为了不被这条例外顺带收进来）。
 */
export function isTodo(task: Pick<Task, 'kind' | 'time'>): boolean {
  if (task.kind === TaskKind.Execution || task.kind === TaskKind.Habit) return true;
  if (task.kind === TaskKind.Schedule) return !hasAnyTime(task.time);
  return false;
}

/**
 * 把一条任务归到哪一档。
 *
 * 判断顺序刻意是"先看它长什么样（displayState）再看日期"：
 * displayState 已经把"过期"分成了两种含义（截止型欠着 / 固定型已过去），
 * 这里直接复用，不重新解释一遍时间 —— 两边一旦不一致，就会出现
 * "日历里说它过期了、待办里却排在后天"这种自相矛盾。
 */
export function bucketOf(task: Task, now: Date = new Date()): TodoBucket {
  if (task.status === TaskStatus.Done) return 'done';

  const state: TaskDisplayState = taskDisplayState(task, now);
  if (state === 'overdue') return 'overdue';
  if (state === 'unscheduled') return 'someday';

  // 有时间的：按它落的那个日子分"今天 / 往后"。
  // 用 taskDue 取锚点（它优先截止、其次开始），固定型也拿得到 startAt ——
  // 不用再自己挑字段，挑错字段的后果是"日子算错而没人发现"。
  const anchor = taskDue(task);
  if (!anchor) return 'someday';
  const at = new Date(anchor);
  if (Number.isNaN(at.getTime())) return 'someday';

  const diff = differenceInCalendarDays(startOfDay(at), startOfDay(now));
  if (diff <= 0) return 'today';
  return 'upcoming';
}

/**
 * 档内排序：按时间先后。
 *
 * ⚠️ **不补 id 做次关键字**：`Array.prototype.sort` 在现代 JS 引擎里是稳定的，
 * 返回 0 就能原样保留传入顺序 —— 而"传入顺序"这里是有意义的
 * （收集箱的顺序就是用户自己拖出来的意愿）。补一个 id 兜底会把这个意愿按字母重排，
 * 用户看到的顺序会莫名其妙地变。
 *
 * 也不需要处理"一方有时间的"情况：**有没有时间本身就决定了分档** ——
 * 没时间的一律落进『还没排时间』档，不可能和时间共存于同一档。
 */
function compareInBucket(a: Task, b: Task): number {
  const at = taskDue(a);
  const bt = taskDue(b);
  const an = at ? Date.parse(at) : null;
  const bn = bt ? Date.parse(bt) : null;
  if (an === null || bn === null) return 0;
  if (!Number.isFinite(an) || !Number.isFinite(bn)) return 0;
  return an - bn;
}

/**
 * 分成几档。返回的组**已按固定档序排列**，并**去掉空档**——
 * 界面上一个空标题只会让人以为"这里本该有东西，是不是没加载出来"。
 */
export function groupTodos(tasks: readonly Task[], now: Date = new Date()): TodoGroup[] {
  const buckets = new Map<TodoBucket, Task[]>();
  for (const task of tasks) {
    if (!isTodo(task)) continue;
    const bucket = bucketOf(task, now);
    const list = buckets.get(bucket) ?? [];
    list.push(task);
    buckets.set(bucket, list);
  }

  const groups: TodoGroup[] = [];
  for (const bucket of BUCKET_ORDER) {
    const list = buckets.get(bucket);
    if (!list?.length) continue;
    // 已完成不按时间排 —— 它只是"最近做完的那几件"，让新完成的浮到上面更有用。
    // 未完成档走 compareInBucket（稳定排序，没时间的保留传入顺序，见其注释）。
    const sorted =
      bucket === 'done'
        ? [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))
        : [...list].sort(compareInBucket);
    groups.push({ bucket, title: BUCKET_TITLE[bucket], tasks: sorted });
  }
  return groups;
}

/**
 * 已完成档最多显示几条。
 *
 * 这一档是"我最近干完了什么"的回顾，不是待办清单的主体 ——
 * 留着几百条已完成的会把上面四档挤到屏幕外。要看全部就去回顾页。
 */
export const TODO_DONE_LIMIT = 10;
