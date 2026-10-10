import { describe, expect, it } from 'vitest';

import { dayShapes, MAX_DAY_DOTS } from './calendar-shape';

/** 四种点，写成简写让断言一眼能读 */
const course = { kind: 'course' } as const;
const exam = { kind: 'exam' } as const;
/** 任务点 · 已了结（浅） */
const done = { kind: 'task', open: false } as const;
/** 任务点 · 还没做完（深） */
const open = { kind: 'task', open: true } as const;

/**
 * 月历圆点的三个约定，都是"看起来能顺手改、其实一改就丢信息"的地方：
 *
 * 1. **顺序**先课 → 再考试 → 最后任务 —— 越往后越需要你动手。
 * 2. **挤不下时按优先级保**：任务 > 考试 > 课。课有课表可看，少这一个点
 *    无所谓；而"这天除了满课还压着两件事"恰恰是月历唯一能告诉你的事。
 * 3. **同是任务点时，没做完的先留**（和上一条同一个精神：欠着的更该被看见）。
 *
 * 有富余名额时课照常显示（"空心 + 实心 + 实心"是准确的信息，不是错误）：
 * 这条规则说的是**丢掉谁**，不是**不许出现谁**。
 *
 * 验牙：
 * - 三段顺序调换成 task 打头 → 第 1 条红；
 * - `MAX_DAY_DOTS - keepTasks - keepExams` 改成 `MAX_DAY_DOTS - keepTasks`
 *   （课和考试不再互相争名额）→ 第 4 条红；
 * - `keepOpen` 改成 `keepTasks`（不再优先留未完成的）→ 第 6 条红。
 */
describe('dayShapes', () => {
  it('顺序：先课 → 再考试 → 最后任务', () => {
    expect(dayShapes(1, { courses: 2, exams: 1 })).toEqual([course, exam, done]);
    expect(dayShapes(0, { courses: 1, exams: 2 })).toEqual([course, exam, exam]);
  });

  it('没有 marks（老调用方）时退化成全是实心点', () => {
    expect(dayShapes(2, undefined)).toEqual([done, done]);
    expect(dayShapes(0, undefined)).toEqual([]);
  });

  it('恰好 MAX_DAY_DOTS 个：一个都不截', () => {
    expect(dayShapes(MAX_DAY_DOTS, { courses: 0, exams: 0 })).toEqual([done, done, done]);
  });

  it('挤不下时先丢课：任务与考试比课优先', () => {
    // 3 个名额先给 2 件事，剩下 1 个才轮到课
    expect(dayShapes(2, { courses: 8, exams: 0 })).toEqual([course, done, done]);
    // 2 件事 + 1 场考试：三个名额全给"要动手的"，5 节课一个不剩
    expect(dayShapes(2, { courses: 5, exams: 1 })).toEqual([exam, done, done]);
    // 一件事 + 一场考试：还剩一个名额，课才留得下
    expect(dayShapes(1, { courses: 5, exams: 1 })).toEqual([course, exam, done]);
    // 三件事：课直接被挤光
    expect(dayShapes(3, { courses: 5, exams: 1 })).toEqual([done, done, done]);
  });

  it('有富余名额时课照常显示（空心的点不该凭空消失）', () => {
    expect(dayShapes(0, { courses: 1, exams: 0 })).toEqual([course]);
    expect(dayShapes(1, { courses: 1, exams: 0 })).toEqual([course, done]);
  });

  it('任务多于 3 件时只画 3 个实心点（课照旧全被挤掉）', () => {
    expect(dayShapes(7, { courses: 2, exams: 1 })).toEqual([done, done, done]);
  });

  it('满课的一天（没有别的）：仍然显示 3 个空心点', () => {
    expect(dayShapes(0, { courses: 5, exams: 0 })).toEqual([course, course, course]);
  });

  /**
   * ---- 深浅（2026-10-10「月历上标识未完成」）----
   * 没做完的点用深色 —— 这是月历上唯一能**提前**看见"这天还欠着事"的地方。
   */
  describe('任务点的深浅', () => {
    it('不传 openTasks = 全都当成已了结（老行为不变）', () => {
      expect(dayShapes(2, { courses: 0, exams: 0 })).toEqual([done, done]);
      expect(dayShapes(2, { courses: 0, exams: 0, openTasks: 0 })).toEqual([done, done]);
    });

    it('只有欠着的那些画深，且排在前面', () => {
      expect(dayShapes(2, { courses: 0, exams: 0, openTasks: 1 })).toEqual([open, done]);
      expect(dayShapes(3, { courses: 0, exams: 0, openTasks: 3 })).toEqual([open, open, open]);
    });

    it('名额不够时，丢掉的永远是**已经了结**的那几件', () => {
      // 4 件事、其中 1 件欠着 → 3 个名额里那个欠着的必须先留下
      expect(dayShapes(4, { courses: 0, exams: 0, openTasks: 1 })).toEqual([open, done, done]);
      // 5 件里 2 件欠着：两个深点都在，只挤掉一件已了结的
      expect(dayShapes(5, { courses: 0, exams: 0, openTasks: 2 })).toEqual([open, open, done]);
    });

    it('课和考试不参与深浅（它们没有完成态）', () => {
      expect(dayShapes(1, { courses: 2, exams: 1, openTasks: 1 })).toEqual([course, exam, open]);
    });

    it('openTasks 比总数还大（调用方算错）时按"全是欠着的"处理，不凭空多出点', () => {
      expect(dayShapes(1, { courses: 0, exams: 0, openTasks: 9 })).toEqual([open]);
      expect(dayShapes(2, { courses: 0, exams: 0, openTasks: 9 })).toEqual([open, open]);
    });
  });
});
