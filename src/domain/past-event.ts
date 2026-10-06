import { TaskKind, TimeAttribute } from './enums';
import type { Task, TaskTime } from './task';
import { taskWindow } from './task-state';

/**
 * 「这段时间已经过去了」—— 过去没打勾的**固定型**日程，得有个出口。
 *
 * 为什么非要有：日历上弱化（淡出）只是"看起来不吵"，并不解决"它还在那儿"。
 * 上周三的会一直挂在那儿，用户每次翻到那天都要重新想一遍"这个我到底办没办"。
 * 而项目的铁律是**时间过了绝不自动完成**，所以这个决定只能由用户来下。
 *
 * 三个出口对应三种真实意图，都是用户熟悉的东西，没有新概念：
 * - **挪到今天 / 明天**：忘了，但还要做（保留原来的时刻与时长，一步到位）
 * - **改成待办**：会不开了，但这事本身还得做 → 撤掉时间，回收集箱
 * - **就这样吧**：不做了 → 从日程里拿掉（软删除，不算完成、不进统计）
 *
 * 刻意**只给固定型**：截止型过期是"欠着"，欠着的东西不该被劝着放弃 ——
 * 那一类在界面上要显眼（见 task-state.ts）。
 */

/** 「挪到今天 / 明天」：换日期，保留原来的时刻与时长 */
export function shiftEventToDay(
  task: Pick<Task, 'time'>,
  dayOffset: number,
  now: Date = new Date(),
): TaskTime | null {
  // 只挪"占一段时间"的事；截止型该走改截止时间那条路（这里返回 null，语义不外溢）
  if (task.time.attribute === TimeAttribute.Deadline) return null;
  const anchor = task.time.startAt;
  if (!anchor) return null;

  const start = new Date(anchor);
  if (Number.isNaN(start.getTime())) return null;

  const target = new Date(now);
  target.setHours(0, 0, 0, 0);
  // 用 setDate 而不是加 86400000 毫秒：夏令时那天加固定毫秒会偏一小时
  target.setDate(target.getDate() + dayOffset);
  target.setHours(start.getHours(), start.getMinutes(), 0, 0);

  const end = task.time.endAt ? new Date(task.time.endAt) : null;
  const hasEnd = end !== null && !Number.isNaN(end.getTime());
  // 原来写了结束时按原时长整体平移；原来没写就继续留空 —— 不替它编一个结束时刻
  const nextEnd = hasEnd ? new Date(target.getTime() + (end.getTime() - start.getTime())) : null;

  return {
    attribute: TimeAttribute.Fixed,
    startAt: target.toISOString(),
    endAt: nextEnd ? nextEnd.toISOString() : null,
    dueAt: null,
  };
}

export interface EventShiftTarget {
  dayOffset: number;
  /** 按钮文案，例：`挪到今天 14:00` */
  label: string;
  /** 落库用的新时间 */
  time: TaskTime;
}

/**
 * 「挪一下」这个动作的**目标**：挪到**下一个还没到的**那个时刻。
 *
 * 为什么不是简单的"挪到今天"：用户晚上 20:37 才来看这件昨天晚上 14:00 的事，
 * 挪到今天 14:00 等于把它设到四小时前 —— 一样是"已经过去"，
 * 卡片不会消失，用户会以为按钮坏了。所以原时刻今天还没到就今天，已经过了就明天。
 *
 * 返回 null 表示这条任务不适合这个动作（截止型 / 没有时间），按钮就不该出现。
 */
export function planEventShift(
  task: Pick<Task, 'time'>,
  now: Date = new Date(),
): EventShiftTarget | null {
  if (task.time.attribute === TimeAttribute.Deadline) return null;
  const anchor = task.time.startAt;
  if (!anchor) return null;
  const start = new Date(anchor);
  if (Number.isNaN(start.getTime())) return null;

  const todayAtSameTime = new Date(now);
  todayAtSameTime.setHours(start.getHours(), start.getMinutes(), 0, 0);
  const dayOffset = todayAtSameTime.getTime() > now.getTime() ? 0 : 1;

  const time = shiftEventToDay(task, dayOffset, now);
  if (!time) return null;

  return {
    dayOffset,
    label: `挪到${dayOffset === 0 ? '今天' : '明天'} ${clockOfTimeOfDay(start)}`,
    time,
  };
}

/**
 * 「改成待办」：撤掉时间，回到"一件要做的事"。
 *
 * 顺手把类型从日程型换成执行型 —— 日程型的定义就是"占着一段时间"，
 * 时间撤了还挂着日程型，类型与事实不符（而且它确实回收集箱了）。
 * 习惯型不动：它的判定域在打卡，跟有没有时间无关。
 */
export function toLooseTodo(task: Pick<Task, 'kind'>): Pick<Task, 'kind' | 'time'> {
  return {
    kind: task.kind === TaskKind.Schedule ? TaskKind.Execution : task.kind,
    time: {
      attribute: TimeAttribute.None,
      startAt: null,
      endAt: null,
      dueAt: null,
    },
  };
}

/** "3 天前 / 昨天 / 前天 / 今天"，只吃天数差 */
function dayLabel(dayDiff: number): string {
  if (dayDiff === 0) return '今天';
  if (dayDiff === -1) return '昨天';
  if (dayDiff === -2) return '前天';
  return `${Math.abs(dayDiff)} 天前`;
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** 时间戳 → "14:05" */
const clockOfMs = (ms: number): string => {
  const d = new Date(ms);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

/** Date → "14:05"（只看时分） */
const clockOfTimeOfDay = (d: Date): string => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

/**
 * 卡片上那句"原来是哪一段"：`昨天 14:00–15:00`。
 * 结束时刻缺失时只报开始（同 taskWindow 的立场：不编时长）。
 */
export function describePastWindow(
  task: Pick<Task, 'time'>,
  now: Date = new Date(),
): string {
  const window = taskWindow(task);
  if (!window || window.start === null) return '';

  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const startOfThatDay = new Date(window.start);
  startOfThatDay.setHours(0, 0, 0, 0);
  const dayDiff = Math.round(
    (startOfThatDay.getTime() - startOfToday.getTime()) / 864e5,
  );

  const day = dayLabel(dayDiff);
  const from = clockOfMs(window.start);
  const endMs = task.time.endAt ? Date.parse(task.time.endAt) : NaN;
  const to = Number.isFinite(endMs) ? `–${clockOfMs(endMs)}` : '';
  return `${day} ${from}${to}`;
}
