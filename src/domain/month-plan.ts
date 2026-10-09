import { format, isSameMonth } from 'date-fns';

import { monthGridDays } from './calendar-window';
import { coursesOnDate, type Course, type CourseSlot, type Term } from './course';
import type { CalEvent } from './event';
import type { MarkView } from './marks';
import type { Task } from './task';

/**
 * 月历下拉展开的那张「这个月每天都有什么」清单。
 *
 * ## 为什么要有它
 *
 * 月历的格子只有一个数字和几个圆点 —— 它回答的是"哪天重"，回答不了
 * "到底是哪几件事"。想知道只能一天天点过去，而"这个月的节奏"恰恰是
 * 一次看全才看得出来的东西。
 *
 * ## 为什么是"下拉展开列表"而不是"格子里直接写字"
 *
 * 格子里塞文字的代价是月历变成一张密密麻麻的表（一格 44pt 宽放不下任何
 * 一个标题），而"看全局节奏"这件事正是靠格子**留白**才成立的。
 * 所以月历仍然只画圆点，名字在**拉开的那一块**里逐天列出来 ——
 * 两个视角各管一件事，日历本身不变形。
 *
 * ## 天内的顺序
 *
 * 纪念日 → 课 → 考试 → 任务，与 `domain/calendar-shape` 的圆点顺序
 * （课 → 考试 → 任务，越往后越要你动手）同源，只把纪念日挪到最前 ——
 * 它不是"一件事"，是这一天的底色（日卡里也是这个位置）。
 */

export interface MonthPlanDay {
  date: Date;
  /** 纪念日（可能多个） */
  marks: MarkView[];
  /** 那天的课，按"开学第几天"的顺序（换算在 coursesOnDate，含调课/停课） */
  courses: CourseSlot[];
  /** 那天的考试 */
  exams: CalEvent[];
  /** 那天要做的事（已截断） */
  tasks: Task[];
  /** 被截掉的任务数（>0 时列表里要给出"看这天"的出口） */
  extraTasks: number;
}

/**
 * 一天最多列几件事。
 *
 * 这个面板是拿来**扫节奏**的：某天真的排了 8 件事时，全列出来的代价是
 * 那一天吃掉半屏，整月的疏密就被一条长尾压平了 —— 而"哪天最重"
 * 本来圆点已经说过了。超出部分走「还有 N 件 · 看这天」进日视图。
 */
export const MONTH_PLAN_TASK_LIMIT = 3;

export interface MonthPlanInput {
  /** 正在看的那个月（任意一个落在它里面的日期） */
  month: Date;
  /** key = yyyy-MM-dd */
  tasksByDay: Map<string, Task[]>;
  examsByDay: Map<string, CalEvent[]>;
  marksByDay: Map<string, MarkView[]>;
  courses: readonly Course[];
  term: Term | null;
  /** 课表总开关：关掉后课连这张清单一起不出现（与月历/日视图同一口径） */
  timetableOn: boolean;
}

/**
 * 把"这个月"摊成按天分组的清单。
 *
 * 只收**属于这个月**的日子：月历画的是 6×7 整张网格（首尾会带上/下月的
 * 几天），而这张清单说的是"10 月的安排" —— 把 9 月 29 号列进 10 月清单里，
 * 翻到 9 月又会再列一次，同一天在两张清单上重复出现。
 *
 * 只有课的那天**也算有安排**：课是背景，但"这天空心点是哪几门课"
 * 恰恰是用户扫清单时最想知道的一件事。任务反而会被截断（见上面的注释）。
 */
export function buildMonthPlan(input: MonthPlanInput): MonthPlanDay[] {
  const days: MonthPlanDay[] = [];

  for (const day of monthGridDays(input.month)) {
    if (!isSameMonth(day, input.month)) continue;

    const key = format(day, 'yyyy-MM-dd');
    const courses =
      input.timetableOn && input.term
        ? coursesOnDate(input.courses, day, input.term)
        : [];
    const exams = input.examsByDay.get(key) ?? [];
    const marks = input.marksByDay.get(key) ?? [];
    const allTasks = input.tasksByDay.get(key) ?? [];
    const tasks = allTasks.slice(0, MONTH_PLAN_TASK_LIMIT);

    // 什么都没有的日子不出现 —— 空行只会把真正的节奏稀释掉
    if (!courses.length && !exams.length && !marks.length && !tasks.length) continue;

    days.push({
      date: day,
      marks: [...marks],
      courses,
      exams: [...exams],
      tasks: [...tasks],
      extraTasks: allTasks.length - tasks.length,
    });
  }

  return days;
}
