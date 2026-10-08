import { describe, expect, it } from 'vitest';

import { dayShapes, MAX_DAY_DOTS } from './calendar-shape';

/**
 * 月历圆点的两个约定，都是"看起来能顺手改、其实一改就丢信息"的地方：
 *
 * 1. **顺序**先课 → 再考试 → 最后任务 —— 越往后越需要你动手。
 * 2. **挤不下时按优先级保**：任务 > 考试 > 课。课有课表可看，涨不涨这一个点
 *    无所谓；而"这天除了满课还压着两件事"恰恰是月历唯一能告诉你的事。
 *
 * 有富余名额时课照常显示（"空心 + 实心 + 实心"是准确的信息，不是错误）：
 * 这条规则说的是**丢掉谁**，不是**不许出现谁**。
 *
 * 验牙：
 * - 三段顺序调换成 task 打头 → 第 1 条红；
 * - `MAX_DAY_DOTS - keepTasks - keepExams` 改成 `MAX_DAY_DOTS - keepTasks`
 *   （课和考试不再互相争名额）→ 第 4 条红。
 */
describe('dayShapes', () => {
  it('顺序：先课 → 再考试 → 最后任务', () => {
    expect(dayShapes(1, { courses: 2, exams: 1 })).toEqual(['course', 'exam', 'task']);
    expect(dayShapes(0, { courses: 1, exams: 2 })).toEqual(['course', 'exam', 'exam']);
  });

  it('没有 marks（老调用方）时退化成全是实心点', () => {
    expect(dayShapes(2, undefined)).toEqual(['task', 'task']);
    expect(dayShapes(0, undefined)).toEqual([]);
  });

  it('恰好 MAX_DAY_DOTS 个：一个都不截', () => {
    expect(dayShapes(MAX_DAY_DOTS, { courses: 0, exams: 0 })).toEqual([
      'task',
      'task',
      'task',
    ]);
  });

  it('挤不下时先丢课：任务与考试比课优先', () => {
    // 3 个名额先给 2 件事，剩下 1 个才轮到课
    expect(dayShapes(2, { courses: 8, exams: 0 })).toEqual(['course', 'task', 'task']);
    // 2 件事 + 1 场考试：三个名额全给"要动手的"，5 节课一个不剩
    expect(dayShapes(2, { courses: 5, exams: 1 })).toEqual(['exam', 'task', 'task']);
    // 一件事 + 一场考试：还剩一个名额，课才留得下
    expect(dayShapes(1, { courses: 5, exams: 1 })).toEqual(['course', 'exam', 'task']);
    // 三件事：课直接被挤光
    expect(dayShapes(3, { courses: 5, exams: 1 })).toEqual(['task', 'task', 'task']);
  });

  it('有富余名额时课照常显示（空心的点不该凭空消失）', () => {
    expect(dayShapes(0, { courses: 1, exams: 0 })).toEqual(['course']);
    expect(dayShapes(1, { courses: 1, exams: 0 })).toEqual(['course', 'task']);
  });

  it('任务多于 3 件时只画 3 个实心点（课照旧全被挤掉）', () => {
    expect(dayShapes(7, { courses: 2, exams: 1 })).toEqual(['task', 'task', 'task']);
  });

  it('满课的一天（没有别的）：仍然显示 3 个空心点', () => {
    expect(dayShapes(0, { courses: 5, exams: 0 })).toEqual(['course', 'course', 'course']);
  });
});
