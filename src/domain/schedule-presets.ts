import { TimeAttribute } from './enums';
import { taskAnchor, type Task, type TaskTime } from './task';

/**
 * 「安排时间」的预设（对应待办的"给它定个时间"动作）。
 *
 * 交互习惯借鉴滴答清单 / Todoist：点开就是几个高频选项，而不是强制填表。
 * 规则只在这里定义一份 —— 界面只管展示 label，落库的 TaskTime 由这里算出。
 *
 * 注意：domain 层保持纯逻辑，不依赖 React Native；date-fns 是纯库，允许使用。
 */

/**
 * 预设有两种形状：
 * - 时钟型：落在"某天某点"（今天上午、明天前……）；
 * - 相对型：落在"从现在起 N 分钟"（稍后）—— 用户要"安排到近未来"时，
 *   不该被迫去滚轮上精确对齐一个具体钟点。
 */
export type SchedulePreset =
  | {
      id: string;
      label: string;
      attribute: Extract<TimeAttribute, 'fixed' | 'deadline'>;
      dayOffset: number;
      hour: number;
      minute: number;
    }
  | {
      id: string;
      label: string;
      attribute: Extract<TimeAttribute, 'fixed'>;
      /** 从现在起多少分钟 */
      relativeMinutes: number;
    };

/** 「稍后」的口径只有一份（预设与语义词片共用）：现在 + 2 小时 */
const LATER_MINUTES = 120;

export const SCHEDULE_PRESETS: readonly SchedulePreset[] = [
  { id: 'today-am', label: '今天 上午', attribute: 'fixed', dayOffset: 0, hour: 9, minute: 0 },
  { id: 'today-pm', label: '今天 下午', attribute: 'fixed', dayOffset: 0, hour: 14, minute: 0 },
  { id: 'tonight', label: '今晚', attribute: 'fixed', dayOffset: 0, hour: 20, minute: 0 },
  { id: 'tomorrow-am', label: '明天 上午', attribute: 'fixed', dayOffset: 1, hour: 9, minute: 0 },
  { id: 'tomorrow-pm', label: '明天 下午', attribute: 'fixed', dayOffset: 1, hour: 14, minute: 0 },
  { id: 'later', label: '稍后', attribute: 'fixed', relativeMinutes: LATER_MINUTES },
  { id: 'today-due', label: '今晚前', attribute: 'deadline', dayOffset: 0, hour: 23, minute: 59 },
  { id: 'tomorrow-due', label: '明天前', attribute: 'deadline', dayOffset: 1, hour: 23, minute: 59 },
];

/** 把预设换算成具体的 TaskTime（fixed → startAt；deadline → dueAt） */
export function buildScheduleTime(preset: SchedulePreset, base: Date = new Date()): TaskTime {
  if ('relativeMinutes' in preset) {
    const d = new Date(base.getTime() + preset.relativeMinutes * 60_000);
    const iso = d.toISOString();
    return { attribute: TimeAttribute.Fixed, startAt: iso, endAt: null, dueAt: null };
  }

  const d = new Date(base);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + preset.dayOffset);
  d.setHours(preset.hour, preset.minute, 0, 0);
  const iso = d.toISOString();

  if (preset.attribute === TimeAttribute.Fixed) {
    return { attribute: TimeAttribute.Fixed, startAt: iso, endAt: null, dueAt: null };
  }
  return { attribute: TimeAttribute.Deadline, startAt: null, endAt: null, dueAt: iso };
}

/**
 * 拖拽改时刻（日视图）：日期不动，只把"当天几点几分"换掉。
 *
 * 吸到 15 分钟刻度由界面层算好再传进来 —— 这里只负责把分钟数写回实体，
 * 并保持任务原本的时间属性（固定时间继续是固定时间，截止继续是截止）。
 */
export function buildRetimedTime(task: Task, minutesOfDay: number): TaskTime | null {
  const anchor = taskAnchor(task);
  if (!anchor) return null;
  const d = new Date(anchor);
  if (Number.isNaN(d.getTime())) return null;
  return buildPlacedTime(task, d, minutesOfDay);
}

/**
 * 拖边界改时段（日视图）：开始/结束两个刻度一起写回。
 *
 * 与 buildRetimedTime 的分工：拖"整块"只挪开始时刻（时长跟着走没意义），
 * 拽**上下边**才是调整时长 —— 那一刻用户表达的是"这件事从几点到几点"。
 * 结束时刻为空的块从此有了 endAt；已有 endAt 的被边拖拽重写。
 * 两个刻度由界面层各自吸附 15 分钟并保证 start < end，这里只做校验与换算。
 */
export function buildRetimedSpanTime(
  task: Task,
  startMinutes: number,
  endMinutes: number,
): TaskTime | null {
  const anchor = taskAnchor(task);
  if (!anchor) return null;
  const day = new Date(anchor);
  if (Number.isNaN(day.getTime())) return null;

  const clamp = (m: number) => Math.max(0, Math.min(24 * 60 - 1, Math.round(m)));
  const start = clamp(startMinutes);
  const end = clamp(endMinutes);
  if (end <= start) return null;

  const at = (minutes: number) => {
    const d = new Date(day);
    d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
    return d.toISOString();
  };

  if (task.time.attribute === TimeAttribute.Deadline) return null;
  return { attribute: TimeAttribute.Fixed, startAt: at(start), endAt: at(end), dueAt: null };
}

/**
 * 周视图拖拽：一次手势里同时改「哪一天」和「几点几分」。
 *
 * 与 buildRescheduledTime 的区别就是它还接管时刻 —— 在"7 天列 × 小时轴"
 * 的网格上，横拖换天、纵拖换时刻本来就是同一件事的两半，分开写只会
 * 让视图层做两次落库。
 *
 * 有 endAt 的块拖拽时**时长跟着走**（挪的是位置不是长度）——
 * 用户把一个两小时的会拖到下午，不会期望它变成半小时。
 */
export function buildPlacedTime(
  task: Task,
  date: Date,
  minutesOfDay: number,
): TaskTime | null {
  const anchor = taskAnchor(task);
  if (!anchor) return null;
  if (Number.isNaN(date.getTime())) return null;

  const clamp = Math.max(0, Math.min(24 * 60 - 1, Math.round(minutesOfDay)));
  const d = new Date(date);
  d.setHours(Math.floor(clamp / 60), clamp % 60, 0, 0);
  const iso = d.toISOString();

  if (task.time.attribute === TimeAttribute.Deadline) {
    return { attribute: TimeAttribute.Deadline, startAt: null, endAt: null, dueAt: iso };
  }
  return { attribute: TimeAttribute.Fixed, startAt: iso, endAt: shiftEndAt(task, anchor, iso), dueAt: null };
}

/** 有 endAt 时按原时长平移到新开始时刻；没有就保持 null（时长本来就没定） */
/**
 * 这几个"改期"函数只关心任务的**时间**，所以用 `Pick<Task, 'time'>` 收参数，
 * 而不是整个 Task。
 *
 * 这样"手上只有一段时间、还没有任务"的情形（在日历某天新建一件，
 * 先解析出文字里的时刻）也能走同一个口径 —— 否则就得为它另写一个
 * "无任务版"，两份口径迟早算出不同的日子。
 */
function shiftEndAt(task: Pick<Task, 'time'>, oldStartIso: string, newStartIso: string): string | null {
  if (!task.time.endAt) return null;
  const oldEnd = new Date(task.time.endAt);
  const oldStart = new Date(oldStartIso);
  if (Number.isNaN(oldEnd.getTime()) || Number.isNaN(oldStart.getTime())) return null;
  return new Date(new Date(newStartIso).getTime() + (oldEnd.getTime() - oldStart.getTime())).toISOString();
}

/**
 * 自定义时间：用户自己指定「哪一天 + 几点几分」。
 *
 * 预设只覆盖高频场景（今天上午、明天前…），真实排事总有例外：
 * "下周三 19:20 的课"、"4 月 8 号 08:30 交材料"。这个函数就是那个出口，
 * 它不关心任务原来有没有时间 —— 从待办新建一条时间也用同一个入口。
 *
 * attribute 由界面层选择（日程 = 有个开始时刻 / 截止 = 那天几点前要交）。
 */
export function buildCustomTime(
  attribute: Extract<TimeAttribute, 'fixed' | 'deadline'>,
  date: Date,
  minutesOfDay: number,
): TaskTime | null {
  if (Number.isNaN(date.getTime())) return null;

  const clamp = Math.max(0, Math.min(24 * 60 - 1, Math.round(minutesOfDay)));
  const d = new Date(date);
  d.setHours(Math.floor(clamp / 60), clamp % 60, 0, 0);
  const iso = d.toISOString();

  if (attribute === TimeAttribute.Deadline) {
    return { attribute: TimeAttribute.Deadline, startAt: null, endAt: null, dueAt: iso };
  }
  return { attribute: TimeAttribute.Fixed, startAt: iso, endAt: null, dueAt: null };
}

/**
 * 全天：**占满一整天**的那一种（2026-10-10 加）。
 *
 * 与 `buildCustomTime` 是并列的两个出口，不是它的一个参数 —— 全天根本没有
 * "几点几分"可言，让它去吃 minutesOfDay 只会造出一个假的 00:00。
 *
 * startAt / endAt **照旧写成当天的 00:00 与 23:59:59**：日历窗口按锚点收人、
 * 排序按锚点、提醒按锚点排期，全天如果只留一个 `allDay` 标记而没有锚点，
 * 它就会从**所有**按时间取数的列表里消失（和"有属性没锚点"同一个坑，
 * 见 `normalizeTaskTime` 的说明）。`allDay: true` 只影响显示。
 */
export function buildAllDayTime(date: Date): TaskTime | null {
  if (Number.isNaN(date.getTime())) return null;
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return {
    attribute: TimeAttribute.Fixed,
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    dueAt: null,
    allDay: true,
  };
}

/**
 * 拖拽改期：把任务挪到某个日期，保留原来的时刻。
 * 日程型挪 startAt，截止型挪 dueAt；无时间任务返回 null（不该出现在日历上）。
 * 有 endAt 的同样按时长平移（同 buildPlacedTime：挪位置不挪长度）。
 */
export function buildRescheduledTime(task: Pick<Task, 'time'>, date: Date): TaskTime | null {
  const anchor = taskAnchor(task);
  if (!anchor) return null;
  const old = new Date(anchor);
  if (Number.isNaN(old.getTime())) return null;

  const d = new Date(date);
  d.setHours(old.getHours(), old.getMinutes(), 0, 0);
  const iso = d.toISOString();

  if (task.time.attribute === TimeAttribute.Deadline) {
    return { attribute: TimeAttribute.Deadline, startAt: null, endAt: null, dueAt: iso };
  }
  return { attribute: TimeAttribute.Fixed, startAt: iso, endAt: shiftEndAt(task, anchor, iso), dueAt: null };
}

/* ------------------------------------------------------------------ *
 * 语义词片：用「哪天」说话，而不是「几点几分」
 * ------------------------------------------------------------------ */

/**
 * 「今天 / 明天 / 周末 / 下周 / 稍后」—— 按"哪一天"改期。
 *
 * 与上面预设的分工说清楚，两者容易混：
 * - **预设**指定钟点（今天上午 = 09:00），回答"几点开始"；
 * - **词片**只指定哪一天，回答"哪天做"。待办里的任务本来就没有时间，
 *   用户消化它们的第一念是"今天做 / 周末做"，不是"14:00 开始"。
 *
 * 落点是待办的长按菜单：长按一行 → 选一个词 → 这条就安排好了，
 * 不用进详情页、也不用在滚轮上对齐钟点。
 */
export type SemanticTarget = 'today' | 'tomorrow' | 'weekend' | 'nextWeek' | 'later';

export const SEMANTIC_TARGETS: readonly { id: SemanticTarget; label: string }[] = [
  { id: 'today', label: '今天' },
  { id: 'tomorrow', label: '明天' },
  { id: 'weekend', label: '周末' },
  { id: 'nextWeek', label: '下周' },
  { id: 'later', label: '稍后' },
];

/** 距最近的那个周六还有几天：周六 → 0，周日 → 6（下周六），周一 → 5 … 周五 → 1 */
function daysUntilWeekend(base: Date): number {
  return 6 - base.getDay();
}

/** 距下一个周一还有几天：周一 → 7（下周一），周日 → 1，周六 → 2 … */
function daysUntilNextMonday(base: Date): number {
  // `|| 7` 不是装饰：周一那天 (8-1)%7 = 0，不加会把「下周」落到今天
  return (8 - base.getDay()) % 7 || 7;
}

/**
 * 该目标落在哪一天（本地零点）。
 *
 * 边界都取"未来的那一天"，**不产生过去的日期** —— 周日的"周末"给下周六
 * 而不是刚过去的昨天，否则改完就落在过去，等于把任务弄丢在日历背面。
 * 「稍后」不落在某一天（它只描述时刻）→ null。
 */
export function semanticTargetDate(
  target: SemanticTarget,
  base: Date = new Date(),
): Date | null {
  if (target === 'later') return null;
  const d = new Date(base);
  d.setHours(0, 0, 0, 0);
  if (target === 'today') return d;
  if (target === 'tomorrow') {
    d.setDate(d.getDate() + 1);
    return d;
  }
  if (target === 'weekend') {
    d.setDate(d.getDate() + daysUntilWeekend(base));
    return d;
  }
  d.setDate(d.getDate() + daysUntilNextMonday(base));
  return d;
}

/**
 * 落到**某一天**。
 *
 * 这是"给它定个哪天的日子"的**唯一出口** —— 语义词片（今天/明天/周末…）与
 * 待办拖到日期条，最后都走这里。两处各写一遍"无时间的该给几点"，
 * 迟早会出现"点菜单落 23:59、拖过去落 09:00"这种同义词给出不同结果的事。
 *
 * 两种情形分开处理，因为"放到那天"在两种任务上意思不同：
 * - **已经有时间**的：只换日期，**时刻和属性都不动**（"明天 09:00 的会"
 *   挪到后天还是 09:00）；
 * - **还没时间**的（待办里全是这种）：落到那天的 23:59 作为**截止** ——
 *   用户说的是"这天做"，不是"这天 9 点开始"。用 9 点这个数，下午把一条
 *   拖到今天就立刻变成"已经过点"，看着像出错；"这天前做完"到今晚之前都成立。
 *
 * 23:59 的截止仍然算"那天有安排"：`timeAnchor` 是 startAt ?? dueAt，
 * 所以这条照样出现在日历那一天，不会凭空消失。
 */
export function buildTimeOnDay(task: Pick<Task, 'time'>, date: Date): TaskTime | null {
  if (Number.isNaN(date.getTime())) return null;

  // 已经有时间 → 保留时刻与属性，只换日期。
  // `task.time` 可能是 null（手上只有一段"还没落库的时间"时就是），
  // 直接问 taskAnchor 会在它内部炸（那里假定 time 是个对象），所以先看一眼。
  if (task.time && taskAnchor(task)) return buildRescheduledTime(task, date);

  const d = new Date(date);
  d.setHours(23, 59, 0, 0);
  return { attribute: TimeAttribute.Deadline, startAt: null, endAt: null, dueAt: d.toISOString() };
}

/**
 * 把任务改到某个语义目标（长按菜单里的"今天/明天/周末/下周"）。
 *
 * 「稍后」是唯一例外：它本来就只描述时刻（现在 + 两小时），与哪天无关，
 * 所以不走 buildTimeOnDay。其余一律交给它 —— 口径只有一份。
 */
export function buildSemanticTime(
  task: Task,
  target: SemanticTarget,
  base: Date = new Date(),
): TaskTime | null {
  if (target === 'later') {
    const at = new Date(base.getTime() + LATER_MINUTES * 60_000);
    return { attribute: TimeAttribute.Fixed, startAt: at.toISOString(), endAt: null, dueAt: null };
  }

  const date = semanticTargetDate(target, base);
  if (!date) return null;
  return buildTimeOnDay(task, date);
}
