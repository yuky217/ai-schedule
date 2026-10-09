import { describe, expect, it } from 'vitest';

import { createCourse, createEvent, createMark, createTask, createTerm } from './factory';
import { TimeAttribute } from './enums';
import { describeMark } from './marks';
import { MONTH_PLAN_TASK_LIMIT, buildMonthPlan, type MonthPlanInput } from './month-plan';
import type { Task } from './task';

/**
 * 月历下拉清单的四条规矩：
 *
 * 1. **只列"属于这个月"的日子** —— 月历画的是 6×7 整张网格（首尾带着
 *    上/下月的几天），清单要是照抄整张网格，9 月 29 号就会同时出现在
 *    9 月和 10 月两张清单里。
 * 2. **空的日子不出现** —— 31 行里 20 行是空的，节奏就看不见了。
 * 3. **每天最多 MONTH_PLAN_TASK_LIMIT 件事**，超出部分报数，留出"看这天"的出口。
 * 4. **课表关掉时课连清单一起消失**（与月历圆点、日视图背景带同一口径）。
 *
 * 验牙：
 * - 去掉 `isSameMonth` 过滤 → 第 1 条红；
 * - 去掉 `slice(0, MONTH_PLAN_TASK_LIMIT)` → 第 3 条红。
 */

const OCT = new Date(2026, 9, 1);

const task = (title: string, iso: string): Task =>
  createTask({ title, time: { attribute: TimeAttribute.Fixed, startAt: iso } });

const base: MonthPlanInput = {
  month: OCT,
  tasksByDay: new Map(),
  examsByDay: new Map(),
  marksByDay: new Map(),
  courses: [],
  term: null,
  timetableOn: false,
};

const plan = (over: Partial<MonthPlanInput>) => buildMonthPlan({ ...base, ...over });

const dates = (days: ReturnType<typeof buildMonthPlan>): number[] =>
  days.map((day) => day.date.getDate());

/** 第 1 周从 2026-09-07（周一）起，所以 10 月 5 号是第 5 周的周一 */
const term = createTerm({ label: '2026秋', startDayKey: '2026-09-07' });
const mathCourse = createCourse({
  title: '高等数学',
  sessions: [{ weekday: 1, startPeriod: 1, endPeriod: 2, weeks: [5] }],
});

describe('buildMonthPlan', () => {
  it('只列属于这个月的日子（网格里带上/下月的那几格不算）', () => {
    const days = plan({
      tasksByDay: new Map([
        ['2026-09-29', [task('上月的', '2026-09-29T09:00:00')]],
        ['2026-10-05', [task('本月的', '2026-10-05T09:00:00')]],
        ['2026-11-02', [task('下月的', '2026-11-02T09:00:00')]],
      ]),
    });
    expect(dates(days)).toEqual([5]);
  });

  it('按日期升序（清单从上往下就是这个月的 1 号到 31 号）', () => {
    const days = plan({
      tasksByDay: new Map([
        ['2026-10-20', [task('后', '2026-10-20T09:00:00')]],
        ['2026-10-03', [task('先', '2026-10-03T09:00:00')]],
        ['2026-10-11', [task('中', '2026-10-11T09:00:00')]],
      ]),
    });
    expect(dates(days)).toEqual([3, 11, 20]);
  });

  it('什么都没有的日子不出现', () => {
    expect(plan({})).toEqual([]);
    expect(
      dates(
        plan({
          tasksByDay: new Map([['2026-10-07', [task('只有这天', '2026-10-07T09:00:00')]]]),
        }),
      ),
    ).toEqual([7]);
  });

  it('每天最多列 3 件事，多出来的报数（留出"看这天"的出口）', () => {
    const many = Array.from({ length: 7 }, (_, i) =>
      task(`第${i + 1}件`, `2026-10-08T0${i + 1}:00:00`),
    );
    const days = plan({ tasksByDay: new Map([['2026-10-08', many]]) });
    expect(days).toHaveLength(1);
    expect(days[0].tasks).toHaveLength(MONTH_PLAN_TASK_LIMIT);
    expect(days[0].extraTasks).toBe(7 - MONTH_PLAN_TASK_LIMIT);
  });

  it('恰好 3 件时不报余数', () => {
    const three = Array.from({ length: 3 }, (_, i) => task(`t${i}`, `2026-10-08T0${i + 1}:00:00`));
    const days = plan({ tasksByDay: new Map([['2026-10-08', three]]) });
    expect(days[0].tasks).toHaveLength(3);
    expect(days[0].extraTasks).toBe(0);
  });

  it('课、考试、纪念日在同一天上各归各位', () => {
    const days = plan({
      tasksByDay: new Map([['2026-10-08', [task('交作业', '2026-10-08T09:00:00')]]]),
      examsByDay: new Map([
        ['2026-10-08', [createEvent({ title: '期中', startAt: '2026-10-08T14:00:00' })]],
      ]),
      marksByDay: new Map([
        ['2026-10-08', [describeMark(createMark({ title: '在一起', date: '2026-10-08' }))]],
      ]),
      // 10 月 8 号是周四（第 5 周），让课也落在这一天，才谈得上"各归各位"
      courses: [
        createCourse({
          title: '高等数学',
          sessions: [{ weekday: 4, startPeriod: 1, endPeriod: 2, weeks: [5] }],
        }),
      ],
      term,
      timetableOn: true,
    });
    expect(dates(days)).toEqual([8]);
    expect(days[0].tasks.map((t) => t.title)).toEqual(['交作业']);
    expect(days[0].exams.map((e) => e.title)).toEqual(['期中']);
    expect(days[0].marks.map((m) => m.mark.title)).toEqual(['在一起']);
  });

  it('只有课的那天也算有安排（"这天空心点是哪几门课"正是想问的）', () => {
    const days = plan({ courses: [mathCourse], term, timetableOn: true });
    expect(dates(days)).toEqual([5]);
    expect(days[0].courses.map((slot) => slot.course.title)).toEqual(['高等数学']);
    expect(days[0].tasks).toEqual([]);
  });

  it('课表关掉（或没有学期）时，课连清单一起消失', () => {
    expect(plan({ courses: [mathCourse], term, timetableOn: false })).toEqual([]);
    expect(plan({ courses: [mathCourse], term: null, timetableOn: true })).toEqual([]);
  });

  it('学期没排课的星期不算（第 5 周有课、第 6 周没有）', () => {
    const days = plan({
      courses: [
        createCourse({
          title: '只在第5周',
          sessions: [{ weekday: 1, startPeriod: 1, endPeriod: 2, weeks: [5] }],
        }),
      ],
      term,
      timetableOn: true,
    });
    // 10 月有 5 个周一：5、12、19、26 只有第 5 周（10/5）那一次
    expect(dates(days)).toEqual([5]);
  });
});
