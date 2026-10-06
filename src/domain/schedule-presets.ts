import { TimeAttribute } from './enums';
import type { Task } from './task';
import type { TaskTime } from './task';

/**
 * 「安排时间」的预设（对应收集箱的"给它定个时间"动作）。
 *
 * 交互习惯借鉴滴答清单 / Todoist：点开就是几个高频选项，而不是强制填表。
 * 规则只在这里定义一份 —— 界面只管展示 label，落库的 TaskTime 由这里算出。
 *
 * 注意：domain 层保持纯逻辑，不依赖 React Native；date-fns 是纯库，允许使用。
 */

export interface SchedulePreset {
  id: string;
  /** 界面显示文案 */
  label: string;
  attribute: Extract<TimeAttribute, 'fixed' | 'deadline'>;
  /** 距今几天 */
  dayOffset: number;
  hour: number;
  minute: number;
}

export const SCHEDULE_PRESETS: readonly SchedulePreset[] = [
  { id: 'today-am', label: '今天 上午', attribute: 'fixed', dayOffset: 0, hour: 9, minute: 0 },
  { id: 'today-pm', label: '今天 下午', attribute: 'fixed', dayOffset: 0, hour: 14, minute: 0 },
  { id: 'tonight', label: '今晚', attribute: 'fixed', dayOffset: 0, hour: 20, minute: 0 },
  { id: 'tomorrow-am', label: '明天 上午', attribute: 'fixed', dayOffset: 1, hour: 9, minute: 0 },
  { id: 'tomorrow-pm', label: '明天 下午', attribute: 'fixed', dayOffset: 1, hour: 14, minute: 0 },
  { id: 'today-due', label: '今晚前', attribute: 'deadline', dayOffset: 0, hour: 23, minute: 59 },
  { id: 'tomorrow-due', label: '明天前', attribute: 'deadline', dayOffset: 1, hour: 23, minute: 59 },
];

/** 把预设换算成具体的 TaskTime（fixed → startAt；deadline → dueAt） */
export function buildScheduleTime(preset: SchedulePreset, base: Date = new Date()): TaskTime {
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
  const anchor = task.time.startAt ?? task.time.dueAt;
  if (!anchor) return null;
  const d = new Date(anchor);
  if (Number.isNaN(d.getTime())) return null;
  return buildPlacedTime(task, d, minutesOfDay);
}

/**
 * 周视图拖拽：一次手势里同时改「哪一天」和「几点几分」。
 *
 * 与 buildRescheduledTime 的区别就是它还接管时刻 —— 在"7 天列 × 小时轴"
 * 的网格上，横拖换天、纵拖换时刻本来就是同一件事的两半，分开写只会
 * 让视图层做两次落库。
 */
export function buildPlacedTime(
  task: Task,
  date: Date,
  minutesOfDay: number,
): TaskTime | null {
  const anchor = task.time.startAt ?? task.time.dueAt;
  if (!anchor) return null;
  if (Number.isNaN(date.getTime())) return null;

  const clamp = Math.max(0, Math.min(24 * 60 - 1, Math.round(minutesOfDay)));
  const d = new Date(date);
  d.setHours(Math.floor(clamp / 60), clamp % 60, 0, 0);
  const iso = d.toISOString();

  if (task.time.attribute === TimeAttribute.Deadline) {
    return { attribute: TimeAttribute.Deadline, startAt: null, endAt: null, dueAt: iso };
  }
  return { attribute: TimeAttribute.Fixed, startAt: iso, endAt: null, dueAt: null };
}

/**
 * 自定义时间：用户自己指定「哪一天 + 几点几分」。
 *
 * 预设只覆盖高频场景（今天上午、明天前…），真实排事总有例外：
 * "下周三 19:20 的课"、"4 月 8 号 08:30 交材料"。这个函数就是那个出口，
 * 它不关心任务原来有没有时间 —— 从收集箱新建一条时间也用同一个入口。
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
 * 拖拽改期：把任务挪到某个日期，保留原来的时刻。
 * 日程型挪 startAt，截止型挪 dueAt；无时间任务返回 null（不该出现在日历上）。
 */
export function buildRescheduledTime(task: Task, date: Date): TaskTime | null {
  const anchor = task.time.startAt ?? task.time.dueAt;
  if (!anchor) return null;
  const old = new Date(anchor);
  if (Number.isNaN(old.getTime())) return null;

  const d = new Date(date);
  d.setHours(old.getHours(), old.getMinutes(), 0, 0);
  const iso = d.toISOString();

  if (task.time.attribute === TimeAttribute.Deadline) {
    return { attribute: TimeAttribute.Deadline, startAt: null, endAt: null, dueAt: iso };
  }
  return { attribute: TimeAttribute.Fixed, startAt: iso, endAt: null, dueAt: null };
}
