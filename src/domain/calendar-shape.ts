/**
 * 日历上「这一格是什么」的**形状口径** —— 一个地方定死，三个视图共用。
 *
 * ## 为什么需要它
 *
 * 日历上并排出现三种东西：**课**（别人定好的时间）、**考试**（到点就是它）、
 * **任务**（你要做的事）。此前它们只靠颜色和位置区分，而同刻并存时
 * （上课那两节里还压着一个要交的作业）一眼看不出哪个是哪个。
 *
 * ## 为什么给的是"形状"而不是"类型文字标签"
 *
 * 列表行上早有一条决定（`components/task-row.tsx`）：**行上只留「习惯」标签** ——
 * 日程 / 执行 / 想法是内部枚举，摆出来只会让人问"这俩有什么区别"。
 * 日历块上加"日程/执行"的文字标签是同一件事换个地方，只会把方块塞满。
 *
 * 所以这里区分的是**用户真正要分的那三种东西**（课 / 考试 / 任务），
 * 用的也是**形状**（虚线的 vs 实心的 vs 带色条的），不是枚举名：
 * - **课**：虚线、透明底 —— "这段被占着"，但你不用为它做任何动作；
 * - **考试**：实心 + 左侧色条 —— 硬边界，到点就是它，不带完成态；
 * - **任务**：实心 + 左侧色条 —— 你能勾它、能拖它。
 *
 * 考试与任务**同类形状**是刻意的：它们都是"实心 = 要面对的一件事"，
 * 差别在**能不能动手**（任务有勾选圈、考试没有），而不是在形状上再切一刀。
 * 多切一刀的代价是用户要去记"这个形状到底代表啥"。
 */

/** 日历上一格的三副面孔 */
export type CalendarShape = 'course' | 'exam' | 'task';

/**
 * 课是虚线带：不参与分道、不可点、不显眼。
 * 它是"背景"不是"日程"（这条口径在日/周视图与设置里都成立）。
 */
export const COURSE_BORDER_STYLE = 'dashed' as const;

/** 课的边框与文字用弱色，让实心块自己跳出来 */
export const COURSE_OPACITY = 0.55;

/**
 * 考试与任务左侧色条同宽 —— 两者是同一类"实心块",
 * 宽度一致才不会让人以为它们分属两套体系。
 */
export const BLOCK_BAR_WIDTH = 3;

/**
 * 「实心块」（考试 / 任务）与「背景带」（课）的圆角也取同一个值：
 * 形状语言统一，差别只在边框与有没有交互。
 */
export const SHAPE_RADIUS = 8;

/** 月历一格上最多摆几个圆点 */
export const MAX_DAY_DOTS = 3;

/** 那天各有多少课、多少场考试（月历圆点分形状用；任务数走另一条老路） */
export interface DayMarks {
  courses: number;
  exams: number;
}

/**
 * 把"那天有几件什么"摊成一个有序的形状列表，最多 `MAX_DAY_DOTS` 个。
 *
 * 两条约定，都在这里定死：
 *
 * 1. **顺序**：先课 → 再考试 → 最后任务 —— 越往后越需要你动手。
 * 2. **名额不够时按优先级保**：任务 > 考试 > 课。课有课表可以看，少一个圆点
 *    不损失信息；而"这天除了满课还压着两件事"恰恰是月历唯一能告诉你的事。
 *
 * 注意这条说的是**丢掉谁**，不是**不许出现谁**：有富余名额时课照常画出来
 * （"空心 + 实心 + 实心"是准确的信息）。只有名额被事占满，课才整个消失。
 *
 * 为什么不是简单地"排好序再取后 3 个"：那样中间的考试会被误伤 ——
 * 排序是课/考试/任务，取尾巴时考试会被任务先挤掉，顺序就白排了。
 * 先算配额、再按顺序摆，两个约定才同时成立。
 */
export function dayShapes(count: number, marks: DayMarks | undefined): CalendarShape[] {
  const courses = marks?.courses ?? 0;
  const exams = marks?.exams ?? 0;
  // 先保任务、再保考试、最后才轮到课 —— 从后往前分配名额
  const keepTasks = Math.min(count, MAX_DAY_DOTS);
  const keepExams = Math.min(exams, MAX_DAY_DOTS - keepTasks);
  const keepCourses = Math.min(courses, MAX_DAY_DOTS - keepTasks - keepExams);
  return [
    ...Array<CalendarShape>(keepCourses).fill('course'),
    ...Array<CalendarShape>(keepExams).fill('exam'),
    ...Array<CalendarShape>(keepTasks).fill('task'),
  ];
}
