import { addDays, differenceInCalendarWeeks, startOfWeek } from 'date-fns';

import { TaskStatus } from './enums';
import { taskAnchor, type RepeatRule, type Task, type TaskTime } from './task';

/**
 * 重复任务的「下一期」计算与描述。
 *
 * 滚动模型借鉴滴答清单 / Todoist：重复任务不是预生成 N 条，而是**一条记录
 * 完成一次就把自己挪到下一期**。好处是收集箱 / 日历永远只有"眼前这一期"，
 * 不会出现几十条重复实例把列表撑爆；代价是看不到未来排期 —— 对极简产品
 * 这是正确取舍（主文档 5.1：习惯型要的是"今天做没做"，不是日历预测）。
 *
 * domain 层保持纯逻辑，date-fns 是纯库，允许使用。
 */

const WEEKDAY_CN = ['日', '一', '二', '三', '四', '五', '六'] as const;

/**
 * 算下一期时间点，保留原来的时刻（几点就是几点）。
 * - daily：+interval 天
 * - weekly 无 byWeekday：+interval 周；有 byWeekday：从次日找起，
 *   且"周的序号差"必须是 interval 的整数倍（支持"每 2 周的周一"）
 * - monthly：月份 +interval，日期超出月末时钳到月末（1月31日 → 2月28日）
 */
export function nextOccurrence(rule: RepeatRule, anchor: Date): Date | null {
  const from = new Date(anchor);
  if (Number.isNaN(from.getTime())) return null;

  if (rule.freq === 'daily') {
    return addDays(from, rule.interval);
  }

  if (rule.freq === 'weekly') {
    const days = rule.byWeekday?.length
      ? [...new Set(rule.byWeekday)].sort((a, b) => a - b)
      : null;
    if (!days) return addDays(from, 7 * rule.interval);

    // 从 anchor 的次日开始找，最多扫 interval*2 个周期足够兜底
    for (let offset = 1; offset <= 7 * rule.interval * 2; offset++) {
      const probe = addDays(from, offset);
      if (!days.includes(probe.getDay())) continue;
      const weekGap = differenceInCalendarWeeks(probe, from, { weekStartsOn: 1 });
      if (weekGap % rule.interval === 0) return probe;
    }
    return null;
  }

  // monthly：先落目标月，再钳日期
  const target = new Date(
    from.getFullYear(),
    from.getMonth() + rule.interval,
    1,
    from.getHours(),
    from.getMinutes(),
    0,
    0,
  );
  const daysInTargetMonth = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(from.getDate(), daysInTargetMonth));
  return target;
}

/** 周期规则的中文短描述，界面 meta 行直接用 */
export function describeRepeat(rule: RepeatRule): string {
  const n = rule.interval;
  if (rule.freq === 'daily') return n > 1 ? `每 ${n} 天` : '每天';
  if (rule.freq === 'monthly') return n > 1 ? `每 ${n} 个月` : '每月';

  if (rule.byWeekday?.length) {
    const sorted = [...new Set(rule.byWeekday)].sort((a, b) => a - b);
    const isWorkweek =
      n === 1 &&
      sorted.length === 5 &&
      sorted.every((d, i) => d === i + 1);
    if (isWorkweek) return '工作日';
    const label = sorted.map((d) => `周${WEEKDAY_CN[d]}`).join('、');
    return n > 1 ? `每 ${n} 周 · ${label}` : `每${label}`;
  }
  return n > 1 ? `每 ${n} 周` : '每周';
}

/** 提前量的中文短描述 */
export function describeReminder(minutes: number | null | undefined): string {
  if (!minutes || minutes <= 0) return '准点';
  if (minutes < 60) return `提前 ${minutes} 分钟`;
  const hours = minutes / 60;
  return Number.isInteger(hours) ? `提前 ${hours} 小时` : `提前 ${minutes} 分钟`;
}

/**
 * 完成一个重复任务时，算出"把自己滚到下一期"的字段补丁。
 *
 * 不动 title / repeat / reminderMinutesBefore —— 这些是任务的"身份"，
 * 只有时间与状态翻新。返回 null 表示不滚动（没有 repeat / 没有锚点时间），
 * 调用方按普通完成处理。
 *
 * **也不动 progress**：滚动的是时间，不是计数。此前它顺手把
 * `progress.occurrencesThisPeriod` +1，与打卡、专注两处的 +1 撞成三种意思，
 * 还因为从不归零导致频率型任务永远停在已完成。计数现在由打卡记录派生
 * （见 domain/habit-period.occurrencesInPeriod），这条补丁只管时间。
 */
export function advanceRepeatingTask(task: Task): Partial<Task> | null {
  if (!task.repeat) return null;
  const anchor = taskAnchor(task);
  if (!anchor) return null;

  const next = nextOccurrence(task.repeat, new Date(anchor));
  if (!next) return null;
  const iso = next.toISOString();

  const time: TaskTime =
    task.time.attribute === 'deadline'
      ? { attribute: 'deadline', startAt: null, endAt: null, dueAt: iso }
      : { attribute: 'fixed', startAt: iso, endAt: null, dueAt: null };

  return { time, status: TaskStatus.Todo, completedAt: null };
}

/** 安排面板里的重复预设：保持"一次点按"的极简交互 */
export interface RepeatPreset {
  id: string;
  label: string;
  rule: RepeatRule | null;
}

export const REPEAT_PRESETS: readonly RepeatPreset[] = [
  { id: 'none', label: '不重复', rule: null },
  { id: 'daily', label: '每天', rule: { freq: 'daily', interval: 1 } },
  {
    id: 'workday',
    label: '工作日',
    rule: { freq: 'weekly', interval: 1, byWeekday: [1, 2, 3, 4, 5] },
  },
  { id: 'weekly', label: '每周', rule: { freq: 'weekly', interval: 1 } },
  { id: 'monthly', label: '每月', rule: { freq: 'monthly', interval: 1 } },
];

/** 安排面板里的提醒提前量预设 */
export interface ReminderPreset {
  id: string;
  label: string;
  minutes: number;
}

export const REMINDER_PRESETS: readonly ReminderPreset[] = [
  { id: 'on-time', label: '准点', minutes: 0 },
  { id: 'min-5', label: '提前 5 分钟', minutes: 5 },
  { id: 'min-10', label: '提前 10 分钟', minutes: 10 },
  { id: 'min-30', label: '提前 30 分钟', minutes: 30 },
  { id: 'hour-1', label: '提前 1 小时', minutes: 60 },
];
